import type { Fr } from "@aztec/aztec.js";
import type { UltraPlonkBackend } from "@aztec/bb.js";
import type {
  AppendOnlyTree,
  StandardIndexedTree,
  StandardTree,
} from "@aztec/merkle-tree";
import type { Noir } from "@noir-lang/noir_js";
import {
  PoolERC20__factory,
  type PoolERC20,
} from "@repo/contracts/typechain-types";
import type { ExecutionStruct } from "@repo/contracts/typechain-types/contracts/PoolERC20";
import { utils } from "@repo/utils";
import { ethers } from "ethers";
import { compact, isEqual, orderBy, range, times } from "lodash-es";
import { assert, type AsyncOrSync } from "ts-essentials";
import { keccak256ToFr } from "../utils";
import { EncryptionService } from "./EncryptionService";
import { NonMembershipTree } from "./NonMembershipTree";

// Note: keep in sync with other languages
export const NOTE_HASH_TREE_HEIGHT = 40;
// Note: keep in sync with other languages
export const NOTE_HASH_SUBTREE_HEIGHT = 6;
// Note: keep in sync with other languages
const MAX_NOTES_PER_ROLLUP = 64;
// Note: keep in sync with other languages
export const NULLIFIER_TREE_HEIGHT = 40;
// Note: keep in sync with other languages
export const NULLIFIER_SUBTREE_HEIGHT = 6;
// Note: keep in sync with other languages
const MAX_NULLIFIERS_PER_ROLLUP = 64;

// Note: keep in sync with other languages
const GENERATOR_INDEX__WA_ADDRESS = 1;
// Note: keep in sync with other languages
const GENERATOR_INDEX__NOTE_NULLIFIER = 2;

// Note: keep in sync with other languages
export const MAX_TOKENS_IN_PER_EXECUTION = 4;
// Note: keep in sync with other languages
export const MAX_TOKENS_OUT_PER_EXECUTION = 4;

// Note: keep in sync with other languages
const NOTE_HASH_OR_NULLIFIER_STATE_NOT_EXISTS = 0n;
// Note: keep in sync with other languages
const NOTE_HASH_OR_NULLIFIER_STATE_PENDING = 1n;
// Note: keep in sync with other languages
const NOTE_HASH_OR_NULLIFIER_STATE_ROLLED_UP = 2n;

// Note: keep in sync with other languages
const MAX_NOTES_TO_JOIN = 2;

export const INCLUDE_UNCOMMITTED = true;

export class RollupService {
  constructor(
    readonly contract: PoolERC20,
    private encryption: EncryptionService,
    private circuits: AsyncOrSync<{
      shield: NoirAndBackend;
      unshield: NoirAndBackend;
      join: NoirAndBackend;
      transfer: NoirAndBackend;
      execute: NoirAndBackend;
      rollup: NoirAndBackend;
    }>,
  ) {}

  async shield({
    account,
    token,
    amount,
    secretKey,
  }: {
    account: ethers.Signer;
    token: ethers.AddressLike;
    amount: bigint;
    secretKey: string;
  }) {
    const { Fr } = await import("@aztec/aztec.js");
    const randomness = Fr.random().toString();
    console.time("shield generateProof");
    const note = await ValueNote.from({
      owner: await CompleteWaAddress.fromSecretKey(secretKey),
      token: await ethers.resolveAddress(token),
      value: amount,
      randomness,
    });
    const noteInput = await this.toNoteInput(note);
    const shieldCircuit = (await this.circuits).shield;
    const { witness } = await shieldCircuit.noir.execute({
      owner: note.owner.address,
      token: note.token,
      value: note.value.toString(),
      randomness: note.randomness,
      note_hash: noteInput.noteHash,
    });
    const { proof } = await shieldCircuit.backend.generateProof(witness);
    console.timeEnd("shield generateProof");
    const tx = await this.contract
      .connect(account)
      .shield(proof, token, amount, noteInput);
    const receipt = await tx.wait();
    console.log("shield gas used", receipt?.gasUsed);
    return { tx, note };
  }

  async unshield({
    secretKey,
    fromNote,
    token,
    to,
    amount,
  }: {
    secretKey: string;
    fromNote: ValueNote;
    token: string;
    to: string;
    amount: bigint;
  }) {
    const { Fr } = await import("@aztec/aztec.js");

    assert(utils.isAddressEqual(token, fromNote.token), "invalid token");
    const change_randomness = Fr.random().toString();
    const changeNote = await ValueNote.from({
      token: fromNote.token,
      owner: fromNote.owner,
      value: fromNote.value - amount,
      randomness: change_randomness,
    });
    assert(changeNote.value >= 0n, "invalid change note");

    const noteHashTree = await this.getNoteHashTree();
    const nullifierTree = await this.getNullifierTree();
    const nullifier = await fromNote.computeNullifier(secretKey);

    const unshieldCircuit = (await this.circuits).unshield;
    console.time("unshield generateProof");
    const { witness } = await unshieldCircuit.noir.execute({
      note_hash_tree_root: ethers.hexlify(
        noteHashTree.getRoot(INCLUDE_UNCOMMITTED),
      ),
      nullifier_tree_root: nullifierTree.getRoot(),
      from_secret_key: secretKey,
      from_note_inputs: await this.toNoteConsumptionInputs(secretKey, fromNote),
      to,
      amount: {
        amount: amount.toString(),
        token,
      },
      change_randomness,
      // return
      nullifier: nullifier.toString(),
      change_note_hash: await changeNote.hash(),
    });
    const { proof } = await unshieldCircuit.backend.generateProof(witness);
    console.timeEnd("unshield generateProof");
    const tx = await this.contract.unshield(
      proof,
      token,
      to,
      amount,
      nullifier.toString(),
      await this.toNoteInput(changeNote),
    );
    const receipt = await tx.wait();
    console.log("unshield gas used", receipt?.gasUsed);
    return { tx, note: fromNote };
  }

  async join({ secretKey, notes }: { secretKey: string; notes: ValueNote[] }) {
    const { Fr } = await import("@aztec/aztec.js");
    assert(notes.length === MAX_NOTES_TO_JOIN, "invalid notes length");

    const join_randomness = Fr.random().toString();

    const joinCircuit = (await this.circuits).join;
    console.time("join generateProof");
    const { witness } = await joinCircuit.noir.execute({
      note_hash_tree_root: ethers.hexlify(
        (await this.getNoteHashTree()).getRoot(INCLUDE_UNCOMMITTED),
      ),
      nullifier_tree_root: ethers.hexlify(
        (await this.getNullifierTree()).getRoot(),
      ),
      from_secret_key: secretKey,
      join_randomness,
      notes: await Promise.all(
        notes.map((note) => this.toNoteConsumptionInputs(secretKey, note)),
      ),
    });
    const { proof } = await joinCircuit.backend.generateProof(witness);
    console.timeEnd("join generateProof");

    const joinNote = await ValueNote.from({
      owner: await CompleteWaAddress.fromSecretKey(secretKey),
      token: notes[0]!.token,
      value: notes.reduce((acc, note) => acc + note.value, 0n),
      randomness: join_randomness,
    });

    const tx = await this.contract.join(
      proof,
      (await Promise.all(
        notes.map(async (note) =>
          (await note.computeNullifier(secretKey)).toString(),
        ),
      )) as any,
      await this.toNoteInput(joinNote),
    );
    const receipt = await tx.wait(0);
    console.log("join gas used", receipt?.gasUsed);
  }

  async transfer({
    secretKey,
    fromNote,
    to,
    amount,
  }: {
    secretKey: string;
    fromNote: ValueNote;
    to: CompleteWaAddress;
    amount: bigint;
  }) {
    const { Fr } = await import("@aztec/aztec.js");

    const nullifierTree = await this.getNullifierTree();
    const nullifier = await fromNote.computeNullifier(secretKey);

    const noteHashTree = await this.getNoteHashTree();
    const to_randomness = Fr.random().toString();
    const change_randomness = Fr.random().toString();
    const input = {
      note_hash_tree_root: ethers.hexlify(
        noteHashTree.getRoot(INCLUDE_UNCOMMITTED),
      ),
      nullifier_tree_root: nullifierTree.getRoot(),
      from_note_inputs: await this.toNoteConsumptionInputs(secretKey, fromNote),
      from_secret_key: secretKey,
      to: to.address,
      amount: amount.toString(),
      to_randomness,
      change_randomness,
    };
    const changeNote = await ValueNote.from({
      token: fromNote.token,
      owner: fromNote.owner,
      value: fromNote.value - amount,
      randomness: change_randomness,
    });
    assert(changeNote.value >= 0n, "invalid change note");
    const toNote = await ValueNote.from({
      token: fromNote.token,
      owner: to,
      value: amount,
      randomness: to_randomness,
    });
    // console.log("input\n", JSON.stringify(input));
    const transferCircuit = (await this.circuits).transfer;
    console.time("transfer generateProof");
    const { witness, returnValue } = await transferCircuit.noir.execute(input);
    {
      const expectedReturnValue = {
        nullifier: nullifier.toString(),
        change_note_hash: await changeNote.hash(),
        to_note_hash: await toNote.hash(),
      };
      const patchedReturnValue = {
        ...(returnValue as any),
        nullifier: new Fr(BigInt((returnValue as any).nullifier)).toString(),
        change_note_hash: new Fr(
          BigInt((returnValue as any).change_note_hash),
        ).toString(),
        to_note_hash: new Fr(
          BigInt((returnValue as any).to_note_hash),
        ).toString(),
      };
      assert(
        isEqual(patchedReturnValue, expectedReturnValue),
        `invalid transfer return value: ${JSON.stringify(patchedReturnValue)} != ${JSON.stringify(expectedReturnValue)}`,
      );
    }
    const { proof } = await transferCircuit.backend.generateProof(witness);
    console.timeEnd("transfer generateProof");

    const tx = await this.contract.transfer(
      proof,
      nullifier.toString(),
      await this.toNoteInput(changeNote),
      await this.toNoteInput(toNote),
    );

    const receipt = await tx.wait();
    console.log("transfer gas used", receipt?.gasUsed);
    // console.log("nullifier", nullifier.toString());
    return {
      tx,
      nullifier: nullifier.toString(),
      changeNote,
      toNote,
    };
  }

  async balanceOf(token: ethers.AddressLike, secretKey: string) {
    const notes = await this.getBalanceNotesOf(token, secretKey);
    return notes.reduce((acc, note) => acc + note.value, 0n);
  }

  async getBalanceNotesOf(token: ethers.AddressLike, secretKey: string) {
    token = await ethers.resolveAddress(token);
    const notes = await this.getEmittedNotes(secretKey);
    return notes.filter(
      (note) => note.token.toLowerCase() === token.toLowerCase(),
    );
  }

  async execute({
    fromSecretKey,
    fromNotes,
    to,
    amountsIn,
    amountsOut,
    calls,
  }: {
    fromSecretKey: string;
    fromNotes: ValueNote[];
    to: CompleteWaAddress;
    amountsIn: {
      token: string;
      amount: string;
    }[];
    amountsOut: {
      token: string;
      amount: string;
    }[];
    calls: {
      to: string;
      data: string;
    }[];
  }) {
    const { Fr } = await import("@aztec/aztec.js");
    const emptyTokenAmount = {
      token: ethers.ZeroAddress,
      amount: "0",
    };
    const amounts_in = utils.arrayPadEnd(
      amountsIn,
      MAX_TOKENS_IN_PER_EXECUTION,
      emptyTokenAmount,
    );
    const amounts_out = utils.arrayPadEnd(
      amountsOut,
      MAX_TOKENS_OUT_PER_EXECUTION,
      emptyTokenAmount,
    );

    const execution: ExecutionStruct = {
      calls,
      amountsIn: amounts_in as ExecutionStruct["amountsIn"],
      amountsOut: amounts_out as ExecutionStruct["amountsOut"],
    };
    const execution_hash = (
      await keccak256ToFr(
        ethers.AbiCoder.defaultAbiCoder().encode(
          [
            PoolERC20__factory.createInterface().getFunction("execute")
              .inputs[1]!,
          ],
          [execution],
        ),
      )
    ).toString();
    const execution_secret = Fr.random().toString();
    const wrapped_execution_hash = (
      await poseidon2Hash([execution_hash, execution_secret])
    ).toString();

    const notesOutNotPadded = fromNotes;

    const noteHashTree = await this.getNoteHashTree();
    const nullifierTree = await this.getNullifierTree();

    const to_randomness = times(MAX_TOKENS_IN_PER_EXECUTION, () =>
      Fr.random().toString(),
    );
    const change_randomness = times(MAX_TOKENS_OUT_PER_EXECUTION, () =>
      Fr.random().toString(),
    );
    const notes_out_consumption_inputs = utils.arrayPadEnd(
      await Promise.all(
        notesOutNotPadded.map((note) =>
          this.toNoteConsumptionInputs(fromSecretKey, note),
        ),
      ),
      MAX_TOKENS_OUT_PER_EXECUTION,
      {
        note: {
          owner: ethers.ZeroHash,
          token: ethers.ZeroHash,
          value: "0",
          randomness: ethers.ZeroHash,
        },
        note_sibling_path: times(NOTE_HASH_TREE_HEIGHT, () => ethers.ZeroHash),
        note_index: "0",
        nullifier_low_leaf_preimage: {
          next_index: "0",
          next_nullifier: ethers.ZeroHash,
          nullifier: ethers.ZeroHash,
        },
        nullifier_low_leaf_membership_witness: {
          leaf_index: "0",
          sibling_path: times(NULLIFIER_TREE_HEIGHT, () => ethers.ZeroHash),
        },
      },
    );
    const emptyNoteInput = {
      noteHash: ethers.ZeroHash,
      encryptedNote: ethers.ZeroHash,
    };
    const notes_in = utils.arrayPadEnd(
      await Promise.all(
        amountsIn.map(async (amount, i) =>
          this.toNoteInput(
            await ValueNote.from({
              owner: to,
              token: amount.token,
              value: BigInt(amount.amount),
              randomness: to_randomness[i]!,
            }),
          ),
        ),
      ),
      MAX_TOKENS_IN_PER_EXECUTION,
      emptyNoteInput,
    );

    const from = await CompleteWaAddress.fromSecretKey(fromSecretKey);
    const change_notes = utils.arrayPadEnd(
      await Promise.all(
        notesOutNotPadded.map(async (note, i) => {
          const changeNote = await ValueNote.from({
            owner: from,
            token: note.token,
            value: BigInt(note.value) - BigInt(amounts_out[i]!.amount),
            randomness: change_randomness[i]!,
          });
          assert(changeNote.value >= 0n, "change note value must be positive");
          return this.toNoteInput(changeNote);
        }),
      ),
      MAX_TOKENS_OUT_PER_EXECUTION,
      emptyNoteInput,
    );
    const nullifiers = utils.arrayPadEnd(
      await Promise.all(
        notesOutNotPadded.map(async (note) => {
          return (await note.computeNullifier(fromSecretKey)).toString();
        }),
      ),
      MAX_TOKENS_OUT_PER_EXECUTION,
      ethers.ZeroHash,
    );

    const input = {
      note_hash_tree_root: ethers.hexlify(
        noteHashTree.getRoot(INCLUDE_UNCOMMITTED),
      ),
      nullifier_tree_root: nullifierTree.getRoot(),
      // accounts
      from_secret_key: fromSecretKey,
      to_address: to.address,
      // execution
      execution_hash,
      execution_secret,
      wrapped_execution_hash,
      // amounts in
      amounts_in,
      to_randomness,
      // amounts out
      amounts_out,
      notes_out: notes_out_consumption_inputs,
      change_randomness,
    };
    // console.log("input\n", JSON.stringify(input));
    const executeCircuit = (await this.circuits).execute;
    console.time("execute generateProof");
    const { witness } = await executeCircuit.noir.execute(input);
    const { proof } = await executeCircuit.backend.generateProof(witness);
    console.timeEnd("execute generateProof");

    const tx = await this.contract.execute(
      proof,
      execution,
      wrapped_execution_hash,
      notes_in as any,
      change_notes as any,
      nullifiers as any,
    );
    const receipt = await tx.wait();
    console.log("execute gas used", receipt?.gasUsed);
  }

  async toNoteConsumptionInputs(secretKey: string, note: ValueNote) {
    const { Fr } = await import("@aztec/aztec.js");
    const nullifier = await note.computeNullifier(secretKey);
    const nullifierTree = await this.getNullifierTree();
    const nullifierNmWitness =
      await nullifierTree.getNonMembershipWitness(nullifier);

    const noteHashTree = await this.getNoteHashTree();
    const noteHash = await note.hash();
    const noteIndex = noteHashTree.findLeafIndex(
      new Fr(BigInt(noteHash)),
      INCLUDE_UNCOMMITTED,
    );
    assert(noteIndex != null, "note not found");
    return {
      note: {
        owner: note.owner.address,
        token: note.token,
        value: note.value.toString(),
        randomness: note.randomness,
      },
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
  }

  async rollup() {
    const { Fr } = await import("@aztec/aztec.js");

    const pending = await this.selectTxsToRollup();
    const pendingNoteHashes = pending.noteHashes.map((h) => new Fr(BigInt(h)));
    const pendingNullifiers = pending.nullifiers.map((h) => new Fr(BigInt(h)));
    // console.log(
    //   "pendingNullifiers",
    //   pendingNullifiers.map((n) => n.toString()),
    // );
    const noteHashTreeInput = await getInsertTreeInput(
      await this.getNoteHashTree(),
      pendingNoteHashes,
    );
    const nullifierTree = await this.getNullifierTree();
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
    const rollupCircuit = (await this.circuits).rollup;
    console.time("rollup generateProof");
    const { witness } = await rollupCircuit.noir.execute(input);
    const { proof, publicInputs } =
      await rollupCircuit.backend.generateProof(witness);
    console.timeEnd("rollup generateProof");
    // {
    //   // debug
    //   console.log("publicInputs js", publicInputs.length);
    //   for (const publicInput of publicInputs) {
    //     console.log(publicInput);
    //   }
    // }

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

  async getNoteHashTree() {
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

  async toNoteInput(note: ValueNote) {
    return {
      noteHash: await note.hash(),
      encryptedNote: await note.encrypt(),
    };
  }

  private async getEmittedNotes(secretKey: string) {
    const { address } = await CompleteWaAddress.fromSecretKey(secretKey);
    const encrypted = sortEvents(
      await this.contract.queryFilter(this.contract.filters.EncryptedNotes()),
    )
      .map((e) => e.args.encryptedNotes.map((note) => note.encryptedNote))
      .flat();
    const publicKey = await this.encryption.derivePublicKey(secretKey);
    const decrypted = encrypted.map(async (encryptedNote) => {
      const note = await ValueNote.tryDecrypt(
        secretKey,
        publicKey,
        encryptedNote,
      );
      if (!note) {
        return undefined;
      }

      const noteHashRolledUp: boolean =
        (await this.contract.noteHashState(await note.hash())) ===
        NOTE_HASH_OR_NULLIFIER_STATE_ROLLED_UP;
      if (!noteHashRolledUp) {
        return undefined;
      }

      // if nullified
      const nullifier = (await note.computeNullifier(secretKey)).toString();
      const nullifierExists =
        (await this.contract.nullifierState(nullifier)) ===
        NOTE_HASH_OR_NULLIFIER_STATE_ROLLED_UP;
      if (nullifierExists) {
        return undefined;
      }

      assert(
        note.owner.address.toLowerCase() === address.toLowerCase(),
        "invalid note received",
      );

      return note;
    });
    return compact(await Promise.all(decrypted));
  }

  async getNullifierTree() {
    const { Fr } = await import("@aztec/aztec.js");

    const nullifiers = sortEventsWithIndex(
      await this.contract.queryFilter(this.contract.filters.Nullifiers()),
    ).map((x) => x.nullifiers.map((n) => new Fr(BigInt(n))));

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

export class ValueNote {
  constructor(
    readonly owner: CompleteWaAddress,
    readonly token: string,
    readonly value: bigint,
    readonly randomness: string,
  ) {}

  static async from(params: {
    owner: CompleteWaAddress;
    token: string;
    value: bigint;
    randomness: string;
  }) {
    return new ValueNote(
      params.owner,
      params.token,
      params.value,
      params.randomness,
    );
  }

  async serialize(): Promise<bigint[]> {
    return [
      BigInt(this.owner.address),
      BigInt(this.token),
      BigInt(this.value),
      BigInt(this.randomness),
    ];
  }

  static async deserialize(
    fields: bigint[],
    publicKey: string,
  ): Promise<ValueNote> {
    const fieldsStr = fields.map((x) => ethers.toBeArray(x));
    return new ValueNote(
      new CompleteWaAddress(ethers.zeroPadValue(fieldsStr[0]!, 32), publicKey),
      ethers.zeroPadValue(fieldsStr[1]!, 20),
      fields[2]!,
      ethers.zeroPadValue(fieldsStr[3]!, 32),
    );
  }

  async hash() {
    return (await poseidon2Hash(await this.serialize())).toString();
  }

  async computeNullifier(secretKey: string) {
    assert(
      (await CompleteWaAddress.fromSecretKey(secretKey)).equal(this.owner),
      "invalid nullifier secret key",
    );
    return await poseidon2Hash([
      GENERATOR_INDEX__NOTE_NULLIFIER,
      await this.hash(),
      secretKey,
    ]);
  }

  static async empty() {
    return await ValueNote.from({
      owner: new CompleteWaAddress(ethers.ZeroHash, ethers.ZeroHash),
      token: ethers.ZeroHash,
      value: 0n,
      randomness: ethers.ZeroHash,
    });
  }

  async encrypt() {
    const serialized = await this.serialize();
    const hex = ethers.AbiCoder.defaultAbiCoder().encode(
      times(serialized.length, () => "uint256"),
      serialized,
    );
    return await EncryptionService.getSingleton().encrypt(
      this.owner.publicKey,
      hex,
    );
  }

  static async tryDecrypt(
    secretKey: string,
    publicKey: string,
    encryptedNote: string,
  ) {
    const encryption = EncryptionService.getSingleton();
    let hex: string;
    try {
      hex = await encryption.decrypt(secretKey, encryptedNote);
    } catch (e) {
      return undefined;
    }
    const fields = ethers.AbiCoder.defaultAbiCoder().decode(
      times(await ValueNote.serializedLength(), () => "uint256"),
      hex,
    );
    return await ValueNote.deserialize(fields, publicKey);
  }

  static async serializedLength() {
    return (await (await ValueNote.empty()).serialize()).length;
  }
}

export type WaAddress = string;

export class CompleteWaAddress {
  constructor(
    readonly address: WaAddress,
    readonly publicKey: string,
  ) {}

  toString() {
    return ethers.concat([this.address, this.publicKey]);
  }

  static fromString(str: string) {
    const bytes = ethers.getBytes(str);
    utils.assert(bytes.length === 64, "invalid complete address");
    const address = ethers.dataSlice(bytes, 0, 32);
    const publicKey = ethers.dataSlice(bytes, 32, 64);
    return new CompleteWaAddress(address, publicKey);
  }

  static async fromSecretKey(secretKey: string) {
    const address = (
      await poseidon2Hash([GENERATOR_INDEX__WA_ADDRESS, secretKey])
    ).toString();
    const publicKey =
      await EncryptionService.getSingleton().derivePublicKey(secretKey);
    return new CompleteWaAddress(address, publicKey);
  }

  equal(other: CompleteWaAddress) {
    return (
      utils.isAddressEqual(this.address, other.address) &&
      this.publicKey === other.publicKey
    );
  }
}

type NoirAndBackend = {
  noir: Noir;
  backend: UltraPlonkBackend;
};

export async function poseidon2Hash(inputs: (bigint | string | number)[]) {
  // I hate hardhat
  const { poseidon2Hash } = await import("@aztec/foundation/crypto");
  return poseidon2Hash(inputs.map((x) => BigInt(x)));
}

async function createMerkleTree(height: number) {
  const { StandardTree, newTree, Poseidon } = await import(
    "@aztec/merkle-tree"
  );

  const { Fr } = await import("@aztec/aztec.js");
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
function sortEvents<
  T extends {
    blockNumber: number;
    transactionIndex: number;
    index: number;
  },
>(events: T[]) {
  return orderBy(
    events,
    (e) => `${e.blockNumber}-${e.transactionIndex}-${e.index}`,
  );
}
