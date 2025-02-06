import type { Fr } from "@aztec/aztec.js";
import type { AppendOnlyTree, StandardIndexedTree } from "@aztec/merkle-tree";
import { utils } from "@repo/utils";
import assert from "assert";
import { ethers } from "ethers";
import type { AsyncOrSync } from "ts-essentials";
import type { PoolERC20 } from "../typechain-types";
import {
  INCLUDE_UNCOMMITTED,
  MAX_NOTES_PER_ROLLUP,
  MAX_NULLIFIERS_PER_ROLLUP,
  NOTE_HASH_SUBTREE_HEIGHT,
  type NoirAndBackend,
} from "./RollupService";
import type { TreesService } from "./TreesService";
import { prove } from "./utils.js";

export class RollupService {
  constructor(
    private contract: PoolERC20,
    private trees: TreesService,
    private circuits: {
      rollup: AsyncOrSync<NoirAndBackend>;
    },
  ) {}

  async rollup() {
    const { Fr } = await import("@aztec/aztec.js");

    const { noteHashTree, nullifierTree } = await this.trees.getTrees();
    const pending = await this.selectTxsToRollup();
    const pendingNoteHashes = pending.noteHashes.map((h) => new Fr(BigInt(h)));
    const pendingNullifiers = pending.nullifiers.map((h) => new Fr(BigInt(h)));
    const noteHashTreeInput = await getInsertTreeInput(
      noteHashTree,
      pendingNoteHashes,
    );
    const nullifierTreeInput = await getInsertTreeInput(
      nullifierTree._tree,
      pendingNullifiers.map((n) => n.toBuffer()),
    );
    assert(
      nullifierTreeInput.batchInsertResult != null,
      "invalid nullifier tree batch insert input",
    );
    assert(
      nullifierTreeInput.batchInsertResult.lowLeavesWitnessData,
      "invalid batch insert result low leaf witness data",
    );

    const input = {
      new_note_hashes: pendingNoteHashes.map((x: Fr) => x.toString()),
      note_hash_subtree_sibling_path: noteHashTreeInput.subtreeSiblingPath,
      note_hash_tree: noteHashTreeInput.treeSnapshot,
      expected_new_note_hash_tree: noteHashTreeInput.newTreeSnapshot,

      new_nullifiers: pendingNullifiers.map((x: Fr) => x.toString()),
      nullifier_subtree_sibling_path:
        nullifierTreeInput.batchInsertResult.newSubtreeSiblingPath
          .toTuple()
          .map((x: Fr) => x.toString()),
      nullifier_tree: nullifierTreeInput.treeSnapshot,
      sorted_nullifiers:
        nullifierTreeInput.batchInsertResult.sortedNewLeaves.map((x) =>
          ethers.hexlify(x),
        ),
      sorted_nullifiers_indexes:
        nullifierTreeInput.batchInsertResult.sortedNewLeavesIndexes,
      nullifier_low_leaf_preimages:
        nullifierTreeInput.batchInsertResult.lowLeavesWitnessData.map((x) => {
          return {
            nullifier: x.leafPreimage.getKey().toString(),
            next_nullifier: x.leafPreimage.getNextKey().toString(),
            next_index: x.leafPreimage.getNextIndex().toString(),
          };
        }),
      nullifier_low_leaf_membership_witnesses:
        nullifierTreeInput.batchInsertResult.lowLeavesWitnessData.map((x) => {
          return {
            leaf_index: x.index.toString(),
            sibling_path: x.siblingPath.toTuple().map((y: Fr) => y.toString()),
          };
        }),
      expected_new_nullifier_tree: nullifierTreeInput.newTreeSnapshot,
    };
    // console.log("rollup input\n", JSON.stringify(input));
    const rollupCircuit = await this.circuits.rollup;
    const { proof } = await prove("rollup", rollupCircuit, input);

    const tx = await this.contract.rollup(
      proof,
      pending.txIndices,
      {
        root: noteHashTreeInput.newTreeSnapshot.root,
        nextAvailableLeafIndex:
          noteHashTreeInput.newTreeSnapshot.next_available_leaf_index,
      },
      {
        root: nullifierTreeInput.newTreeSnapshot.root,
        nextAvailableLeafIndex:
          nullifierTreeInput.newTreeSnapshot.next_available_leaf_index,
      },
    );
    const receipt = await tx.wait();
    console.log("rollup gas used", receipt?.gasUsed);
    return tx;
  }

  async selectTxsToRollup() {
    const txs = Array.from(
      (await this.contract.getAllPendingTxs()).entries(),
    ).filter(([, tx]) => !tx.rolledUp);
    let batch: {
      txIndices: number[];
      noteHashes: string[];
      nullifiers: string[];
    } = {
      txIndices: [],
      noteHashes: [],
      nullifiers: [],
    };

    for (const [i, tx] of txs) {
      if (
        batch.noteHashes.length + tx.noteHashes.length > MAX_NOTES_PER_ROLLUP ||
        batch.nullifiers.length + tx.nullifiers.length >
          MAX_NULLIFIERS_PER_ROLLUP
      ) {
        break;
      }
      // this is O(N^2), refactor
      batch = {
        txIndices: [...batch.txIndices, i],
        noteHashes: [...batch.noteHashes, ...tx.noteHashes],
        nullifiers: [...batch.nullifiers, ...tx.nullifiers],
      };
    }
    return {
      txIndices: batch.txIndices,
      noteHashes: utils.arrayPadEnd(
        batch.noteHashes,
        MAX_NOTES_PER_ROLLUP,
        ethers.ZeroHash,
      ),
      nullifiers: utils.arrayPadEnd(
        batch.nullifiers,
        MAX_NULLIFIERS_PER_ROLLUP,
        ethers.ZeroHash,
      ),
    };
  }
}

async function getInsertTreeInput<T extends Fr | Buffer>(
  tree: AppendOnlyTree<T> | StandardIndexedTree,
  newLeaves: T[],
) {
  const subtreeSiblingPath = await getSubtreeSiblingPath(tree as any);
  const treeSnapshot = await treeToSnapshot(tree as any);

  let batchInsertResult:
    | Awaited<ReturnType<StandardIndexedTree["batchInsert"]>>
    | undefined;
  if ("batchInsert" in tree) {
    const subtreeHeight = Math.log2(newLeaves.length);
    assert(Number.isInteger(subtreeHeight), "subtree height must be integer");
    // console.log("batch inserting", newLeaves);
    batchInsertResult = await tree.batchInsert(newLeaves as any, subtreeHeight);
  } else {
    await tree.appendLeaves(newLeaves);
  }
  const newTreeSnapshot = await treeToSnapshot(tree as any);
  await tree.rollback();

  return {
    treeSnapshot,
    subtreeSiblingPath,
    newTreeSnapshot,
    batchInsertResult,
  };
}

async function getSubtreeSiblingPath(noteHashTree: AppendOnlyTree<Fr>) {
  const index = noteHashTree.getNumLeaves(INCLUDE_UNCOMMITTED);
  const siblingPath = await noteHashTree.getSiblingPath(
    index,
    INCLUDE_UNCOMMITTED,
  );
  return siblingPath
    .getSubtreeSiblingPath(NOTE_HASH_SUBTREE_HEIGHT)
    .toTuple()
    .map((x: Fr) => x.toString());
}

async function treeToSnapshot(tree: AppendOnlyTree<Fr>) {
  const { Fr } = await import("@aztec/aztec.js");
  return {
    root: new Fr(tree.getRoot(INCLUDE_UNCOMMITTED)).toString() as string,
    next_available_leaf_index: tree
      .getNumLeaves(INCLUDE_UNCOMMITTED)
      .toString(),
  };
}
