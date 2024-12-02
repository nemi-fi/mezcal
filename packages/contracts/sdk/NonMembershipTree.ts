import type { Fr } from "@aztec/aztec.js";
import type { StandardIndexedTree } from "@aztec/merkle-tree";
import { ethers } from "ethers";
import { assert } from "ts-essentials";
import { INCLUDE_UNCOMMITTED, NULLIFIER_SUBTREE_HEIGHT } from "./RollupService";

export class NonMembershipTree {
  private constructor(readonly _tree: StandardIndexedTree) {}

  static async new(leaves: Fr[], depth: number) {
    const { newTree, Poseidon, StandardIndexedTreeWithAppend } = await import(
      "@aztec/merkle-tree"
    );
    const { NullifierLeaf, NullifierLeafPreimage } = await import(
      "@aztec/circuits.js"
    );
    // @ts-ignore hardhat does not support ESM
    const { AztecLmdbStore } = await import("@aztec/kv-store/lmdb");
    const db = AztecLmdbStore.open();
    class NullifierTree extends StandardIndexedTreeWithAppend {
      constructor(
        store: any,
        hasher: any,
        name: string,
        depth: number,
        size: bigint = 0n,
        _noop: any,
        root?: Buffer,
      ) {
        super(
          store,
          hasher,
          name,
          depth,
          size,
          NullifierLeafPreimage,
          NullifierLeaf,
          root,
        );
      }
    }
    const tree = await newTree(
      NullifierTree,
      db,
      new Poseidon(),
      "my-tree",
      { fromBuffer: (b: Buffer) => b },
      depth,
    );
    await tree.batchInsert(
      leaves.map((l) => l.toBuffer()),
      NULLIFIER_SUBTREE_HEIGHT,
    );
    await tree.commit();
    return new NonMembershipTree(tree);
  }

  getRoot() {
    return ethers.hexlify(this._tree.getRoot(INCLUDE_UNCOMMITTED));
  }

  getDepth() {
    return this._tree.getDepth();
  }

  async getNonMembershipWitness(key: Fr) {
    const keyAsBigInt = key.toBigInt();
    const lowLeafIndexData = this._tree.findIndexOfPreviousKey(
      keyAsBigInt,
      INCLUDE_UNCOMMITTED,
    );
    assert(lowLeafIndexData != null, `low leaf not found for key: "${key}"`);
    assert(!lowLeafIndexData.alreadyPresent, `key already present: "${key}"`);
    const lowLeafIndex = lowLeafIndexData.index;
    const lowLeafSiblingPath = await this._tree.getSiblingPath(
      lowLeafIndex,
      INCLUDE_UNCOMMITTED,
    );
    const lowLeafPreimage = this._tree.getLatestLeafPreimageCopy(
      lowLeafIndex,
      INCLUDE_UNCOMMITTED,
    );
    assert(lowLeafPreimage != null, "leafPreimage not found");

    const witness = {
      key: bigIntToString(keyAsBigInt),
      low_leaf_preimage: {
        nullifier: bigIntToString(lowLeafPreimage.getKey()),
        next_nullifier: bigIntToString(lowLeafPreimage.getNextKey()),
        next_index: bigIntToString(lowLeafPreimage.getNextIndex()),
      },
      low_leaf_membership_witness: {
        leaf_index: bigIntToString(lowLeafIndex),
        sibling_path: lowLeafSiblingPath
          .toFields()
          .map((x) => bigIntToString(x.toBigInt())),
      },
    };
    return witness;
  }
}

export interface NonMembershipWitness
  extends Awaited<ReturnType<NonMembershipTree["getNonMembershipWitness"]>> {}

/**
 * Type safe wrapper around `BigInt.toString`, so you can't pass a non bigint value.
 */
function bigIntToString(x: bigint) {
  return x.toString();
}
