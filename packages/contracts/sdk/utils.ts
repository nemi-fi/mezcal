import type { Fr } from "@aztec/aztec.js";
import { ethers } from "ethers";
import { assert } from "ts-essentials";

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
