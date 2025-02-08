import type { Fr } from "@aztec/aztec.js";
import type { StandardTree } from "@aztec/merkle-tree";
import { ethers } from "ethers";
import { isEqual, orderBy, range, times } from "lodash-es";
import { assert } from "ts-essentials";
import { z } from "zod";
import type { PoolERC20 } from "../typechain-types";
import { NonMembershipTree } from "./NonMembershipTree";
import {
  INCLUDE_UNCOMMITTED,
  MAX_NULLIFIERS_PER_ROLLUP,
  NOTE_HASH_TREE_HEIGHT,
  NULLIFIER_TREE_HEIGHT,
} from "./RollupService";

export class TreesService {
  constructor(private contract: PoolERC20) {}

  getTreeRoots = z
    .function()
    .args()
    .implement(async () => {
      const { noteHashTree, nullifierTree } = await this.getTrees();
      // console.log("nullifier_tree_root", nullifierTree.getRoot());
      return {
        note_hash_root: ethers.hexlify(
          noteHashTree.getRoot(INCLUDE_UNCOMMITTED),
        ),
      };
    });

  // TODO(security): this reveals link between noteHash and nullifier to the backend. Can we move this to frontend or put backend inside a TEE?
  getNoteConsumptionInputs = z
    .function()
    .args(z.object({ noteHash: z.string(), nullifier: z.string() }))
    .implement(async (params) => {
      const { Fr } = await import("@aztec/aztec.js");

      const { noteHashTree, nullifierTree } = await this.getTrees();

      const nullifierNmWitness = await nullifierTree.getNonMembershipWitness(
        new Fr(BigInt(params.nullifier)),
      );

      const noteIndex = noteHashTree.findLeafIndex(
        new Fr(BigInt(params.noteHash)),
        INCLUDE_UNCOMMITTED,
      );
      assert(noteIndex != null, "note not found");
      return {
        note_sibling_path: (
          await noteHashTree.getSiblingPath(noteIndex, INCLUDE_UNCOMMITTED)
        )
          .toTuple()
          .map((x: Fr) => x.toString()),
        note_index: ethers.toQuantity(noteIndex),
        nullifier_low_leaf_preimage: nullifierNmWitness.low_leaf_preimage,
        nullifier_low_leaf_membership_witness:
          nullifierNmWitness.low_leaf_membership_witness,
      };
    });

  // TODO(security): this reveals link between noteHash and nullifier to the backend. Can we move this to frontend or put backend inside a TEE?
  noteExistsAndNotNullified = z
    .function()
    .args(z.object({ noteHash: z.string(), nullifier: z.string() }))
    .returns(z.promise(z.boolean()))
    .implement(async ({ noteHash, nullifier }) => {
      const { Fr } = await import("@aztec/aztec.js");
      const { noteHashTree, nullifierTree } = await this.getTrees();
      const noteHashIndex = await noteHashTree.findLeafIndex(
        new Fr(BigInt(noteHash)),
        INCLUDE_UNCOMMITTED,
      );
      if (noteHashIndex == null) {
        // note does not exist
        return false;
      }
      const nullifierIndex = await nullifierTree.findLeafIndex(
        new Fr(BigInt(nullifier)),
      );
      if (nullifierIndex != null) {
        // note is nullified
        return false;
      }
      return true;
    });

  async getTrees() {
    return await ethers.resolveProperties({
      noteHashTree: this.#getNoteHashTree(),
      nullifierTree: this.#getNullifierTree(),
    });
  }

  async #getNoteHashTree() {
    const { Fr } = await import("@aztec/aztec.js");
    const noteHashes = sortEventsWithIndex(
      await this.contract.queryFilter(this.contract.filters.NoteHashes()),
    ).map((x) => x.noteHashes);

    const noteHashTree = await createMerkleTree(NOTE_HASH_TREE_HEIGHT);
    if (noteHashes.length > 0) {
      await noteHashTree.appendLeaves(
        noteHashes.flat().map((h) => new Fr(BigInt(h))),
      );
      await noteHashTree.commit();
    }
    return noteHashTree;
  }

  async #getNullifierTree() {
    const { Fr } = await import("@aztec/aztec.js");

    const nullifiers = sortEventsWithIndex(
      await this.contract.queryFilter(this.contract.filters.Nullifiers()),
    ).map((x) => x.nullifiers.map((n) => new Fr(BigInt(n))));

    // add 1 to the nullifier tree, so it's possible to add new nullifiers to it(adding requires a non-zero low leaf)
    const initialNullifiers = [new Fr(1)].concat(
      // sub 2 because `0` and `1` are the first 2 leaves
      times(MAX_NULLIFIERS_PER_ROLLUP - 2, () => new Fr(0)),
    );
    const allNullifiers = initialNullifiers.concat(nullifiers.flat());
    const nullifierTree = await NonMembershipTree.new(
      allNullifiers,
      NULLIFIER_TREE_HEIGHT,
    );
    return nullifierTree;
  }
}

function sortEventsWithIndex<T extends { args: { index: bigint } }>(
  events: T[],
): T["args"][] {
  const ordered = orderBy(
    events.map((e) => e.args),
    (x) => x.index,
  );
  assert(
    isEqual(
      ordered.map((x) => x.index),
      range(0, ordered.length).map((x) => BigInt(x)),
    ),
    `missing some events: ${ordered.map((x) => x.index).join(", ")} | ${ordered.length}`,
  );
  return ordered;
}

async function createMerkleTree(height: number) {
  const { StandardTree, newTree, Poseidon } = await import(
    "@aztec/merkle-tree"
  );

  const { Fr } = await import("@aztec/aztec.js");
  // @ts-ignore hardhat does not support ESM
  const { AztecLmdbStore } = await import("@aztec/kv-store/lmdb");
  const store = AztecLmdbStore.open();
  const tree: StandardTree<Fr> = await newTree(
    StandardTree,
    store,
    new Poseidon(),
    `tree-name`,
    Fr,
    height,
  );
  return tree;
}
