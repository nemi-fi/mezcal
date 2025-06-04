import type { Fr } from "@aztec/aztec.js";
import type { InputMap } from "@noir-lang/noir_js";
import { ethers } from "ethers";
import { chunk } from "lodash-es";
import fs from "node:fs";
import path from "node:path";
import { Hex } from "ox";
import { assert } from "ts-essentials";
import type { NoirAndBackend } from "./sdk.js";

export function printPublicInputs(publicInputs: string[]) {
  console.log("publicInputs js", publicInputs.length);
  for (const publicInput of publicInputs) {
    console.log(publicInput);
  }
  console.log();
}

export async function keccak256ToFr(value: string): Promise<Fr> {
  const { Fr } = await import("@aztec/aztec.js");
  // @ts-ignore
  const { truncateAndPad } = await import("@aztec/foundation/serialize");
  const hash = ethers.keccak256(value);
  return Fr.fromBuffer(truncateAndPad(Buffer.from(ethers.getBytes(hash))));
}

function splitBigIntToLimbs(
  bigInt: bigint,
  limbSize: number,
  numLimbs: number,
): bigint[] {
  const limbs: bigint[] = [];
  const mask = (1n << BigInt(limbSize)) - 1n;
  for (let i = 0; i < numLimbs; i++) {
    const limb = (bigInt / (1n << (BigInt(i) * BigInt(limbSize)))) & mask;
    limbs.push(limb);
  }
  return limbs;
}

function unsplitBigIntFromLimbs(limbs: bigint[], limbSize: number): bigint {
  let bigInt = 0n;
  for (let i = 0; i < limbs.length; i++) {
    bigInt += limbs[i]! << (BigInt(i) * BigInt(limbSize));
  }
  return bigInt;
}

// Note: keep in sync with other languages
export const U256_LIMBS = 3;
// Note: keep in sync with other languages
export const U256_LIMB_SIZE = 120;

export function toNoirU256(value: bigint) {
  assert(value >= 0n && value < 2n ** 256n, "invalid U256 value");
  const limbs = splitBigIntToLimbs(value, U256_LIMB_SIZE, U256_LIMBS).map(
    (x) => "0x" + x.toString(16),
  );
  return { limbs };
}

export function fromNoirU256(value: { limbs: (bigint | string)[] }) {
  assert(value.limbs.length === U256_LIMBS, "invalid U256 limbs");
  return unsplitBigIntFromLimbs(
    value.limbs.map((x) => BigInt(x)),
    120,
  );
}

export async function prove(
  name: string,
  { noir, backend }: NoirAndBackend,
  input: InputMap,
) {
  console.time(`${name} generateProof`);
  const { witness, returnValue } = await noir.execute(input);
  let { proof, publicInputs } = await backend.generateProof(witness, {
    keccak: true,
  });
  console.timeEnd(`${name} generateProof`);
  return { proof, witness, returnValue, publicInputs };
}

export function readNativeHonkProof(pathToProofDir: string) {
  const proof = fs.readFileSync(path.join(pathToProofDir, "proof"));
  const publicInputs = fs.readFileSync(
    path.join(pathToProofDir, "public_inputs"),
  );
  assert(
    publicInputs.length % 32 === 0,
    "publicInputs length must be divisible by 32",
  );
  return {
    proof,
    // TODO: not sure if this publicInputs decoding is correct
    publicInputs: chunk(Array.from(publicInputs), 32).map((x) =>
      Hex.fromBytes(Uint8Array.from(x)),
    ),
  };
}
