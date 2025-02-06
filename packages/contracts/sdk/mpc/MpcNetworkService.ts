import type { CompiledCircuit } from "@noir-lang/noir_js";
import { ethers } from "ethers";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { inWorkingDir, makeRunCommand } from "./utils.js";

export class MpcProverService {
  async prove(params: {
    circuit: CompiledCircuit;
    inputs0Shared: string[];
    inputs1Shared: string[];
    // TODO: infer number of public inputs
    numPublicInputs: number;
  }) {
    return await inWorkingDir(async (workingDir) => {
      for (const [traderIndex, inputsShared] of [
        params.inputs0Shared,
        params.inputs1Shared,
      ].entries()) {
        for (const [partyIndex, inputShared] of inputsShared.entries()) {
          fs.writeFileSync(
            path.join(
              workingDir,
              `Prover${traderIndex}.toml.${partyIndex}.shared`,
            ),
            ethers.getBytes(inputShared),
          );
        }
      }

      const circuitPath = path.join(workingDir, "circuit.json");
      fs.writeFileSync(circuitPath, JSON.stringify(params.circuit));

      const runCommand = makeRunCommand(__dirname);
      await runCommand(`./run.sh ${workingDir} ${circuitPath}`);

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
        fs.readFileSync(path.join(workingDir, "proof.0.proof")),
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
}
