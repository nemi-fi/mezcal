import type { CompiledCircuit } from "@noir-lang/noir_js";
import { ethers } from "ethers";
import { mapValues } from "lodash-es";
import type { AsyncOrSync } from "ts-essentials";
import type { PoolERC20 } from "../typechain-types/index.js";
import { EncryptionService } from "./EncryptionService.js";
import { LobService } from "./LobService.js";
import { MpcProverService } from "./mpc/MpcNetworkService.js";
import { PoolErc20Service } from "./PoolErc20Service.js";
import { type ITreesService } from "./RemoteTreesService.js";

export * from "./EncryptionService.js";
export * from "./NonMembershipTree.js";
export * from "./PoolErc20Service.js";
export * from "./RemoteTreesService.js";
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
  const mpcProver = new MpcProverService();
  const lob = new LobService(
    coreSdk.contract,
    trees,
    poolErc20,
    mpcProver,
    circuits,
  );

  return {
    poolErc20,
    lob,
  };
}

async function getCircuit(artifact: AsyncOrSync<CompiledCircuit>) {
  const { Noir } = await import("@noir-lang/noir_js");
  const { UltraHonkBackend } = await import("@aztec/bb.js");
  artifact = await artifact;
  const noir = new Noir(artifact);
  const backend = new UltraHonkBackend(artifact.bytecode);
  return { circuit: artifact, noir, backend };
}
