import { type AsyncOrSync } from "ts-essentials";
import { type PoolERC20 } from "../typechain-types";
import { type ITreesService } from "./RemoteTreesService";
import {
  Erc20Note,
  type NoirAndBackend,
  type PoolErc20Service,
} from "./RollupService";
import { toNoirU256 } from "./utils";

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
    console.time("swap generateProof");
    const sellerRandomness = Fr.random().toString();
    const buyerRandomness = Fr.random().toString();

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
    // console.log("input\n", JSON.stringify(input));
    const { witness } = await swapCircuit.noir.execute(input);
    const { proof } = await swapCircuit.backend.generateProof(witness);
    console.timeEnd("swap generateProof");
    // TODO: commit note hashes and nullifiers to blockchain
  }
}
