import type { Fr } from "@aztec/aztec.js";
import { ethers } from "ethers";
import ky from "ky";
import { assert } from "ts-essentials";
import { route } from "./ROUTES";

// TODO: move to a service
export function requestRollup() {
  return ky.post(route("POST /api/rollup"));
}

export function printPublicInputs(publicInputs: string[]) {
  console.log("publicInputs js", publicInputs.length);
  for (const publicInput of publicInputs) {
    console.log(publicInput);
  }
  console.log();
}

export async function keccak256ToFr(value: string): Promise<Fr> {
  const { Fr } = await import("@aztec/aztec.js");
  const { truncateAndPad } = await import("@aztec/foundation/serialize");
  const hash = ethers.keccak256(value);
  return Fr.fromBuffer(truncateAndPad(Buffer.from(ethers.getBytes(hash))));
}

export function splitBigIntToChunks(
  bigInt: bigint,
  chunkSize: number,
  numChunks: number,
): bigint[] {
  const chunks: bigint[] = [];
  const mask = (1n << BigInt(chunkSize)) - 1n;
  for (let i = 0; i < numChunks; i++) {
    const chunk = (bigInt / (1n << (BigInt(i) * BigInt(chunkSize)))) & mask;
    chunks.push(chunk);
  }
  return chunks;
}

function unsplitBigIntFromChunks(chunks: bigint[], chunkSize: number): bigint {
  let bigInt = 0n;
  for (let i = 0; i < chunks.length; i++) {
    bigInt += chunks[i]! << (BigInt(i) * BigInt(chunkSize));
  }
  return bigInt;
}

// Note: keep in sync with other languages
export const U256_LIMBS = 3;
// Note: keep in sync with other languages
export const U256_CHUNK_SIZE = 120;

export function toNoirU256(value: bigint) {
  assert(value >= 0n && value < 2n ** 256n, "invalid U256 value");
  const limbs = splitBigIntToChunks(value, U256_CHUNK_SIZE, U256_LIMBS).map(
    (x) => "0x" + x.toString(16),
  );
  return { limbs };
}

export function fromNoirU256(value: { limbs: (bigint | string)[] }) {
  assert(value.limbs.length === U256_LIMBS, "invalid U256 chunks");
  return unsplitBigIntFromChunks(
    value.limbs.map((x) => BigInt(x)),
    120,
  );
}
