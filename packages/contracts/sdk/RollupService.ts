import type { Fr } from "@aztec/aztec.js";
import type { UltraHonkBackend } from "@aztec/bb.js";
import type { Noir } from "@noir-lang/noir_js";
import { utils } from "@repo/utils";
import { ethers } from "ethers";
import { compact, orderBy, times } from "lodash-es";
import { assert, type AsyncOrSync } from "ts-essentials";
import { type PoolERC20 } from "../typechain-types";
import { EncryptionService } from "./EncryptionService";
import type { ITreesService } from "./RemoteTreesService";
import { fromNoirU256, prove, toNoirU256, U256_LIMBS } from "./utils.js";

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
    const note = await Erc20Note.from({
      owner: await CompleteWaAddress.fromSecretKey(secretKey),
      amount: await TokenAmount.from({
        token: await ethers.resolveAddress(token),
        amount,
      }),
      randomness,
    });
    const noteInput = await this.toNoteInput(note);
    const shieldCircuit = (await this.circuits).shield;
    const input = {
      tree_roots: await this.trees.getTreeRoots(),
      owner: { inner: note.owner.address },
      amount: await note.amount.toNoir(),
      randomness: note.randomness,
      note_hash: noteInput.noteHash,
    };
    const { proof } = await prove("shield", shieldCircuit, input);
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
    fromNote: Erc20Note;
    token: string;
    to: string;
    amount: bigint;
  }) {
    const { Fr } = await import("@aztec/aztec.js");

    assert(utils.isAddressEqual(token, fromNote.amount.token), "invalid token");
    const change_randomness = Fr.random().toString();
    const changeNote = await Erc20Note.from({
      owner: fromNote.owner,
      amount: await TokenAmount.from({
        token: fromNote.amount.token,
        amount: fromNote.amount.amount - amount,
      }),
      randomness: change_randomness,
    });
    assert(changeNote.amount.amount >= 0n, "invalid change note");

    const nullifier = await fromNote.computeNullifier(secretKey);

    const unshieldCircuit = (await this.circuits).unshield;
    const input = {
      tree_roots: await this.trees.getTreeRoots(),
      from_secret_key: secretKey,
      from_note_inputs: await this.toNoteConsumptionInputs(secretKey, fromNote),
      to: { inner: to },
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
    };
    const { proof } = await prove("unshield", unshieldCircuit, input);
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

  async join({
    secretKey,
    notes,
    to,
  }: {
    secretKey: string;
    notes: Erc20Note[];
    to?: WaAddress;
  }) {
    const { Fr } = await import("@aztec/aztec.js");
    assert(notes.length === MAX_NOTES_TO_JOIN, "invalid notes length");

    const join_randomness = Fr.random().toString();

    to ??= (
      await CompleteWaAddress.fromSecretKey(secretKey)
    ).address.toString();

    const joinCircuit = (await this.circuits).join;
    const input = {
      tree_roots: await this.trees.getTreeRoots(),
      from_secret_key: secretKey,
      join_randomness,
      to: { inner: to },
      notes: await Promise.all(
        notes.map((note) => this.toNoteConsumptionInputs(secretKey, note)),
      ),
    };
    const { proof } = await prove("join", joinCircuit, input);

    const joinNote = await Erc20Note.from({
      owner: await CompleteWaAddress.fromSecretKey(secretKey),
      amount: await TokenAmount.from({
        token: notes[0]!.amount.token,
        amount: notes.reduce((acc, note) => acc + note.amount.amount, 0n),
      }),
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
    fromNote: Erc20Note;
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
      to: { inner: to.address },
      amount: toNoirU256(amount),
      to_randomness,
      change_randomness,
    };
    const changeNote = await Erc20Note.from({
      owner: fromNote.owner,
      amount: await TokenAmount.from({
        token: fromNote.amount.token,
        amount: fromNote.amount.amount - amount,
      }),
      randomness: change_randomness,
    });
    assert(changeNote.amount.amount >= 0n, "invalid change note");
    const toNote = await Erc20Note.from({
      owner: to,
      amount: await TokenAmount.from({
        token: fromNote.amount.token,
        amount,
      }),
      randomness: to_randomness,
    });
    // console.log("input\n", JSON.stringify(input));
    const transferCircuit = (await this.circuits).transfer;
    const { proof } = await prove("transfer", transferCircuit, input);

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

  async balanceOfNew(token: ethers.AddressLike, secretKey: string) {
    const notes = await this.getBalanceNotesOf(token, secretKey);
    const balance = notes.reduce((acc, note) => acc + note.amount.amount, 0n);
    return [balance, notes] as const;
  }

  /** @deprecated use .balanceOfNew */
  async balanceOf(token: ethers.AddressLike, secretKey: string) {
    const notes = await this.getBalanceNotesOf(token, secretKey);
    return notes.reduce((acc, note) => acc + note.amount.amount, 0n);
  }

  async getBalanceNotesOf(token: ethers.AddressLike, secretKey: string) {
    token = await ethers.resolveAddress(token);
    const notes = await this.getEmittedNotes(secretKey);
    return notes.filter(
      (note) => note.amount.token.toLowerCase() === token.toLowerCase(),
    );
  }

  async toNoteConsumptionInputs(secretKey: string, note: Erc20Note) {
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

  async toNoteInput(note: Erc20Note) {
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
      const note = await Erc20Note.tryDecrypt(
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

export class Erc20Note {
  constructor(
    readonly owner: CompleteWaAddress,
    readonly amount: TokenAmount,
    readonly randomness: string,
  ) {}

  static async from(params: {
    owner: CompleteWaAddress;
    amount: TokenAmount;
    randomness: string;
  }) {
    return new Erc20Note(params.owner, params.amount, params.randomness);
  }

  async toNoir() {
    return {
      owner: { inner: this.owner.address },
      amount: await this.amount.toNoir(),
      randomness: this.randomness,
    };
  }

  async serialize(): Promise<bigint[]> {
    const amount = await this.amount.toNoir();
    return [
      BigInt(this.owner.address),
      BigInt(this.amount.token),
      ...amount.amount.limbs.map((x) => BigInt(x)),
      BigInt(this.randomness),
    ];
  }

  static async deserialize(
    fields: bigint[],
    publicKey: string,
  ): Promise<Erc20Note> {
    const fieldsStr = fields.map((x) => ethers.toBeArray(x));
    return await Erc20Note.from({
      owner: new CompleteWaAddress(
        ethers.zeroPadValue(fieldsStr[0]!, 32),
        publicKey,
      ),
      amount: await TokenAmount.from({
        token: ethers.zeroPadValue(fieldsStr[1]!, 20),
        amount: fromNoirU256({ limbs: fields.slice(2, 2 + U256_LIMBS) }),
      }),
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
    return await Erc20Note.from({
      owner: new CompleteWaAddress(ethers.ZeroHash, ethers.ZeroHash),
      amount: await TokenAmount.empty(),
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
      times(await Erc20Note.serializedLength(), () => "uint256"),
      hex,
    );
    return await Erc20Note.deserialize(fields, publicKey);
  }

  static async serializedLength() {
    return (await (await Erc20Note.empty()).serialize()).length;
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

  static async empty(): Promise<TokenAmount> {
    return await TokenAmount.from({ token: ethers.ZeroHash, amount: 0n });
  }

  async toNoir() {
    return {
      token: { inner: this.token },
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
  backend: UltraHonkBackend;
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
