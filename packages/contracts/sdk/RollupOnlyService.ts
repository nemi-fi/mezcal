import type { Fr } from "@aztec/aztec.js";
import type { AppendOnlyTree, StandardIndexedTree } from "@aztec/merkle-tree";
import { utils } from "@repo/utils";
import assert from "assert";
import { ethers } from "ethers";
import type { AsyncOrSync } from "ts-essentials";
import type { PoolGeneric } from "../typechain-types";
import {
  GENERATOR_INDEX__NOTE_HASH_SILO,
  GENERATOR_INDEX__NULLIFIER_SILO,
  INCLUDE_UNCOMMITTED,
  MAX_NOTES_PER_ROLLUP,
  MAX_NULLIFIERS_PER_ROLLUP,
  NOTE_HASH_SUBTREE_HEIGHT,
  poseidon2Hash,
  type NoirAndBackend,
} from "./RollupService";
import type { TreesService } from "./TreesService";

export class RollupService {
  constructor(
    private contract: PoolGeneric,
    private trees: TreesService,
    private circuits: {
      rollup: AsyncOrSync<NoirAndBackend>;
    },
  ) {}

  async rollup() {
    const { Fr } = await import("@aztec/aztec.js");

    const { noteHashTree, nullifierTree } = await this.trees.getTrees();
    const pending = await this.selectTxsToRollup();
    const noteHashTreeInput = await getInsertTreeInput(
      noteHashTree,
      await Promise.all(
        pending.noteHashes.map(async (x) =>
          Fr.fromString(await x.siloedHash()),
        ),
      ),
    );
    const nullifierTreeInput = await getInsertTreeInput(
      nullifierTree._tree,
      await Promise.all(
        pending.nullifiers.map(async (n) =>
          Fr.fromString(await n.siloedHash()).toBuffer(),
        ),
      ),
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
      new_note_hashes: await Promise.all(
        pending.noteHashes.map((x) => x.toNoir()),
      ),
      note_hash_subtree_sibling_path: noteHashTreeInput.subtreeSiblingPath,
      note_hash_tree: noteHashTreeInput.treeSnapshot,
      expected_new_note_hash_tree: noteHashTreeInput.newTreeSnapshot,

      new_nullifiers: await Promise.all(
        pending.nullifiers.map((x) => x.toNoir()),
      ),
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
    console.time("rollup generateProof");
    const { witness } = await rollupCircuit.noir.execute(input);
    const { proof } = await rollupCircuit.backend.generateProof(witness);
    console.timeEnd("rollup generateProof");

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
      noteHashes: NoteHashToSilo[];
      nullifiers: NullifierToSilo[];
    } = {
      txIndices: [],
      noteHashes: [],
      nullifiers: [],
    };

    for (const [i, tx] of txs) {
      if (
        batch.noteHashes.length + tx.innerNoteHashes.length >
          MAX_NOTES_PER_ROLLUP ||
        batch.nullifiers.length + tx.innerNullifiers.length >
          MAX_NULLIFIERS_PER_ROLLUP
      ) {
        break;
      }
      // TODO: this is O(N^2), refactor
      batch = {
        txIndices: [...batch.txIndices, i],
        noteHashes: [
          ...batch.noteHashes,
          ...tx.innerNoteHashes.map(
            (innerNoteHash) =>
              new NoteHashToSilo(tx.siloContractAddress, innerNoteHash),
          ),
        ],
        nullifiers: [
          ...batch.nullifiers,
          ...tx.innerNullifiers.map(
            (innerNullifier) =>
              new NullifierToSilo(tx.siloContractAddress, innerNullifier),
          ),
        ],
      };
    }
    return {
      txIndices: batch.txIndices,
      noteHashes: utils.arrayPadEnd(
        batch.noteHashes,
        MAX_NOTES_PER_ROLLUP,
        new NoteHashToSilo(ethers.ZeroAddress, ethers.ZeroHash),
      ),
      nullifiers: utils.arrayPadEnd(
        batch.nullifiers,
        MAX_NULLIFIERS_PER_ROLLUP,
        new NullifierToSilo(ethers.ZeroAddress, ethers.ZeroHash),
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

export class NoteHashToSilo {
  constructor(
    readonly siloContractAddress: string,
    readonly innerNoteHash: string,
  ) {}

  async siloedHash(): Promise<string> {
    const { Fr } = await import("@aztec/aztec.js");
    if (this.siloContractAddress === ethers.ZeroAddress) {
      return Fr.zero().toString();
    }
    return (
      await poseidon2Hash([
        GENERATOR_INDEX__NOTE_HASH_SILO,
        this.siloContractAddress,
        this.innerNoteHash,
      ])
    ).toString();
  }

  async toNoir() {
    return {
      silo_contract_address: this.siloContractAddress,
      inner_note_hash: this.innerNoteHash,
    };
  }
}

export class NullifierToSilo {
  constructor(
    readonly siloContractAddress: string,
    readonly innerNullifier: string,
  ) {}

  async siloedHash(): Promise<string> {
    const { Fr } = await import("@aztec/aztec.js");
    if (this.siloContractAddress === ethers.ZeroAddress) {
      return Fr.zero().toString();
    }
    return (
      await poseidon2Hash([
        GENERATOR_INDEX__NULLIFIER_SILO,
        this.siloContractAddress,
        this.innerNullifier,
      ])
    ).toString();
  }

  async toNoir() {
    return {
      silo_contract_address: this.siloContractAddress,
      inner_nullifier: this.innerNullifier,
    };
  }
}
