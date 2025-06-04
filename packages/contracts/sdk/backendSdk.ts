import { UltraHonkBackend } from "@aztec/bb.js";
import type { CompiledCircuit } from "@noir-lang/noir_js";
import { utils } from "@repo/utils";
import os from "node:os";
import type { AsyncOrSync } from "ts-essentials";
import { NativeUltraHonkBackend } from "./NativeUltraHonkBackend";
import { RollupService } from "./RollupOnlyService";
import { createCoreSdk } from "./sdk";
import type { TreesService } from "./TreesService";

export function createBackendSdk(
  coreSdk: ReturnType<typeof createCoreSdk>,
  trees: TreesService,
  compiledCircuits: Record<"rollup", AsyncOrSync<CompiledCircuit>>,
) {
  const rollup = new RollupService(coreSdk.contract, trees, {
    rollup: utils.iife(async () => {
      const { Noir } = await import("@noir-lang/noir_js");
      const circuit = await compiledCircuits.rollup;
      const noir = new Noir(circuit);
      const backend = process.env.CI
        ? new UltraHonkBackend(circuit.bytecode, { threads: os.cpus().length })
        : (new NativeUltraHonkBackend(
            `${process.env.HOME}/.bb/bb`,
            circuit,
          ) as unknown as UltraHonkBackend);
      return { noir, backend };
    }),
  });
  return {
    rollup,
  };
}
