import type { Fr } from "@aztec/aztec.js";
import type { StandardTree } from "@aztec/merkle-tree";
import { ethers } from "ethers";
import { isEqual, orderBy, range, times } from "lodash-es";
import { assert } from "ts-essentials";
import { z } from "zod";
import type { PoolGeneric } from "../typechain-types";
import { NonMembershipTree } from "./NonMembershipTree";
import { NoteHashToSilo, NullifierToSilo } from "./RollupOnlyService";
import {
  INCLUDE_UNCOMMITTED,
  MAX_NULLIFIERS_PER_ROLLUP,
  NOTE_HASH_TREE_HEIGHT,
  NULLIFIER_TREE_HEIGHT,
  poseidon2Hash,
} from "./RollupService";

export class TreesService {
  constructor(private contract: PoolGeneric) {}

  getContext = z
    .function()
    .args()
    .implement(async () => {
      const { noteHashTree, nullifierTree } = await this.getTrees();
      return {
        this_address: await this.contract.getAddress(),
        note_hash_root: ethers.hexlify(
          noteHashTree.getRoot(INCLUDE_UNCOMMITTED),
        ),
        nullifier_root: nullifierTree.getRoot(),
      };
    });

  // TODO(privacy): this reveals link between noteHash and nullifier to the backend. Can we move this to frontend or put backend inside a TEE?
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

  async getTrees() {
    return await ethers.resolveProperties({
      noteHashTree: this.#getNoteHashTree(),
      nullifierTree: this.#getNullifierTree(),
    });
  }

  async #getNoteHashTree() {
    const { Fr } = await import("@aztec/aztec.js");
    const events = sortEventsWithIndex(
      await this.contract.queryFilter(this.contract.filters.NoteHashes()),
    );
    const noteHashes = await Promise.all(
      events.map((x) =>
        Promise.all(
          x.noteHashes.map(async (n) =>
            Fr.fromString(
              await new NoteHashToSilo(
                n.siloContractAddress,
                n.innerNoteHash,
              ).siloedHash(),
            ),
          ),
        ),
      ),
    );

    const noteHashTree = await createMerkleTree(NOTE_HASH_TREE_HEIGHT);
    if (noteHashes.length > 0) {
      await noteHashTree.appendLeaves(noteHashes.flat());
      await noteHashTree.commit();
    }
    return noteHashTree;
  }

  async #getNullifierTree() {
    const { Fr } = await import("@aztec/aztec.js");

    const events = sortEventsWithIndex(
      await this.contract.queryFilter(this.contract.filters.Nullifiers()),
    );
    const nullifiers = await Promise.all(
      events.map((x) =>
        Promise.all(
          x.nullifiers.map(async (n) =>
            Fr.fromString(
              await new NullifierToSilo(
                n.siloContractAddress,
                n.innerNullifier,
              ).siloedHash(),
            ),
          ),
        ),
      ),
    );

    const initialNullifiersSeed = new Fr(
      0x08a1735994d16db43c2373d0258b8f4d82ae162c297687bba68aa8a3912b042dn,
    );
    const initialNullifiers = await Promise.all(
      // sub 1 because the tree has a 0 leaf already
      times(MAX_NULLIFIERS_PER_ROLLUP - 1, (i) =>
        poseidon2Hash([initialNullifiersSeed.toString(), i]),
      ),
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
