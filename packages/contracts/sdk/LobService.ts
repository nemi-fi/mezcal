import { type AsyncOrSync } from "ts-essentials";
import { type PoolERC20 } from "../typechain-types";
import { NoteInputStruct } from "../typechain-types/contracts/PoolERC20";
import { type ITreesService } from "./RemoteTreesService.js";
import {
  CompleteWaAddress,
  Erc20Note,
  TokenAmount,
  type NoirAndBackend,
  type PoolErc20Service,
} from "./RollupService.js";
import { prove, toNoirU256 } from "./utils.js";

export class LobService {
  constructor(
    private contract: PoolERC20,
    private trees: ITreesService,
    private poolErc20: PoolErc20Service,
    private circuits: AsyncOrSync<{
      swap: NoirAndBackend;
    }>,
  ) {}

  async swap(params: {
    sellerSecretKey: string;
    sellerNote: Erc20Note;
    sellerAmount: bigint;
    buyerSecretKey: string;
    buyerNote: Erc20Note;
    buyerAmount: bigint;
  }) {
    const { Fr } = await import("@aztec/aztec.js");

    const swapCircuit = (await this.circuits).swap;
    const sellerRandomness = Fr.random().toString();
    const buyerRandomness = Fr.random().toString();

    const sellerChangeNote = await Erc20Note.from({
      owner: await CompleteWaAddress.fromSecretKey(params.sellerSecretKey),
      amount: await TokenAmount.from({
        token: params.sellerNote.amount.token,
        amount: params.sellerNote.amount.amount - params.sellerAmount,
      }),
      randomness: sellerRandomness,
    });
    const buyerChangeNote = await Erc20Note.from({
      owner: await CompleteWaAddress.fromSecretKey(params.buyerSecretKey),
      amount: await TokenAmount.from({
        token: params.buyerNote.amount.token,
        amount: params.buyerNote.amount.amount - params.buyerAmount,
      }),
      randomness: buyerRandomness,
    });
    const sellerSwapNote = await Erc20Note.from({
      owner: await CompleteWaAddress.fromSecretKey(params.sellerSecretKey),
      amount: await TokenAmount.from({
        token: params.buyerNote.amount.token,
        amount: params.buyerAmount,
      }),
      randomness: sellerRandomness,
    });
    const buyerSwapNote = await Erc20Note.from({
      owner: await CompleteWaAddress.fromSecretKey(params.buyerSecretKey),
      amount: await TokenAmount.from({
        token: params.sellerNote.amount.token,
        amount: params.sellerAmount,
      }),
      randomness: buyerRandomness,
    });

    const input = {
      tree_roots: await this.trees.getTreeRoots(),
      seller_secret_key: params.sellerSecretKey,
      seller_note: await this.poolErc20.toNoteConsumptionInputs(
        params.sellerSecretKey,
        params.sellerNote,
      ),
      seller_amount: toNoirU256(params.sellerAmount),
      seller_randomness: sellerRandomness,

      buyer_secret_key: params.buyerSecretKey,
      buyer_note: await this.poolErc20.toNoteConsumptionInputs(
        params.buyerSecretKey,
        params.buyerNote,
      ),
      buyer_amount: toNoirU256(params.buyerAmount),
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
}
