import type { Fr } from "@aztec/aztec.js";
import type { UltraPlonkBackend } from "@aztec/bb.js";
import type { Noir } from "@noir-lang/noir_js";
import { utils } from "@repo/utils";
import { ethers } from "ethers";
import { compact, isEqual, orderBy, times } from "lodash-es";
import { assert, type AsyncOrSync } from "ts-essentials";
import { PoolERC20__factory, type PoolERC20 } from "../typechain-types";
import type { ExecutionStruct } from "../typechain-types/contracts/PoolERC20";
import { EncryptionService } from "./EncryptionService";
import type { ITreesService } from "./RemoteTreesService";
import { fromNoirU256, keccak256ToFr, toNoirU256, U256_LIMBS } from "./utils";

// Note: keep in sync with other languages
export const NOTE_HASH_TREE_HEIGHT = 40;
// Note: keep in sync with other languages
export const NOTE_HASH_SUBTREE_HEIGHT = 6;
// Note: keep in sync with other languages
export const MAX_NOTES_PER_ROLLUP = 64;
// Note: keep in sync with other languages
export const NULLIFIER_TREE_HEIGHT = 40;
// Note: keep in sync with other languages
export const NULLIFIER_SUBTREE_HEIGHT = 6;
// Note: keep in sync with other languages
export const MAX_NULLIFIERS_PER_ROLLUP = 64;

// Note: keep in sync with other languages
const GENERATOR_INDEX__WA_ADDRESS = 1;
// Note: keep in sync with other languages
const GENERATOR_INDEX__NOTE_NULLIFIER = 2;

// Note: keep in sync with other languages
export const MAX_TOKENS_IN_PER_EXECUTION = 4;
// Note: keep in sync with other languages
export const MAX_TOKENS_OUT_PER_EXECUTION = 4;

// Note: keep in sync with other languages
export const NOTE_HASH_OR_NULLIFIER_STATE_NOT_EXISTS = 0n;
// Note: keep in sync with other languages
export const NOTE_HASH_OR_NULLIFIER_STATE_PENDING = 1n;
// Note: keep in sync with other languages
const NOTE_HASH_OR_NULLIFIER_STATE_ROLLED_UP = 2n;

// Note: keep in sync with other languages
const MAX_NOTES_TO_JOIN = 2;

export const INCLUDE_UNCOMMITTED = true;

export class PoolErc20Service {
  constructor(
    readonly contract: PoolERC20,
    private encryption: EncryptionService,
    private trees: ITreesService,
    private circuits: AsyncOrSync<{
      shield: NoirAndBackend;
      unshield: NoirAndBackend;
      join: NoirAndBackend;
      transfer: NoirAndBackend;
      execute: NoirAndBackend;
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
      value: toNoirU256(note.value),
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

    const nullifier = await fromNote.computeNullifier(secretKey);

    const unshieldCircuit = (await this.circuits).unshield;
    console.time("unshield generateProof");
    const { witness } = await unshieldCircuit.noir.execute({
      tree_roots: await this.trees.getTreeRoots(),
      from_secret_key: secretKey,
      from_note_inputs: await this.toNoteConsumptionInputs(secretKey, fromNote),
      to,
      amount: await (
        await TokenAmount.from({
          amount,
          token,
        })
      ).toNoir(),
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
      tree_roots: await this.trees.getTreeRoots(),
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

    const nullifier = await fromNote.computeNullifier(secretKey);

    const to_randomness = Fr.random().toString();
    const change_randomness = Fr.random().toString();
    const input = {
      tree_roots: await this.trees.getTreeRoots(),
      from_note_inputs: await this.toNoteConsumptionInputs(secretKey, fromNote),
      from_secret_key: secretKey,
      to: to.address,
      amount: toNoirU256(amount),
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
          value: { limbs: times(U256_LIMBS, () => "0") },
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
      tree_roots: await this.trees.getTreeRoots(),
      // accounts
      from_secret_key: fromSecretKey,
      to_address: to.address,
      // execution
      execution_hash,
      execution_secret,
      wrapped_execution_hash,
      // amounts in
      amounts_in: await Promise.all(
        amounts_in.map(
          async (amount) =>
            await (
              await TokenAmount.from({
                token: amount.token,
                amount: BigInt(amount.amount),
              })
            ).toNoir(),
        ),
      ),
      to_randomness,
      // amounts out
      amounts_out: await Promise.all(
        amounts_out.map(
          async (amount) =>
            await (
              await TokenAmount.from({
                token: amount.token,
                amount: BigInt(amount.amount),
              })
            ).toNoir(),
        ),
      ),
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
    const nullifier = await note.computeNullifier(secretKey);
    const noteConsumptionInputs = await this.trees.getNoteConsumptionInputs({
      noteHash: await note.hash(),
      nullifier: nullifier.toString(),
    });
    return {
      ...noteConsumptionInputs,
      note: await note.toNoir(),
    };
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

  async toNoir() {
    return {
      owner: this.owner.address,
      token: this.token,
      value: toNoirU256(this.value),
      randomness: this.randomness,
    };
  }

  async serialize(): Promise<bigint[]> {
    const value = toNoirU256(this.value);
    return [
      BigInt(this.owner.address),
      BigInt(this.token),
      ...value.limbs.map((x) => BigInt(x)),
      BigInt(this.randomness),
    ];
  }

  static async deserialize(
    fields: bigint[],
    publicKey: string,
  ): Promise<ValueNote> {
    const fieldsStr = fields.map((x) => ethers.toBeArray(x));
    return await ValueNote.from({
      owner: new CompleteWaAddress(
        ethers.zeroPadValue(fieldsStr[0]!, 32),
        publicKey,
      ),
      token: ethers.zeroPadValue(fieldsStr[1]!, 20),
      value: fromNoirU256({ limbs: fields.slice(2, 2 + U256_LIMBS) }),
      randomness: ethers.zeroPadValue(fieldsStr[2 + U256_LIMBS]!, 32),
    });
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

export class TokenAmount {
  constructor(
    readonly token: string,
    readonly amount: bigint,
  ) {}

  static async from(params: { token: string; amount: bigint }) {
    return new TokenAmount(params.token, params.amount);
  }

  async toNoir() {
    return {
      token: this.token,
      amount: toNoirU256(this.amount),
    };
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

export type NoirAndBackend = {
  noir: Noir;
  backend: UltraPlonkBackend;
};

export async function poseidon2Hash(inputs: (bigint | string | number)[]) {
  // @ts-ignore hardhat does not support ESM
  const { poseidon2Hash } = await import("@aztec/foundation/crypto");
  return poseidon2Hash(inputs.map((x) => BigInt(x))) as Fr;
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
