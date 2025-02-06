import type { CompiledCircuit } from "@noir-lang/noir_js";
import { ethers } from "ethers";
import { range } from "lodash";
import fs from "node:fs";
import path from "node:path";
import { assert } from "ts-essentials";
import { z } from "zod";
import { inWorkingDir, makeRunCommand } from "./utils.js";

export class MpcProverService {
  async proveAsParty(params: {
    partyIndex: number;
    circuit: CompiledCircuit;
    input0Shared: string;
    input1Shared: string;
    // TODO: infer number of public inputs
    numPublicInputs: number;
  }) {
    return await inWorkingDir(async (workingDir) => {
      for (const [traderIndex, inputShared] of [
        params.input0Shared,
        params.input1Shared,
      ].entries()) {
        fs.writeFileSync(
          path.join(
            workingDir,
            `Prover${traderIndex}.toml.${params.partyIndex}.shared`,
          ),
          ethers.getBytes(inputShared),
        );
      }

      const circuitPath = path.join(workingDir, "circuit.json");
      fs.writeFileSync(circuitPath, JSON.stringify(params.circuit));

      const runCommand = makeRunCommand(__dirname);
      await runCommand(
        `./run-party.sh ${workingDir} ${circuitPath} ${params.partyIndex}`,
      );

      const publicInputs = z
        .string()
        .array()
        .parse(
          JSON.parse(
            fs.readFileSync(
              path.join(workingDir, "public_input.json"),
              "utf-8",
            ),
          ),
        );
      const proofData = Uint8Array.from(
        fs.readFileSync(
          path.join(workingDir, `proof.${params.partyIndex}.proof`),
        ),
      );
      // arcane magic
      const proof = ethers.getBytes(
        ethers.concat([
          proofData.slice(0, 2),
          proofData.slice(6, 100),
          proofData.slice(100 + params.numPublicInputs * 32),
        ]),
      );
      // console.log("proof native\n", JSON.stringify(Array.from(proof)));
      return { proof, publicInputs };
    });
  }

  async prove(params: {
    circuit: CompiledCircuit;
    inputs0Shared: string[];
    inputs1Shared: string[];
    // TODO: infer number of public inputs
    numPublicInputs: number;
  }) {
    assert(
      params.inputs0Shared.length === params.inputs1Shared.length,
      "inputs length mismatch",
    );
    const proofs = await Promise.all(
      range(params.inputs0Shared.length).map(async (i) => {
        const input0Shared = params.inputs0Shared[i]!;
        const input1Shared = params.inputs1Shared[i]!;
        return await this.proveAsParty({
          partyIndex: i,
          circuit: params.circuit,
          input0Shared,
          input1Shared,
          numPublicInputs: params.numPublicInputs,
        });
      }),
    );
    return proofs[0]!;
  }
}
