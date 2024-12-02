import type { UltraPlonkBackend } from "@aztec/bb.js";
import { utils } from "@repo/utils";
import type { AsyncOrSync } from "ts-essentials";
import { NativeUltraPlonkBackend } from "./NativeUltraPlonkBackend";
import { RollupService } from "./RollupOnlyService";
import { type CompiledCircuit, createCoreSdk } from "./sdk";
import type { TreesService } from "./TreesService";

export function createBackendSdk(
  coreSdk: ReturnType<typeof createCoreSdk>,
  trees: TreesService,
  compiledCircuits: Record<"rollup", AsyncOrSync<CompiledCircuit>>,
) {
  const rollup = new RollupService(coreSdk.contract, trees, {
    rollup: utils.iife(async () => {
      const { Noir } = await import("@noir-lang/noir_js");
      const noir = new Noir(await compiledCircuits.rollup);
      const backend = new NativeUltraPlonkBackend(
        `${process.env.HOME}/.bb/bb`,
        await compiledCircuits.rollup,
      ) as unknown as UltraPlonkBackend;
      return { noir, backend };
    }),
  });
  return {
    rollup,
  };
}
