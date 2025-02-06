import { utils } from "@repo/utils";
import os from "node:os";
import type { AsyncOrSync } from "ts-essentials";
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
      const { UltraHonkBackend } = await import("@aztec/bb.js");
      const noir = new Noir(await compiledCircuits.rollup);
      // TODO(perf): write and use a NativeUltraHonkBackend
      // const backend = new NativeUltraPlonkBackend(
      //   `${process.env.HOME}/.bb/bb`,
      //   await compiledCircuits.rollup,
      // ) as unknown as UltraPlonkBackend;
      const backend = new UltraHonkBackend(
        (await compiledCircuits.rollup).bytecode,
        { threads: os.cpus().length },
      );
      return { noir, backend };
    }),
  });
  return {
    rollup,
  };
}
