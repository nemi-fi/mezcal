import { ethers } from "ethers";
import { mapValues } from "lodash-es";
import type { AsyncOrSync } from "ts-essentials";
import type { PoolERC20 } from "../typechain-types/index.js";
import { EncryptionService } from "./EncryptionService.js";
import { RollupService } from "./RollupOnlyService.js";
import { PoolErc20Service } from "./RollupService.js";
import { TreesService } from "./TreesService.js";

export * from "./EncryptionService.js";
export * from "./NonMembershipTree.js";
export * from "./RollupService.js";
export * from "./TreesService.js";

export function createInterfaceSdk(
  contract: PoolERC20,
  compiledCircuits: Record<
    "shield" | "unshield" | "join" | "transfer" | "execute" | "rollup",
    AsyncOrSync<CompiledCircuit>
  >,
) {
  const trees = new TreesService(contract);
  const encryption = EncryptionService.getSingleton();
  const circuits = ethers.resolveProperties(
    mapValues(compiledCircuits, getCircuit),
  );
  const poolErc20 = new PoolErc20Service(contract, encryption, trees, circuits);
  const rollup = new RollupService(contract, trees, circuits);
  return {
    trees,
    poolErc20,
    rollup,
    encryption,
  };
}

export type CompiledCircuit = {
  bytecode: string;
  abi: any;
};

async function getCircuit(artifact: AsyncOrSync<CompiledCircuit>) {
  const { Noir } = await import("@noir-lang/noir_js");
  const { UltraPlonkBackend } = await import("@aztec/bb.js");
  artifact = await artifact;
  const noir = new Noir(artifact);
  const backend = new UltraPlonkBackend(artifact.bytecode);
  return { noir, backend };
}
