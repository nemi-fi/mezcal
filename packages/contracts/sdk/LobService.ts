import { uniq } from "lodash";
import { assert, type AsyncOrSync } from "ts-essentials";
import { type PoolERC20 } from "../typechain-types";
import { NoteInputStruct } from "../typechain-types/contracts/PoolERC20";
import { MpcProverService, type Side } from "./mpc/MpcNetworkService.js";
import { splitInput } from "./mpc/utils.js";
import {
  CompleteWaAddress,
  Erc20Note,
  getRandomness,
  TokenAmount,
  type NoirAndBackend,
  type PoolErc20Service,
} from "./PoolErc20Service.js";
import { type ITreesService } from "./RemoteTreesService.js";
import { prove } from "./utils.js";

export class LobService {
  constructor(
    private contract: PoolERC20,
    private trees: ITreesService,
    private poolErc20: PoolErc20Service,
    private mpcProver: MpcProverService,
    private circuits: AsyncOrSync<{
      swap: NoirAndBackend;
    }>,
  ) {}

  async swap(params: {
    sellerSecretKey: string;
    sellerNote: Erc20Note;
    sellerAmount: TokenAmount;
    buyerSecretKey: string;
    buyerNote: Erc20Note;
    buyerAmount: TokenAmount;
  }) {
    const swapCircuit = (await this.circuits).swap;
    const sellerRandomness = await getRandomness();
    const buyerRandomness = await getRandomness();

    const sellerChangeNote = await Erc20Note.from({
      owner: await CompleteWaAddress.fromSecretKey(params.sellerSecretKey),
      amount: params.sellerNote.amount.sub(params.sellerAmount),
      randomness: sellerRandomness,
    });
    const buyerChangeNote = await Erc20Note.from({
      owner: await CompleteWaAddress.fromSecretKey(params.buyerSecretKey),
      amount: params.buyerNote.amount.sub(params.buyerAmount),
      randomness: buyerRandomness,
    });
    const sellerSwapNote = await Erc20Note.from({
      owner: await CompleteWaAddress.fromSecretKey(params.sellerSecretKey),
      amount: params.buyerAmount,
      randomness: sellerRandomness,
    });
    const buyerSwapNote = await Erc20Note.from({
      owner: await CompleteWaAddress.fromSecretKey(params.buyerSecretKey),
      amount: params.sellerAmount,
      randomness: buyerRandomness,
    });

    const seller_order = {
      sell_amount: await params.sellerAmount.toNoir(),
      buy_amount: await params.buyerAmount.toNoir(),
      randomness: sellerRandomness,
    };
    const buyer_order = {
      sell_amount: await params.buyerAmount.toNoir(),
      buy_amount: await params.sellerAmount.toNoir(),
      randomness: buyerRandomness,
    };

    const input = {
      tree_roots: await this.trees.getTreeRoots(),
      seller_secret_key: params.sellerSecretKey,
      seller_note: await this.poolErc20.toNoteConsumptionInputs(
        params.sellerSecretKey,
        params.sellerNote,
      ),
      seller_order,
      seller_randomness: sellerRandomness,
      buyer_secret_key: params.buyerSecretKey,
      buyer_note: await this.poolErc20.toNoteConsumptionInputs(
        params.buyerSecretKey,
        params.buyerNote,
      ),
      buyer_order,
      buyer_randomness: buyerRandomness,
    };
    const { proof } = await prove("swap", swapCircuit, input);
    const noteInputs: [
      NoteInputStruct,
      NoteInputStruct,
      NoteInputStruct,
      NoteInputStruct,
    ] = [
      await sellerChangeNote.toSolidityNoteInput(),
      await buyerSwapNote.toSolidityNoteInput(),
      await buyerChangeNote.toSolidityNoteInput(),
      await sellerSwapNote.toSolidityNoteInput(),
    ];
    const nullifiers: [string, string] = [
      (
        await params.sellerNote.computeNullifier(params.sellerSecretKey)
      ).toString(),
      (
        await params.buyerNote.computeNullifier(params.buyerSecretKey)
      ).toString(),
    ];
    const tx = await this.contract.swap(proof, noteInputs, nullifiers);
    const receipt = await tx.wait();
    console.log("swap gas used", receipt?.gasUsed);
  }

  async requestSwap(params: {
    secretKey: string;
    note: Erc20Note;
    sellAmount: TokenAmount;
    buyAmount: TokenAmount;
  }) {
    const orderId = await getRandomness();
    console.log(
      "order ID",
      orderId,
      params.sellAmount.amount,
      "->",
      params.buyAmount.amount,
    );

    const swapCircuit = (await this.circuits).swap;
    const randomness = await getRandomness();

    const changeNote = await Erc20Note.from({
      owner: await CompleteWaAddress.fromSecretKey(params.secretKey),
      amount: params.note.amount.sub(params.sellAmount),
      randomness,
    });
    const swapNote = await Erc20Note.from({
      owner: await CompleteWaAddress.fromSecretKey(params.secretKey),
      amount: params.buyAmount,
      randomness,
    });

    const order = {
      sell_amount: await params.sellAmount.toNoir(),
      buy_amount: await params.buyAmount.toNoir(),
      randomness,
    };

    // deterministic side
    const side: Side =
      params.sellAmount.token.toLowerCase() <
      params.buyAmount.token.toLowerCase()
        ? "seller"
        : "buyer";
    const input = {
      [`${side}_secret_key`]: params.secretKey,
      [`${side}_note`]: await this.poolErc20.toNoteConsumptionInputs(
        params.secretKey,
        params.note,
      ),
      [`${side}_order`]: order,
      [`${side}_randomness`]: randomness,
    };
    // only one trading party need to provide public inputs
    const inputPublic =
      side === "seller"
        ? {
            tree_roots: await this.trees.getTreeRoots(),
          }
        : undefined;
    const inputsShared = await splitInput(swapCircuit.circuit, {
      // merge public inputs into first input because it does not matter how public inputs are passed
      ...input,
      ...inputPublic,
    });
    const proofs = await this.mpcProver.prove(inputsShared, {
      orderId,
      side,
      circuit: swapCircuit.circuit,
    });
    assert(uniq(proofs).length === 1, "proofs mismatch");
    const proof = proofs[0]!;
    return {
      orderId,
      proof,
      side,
      changeNote: await changeNote.toSolidityNoteInput(),
      swapNote: await swapNote.toSolidityNoteInput(),
      nullifier: (
        await params.note.computeNullifier(params.secretKey)
      ).toString(),
    };
  }

  async commitSwap(params: { swapA: SwapResult; swapB: SwapResult }) {
    const [sellerSwap, buyerSwap] =
      params.swapA.side === "seller"
        ? [params.swapA, params.swapB]
        : [params.swapB, params.swapA];

    assert(
      sellerSwap.orderId !== buyerSwap.orderId,
      "order ids must be different",
    ); // sanity check

    assert(
      sellerSwap.proof === buyerSwap.proof,
      `seller & buyer proof mismatch: ${sellerSwap.orderId} ${buyerSwap.orderId}`,
    );
    const proof = sellerSwap.proof;

    const tx = await this.contract.swap(
      proof,
      [
        sellerSwap.changeNote,
        buyerSwap.swapNote,
        buyerSwap.changeNote,
        sellerSwap.swapNote,
      ],
      [sellerSwap.nullifier, buyerSwap.nullifier],
    );
    const receipt = await tx.wait();
    console.log("swap gas used", receipt?.gasUsed);
  }
}

export type SwapResult = Awaited<ReturnType<LobService["requestSwap"]>>;
