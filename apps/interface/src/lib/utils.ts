import type { Fr } from "@aztec/aztec.js";
import { ethers } from "ethers";
import ky from "ky";
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
