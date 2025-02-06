import { ethers } from "ethers";
import { mapValues } from "lodash-es";
import type { AsyncOrSync } from "ts-essentials";
import type { PoolERC20 } from "../typechain-types/index.js";
import { EncryptionService } from "./EncryptionService.js";
import { LobService } from "./LobService.js";
import { type ITreesService } from "./RemoteTreesService.js";
import { PoolErc20Service } from "./RollupService.js";

export * from "./EncryptionService.js";
export * from "./NonMembershipTree.js";
export * from "./RemoteTreesService.js";
export * from "./RollupService.js";
export * from "./TreesService.js";

export function createCoreSdk(contract: PoolERC20) {
  const encryption = EncryptionService.getSingleton();
  return {
    contract,
    encryption,
  };
}

export function createInterfaceSdk(
  coreSdk: ReturnType<typeof createCoreSdk>,
  trees: ITreesService,
  compiledCircuits: Record<
    "shield" | "unshield" | "join" | "transfer" | "swap",
    AsyncOrSync<CompiledCircuit>
  >,
) {
  const circuits = ethers.resolveProperties(
    mapValues(compiledCircuits, getCircuit),
  );
  const poolErc20 = new PoolErc20Service(
    coreSdk.contract,
    coreSdk.encryption,
    trees,
    circuits,
  );
  const lob = new LobService(coreSdk.contract, trees, poolErc20, circuits);

  return {
    poolErc20,
    lob,
  };
}

export type CompiledCircuit = {
  bytecode: string;
  abi: any;
};

async function getCircuit(artifact: AsyncOrSync<CompiledCircuit>) {
  const { Noir } = await import("@noir-lang/noir_js");
  const { UltraHonkBackend } = await import("@aztec/bb.js");
  artifact = await artifact;
  const noir = new Noir(artifact);
  const backend = new UltraHonkBackend(artifact.bytecode);
  return { noir, backend };
}
