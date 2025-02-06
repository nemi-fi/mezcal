import type { CompiledCircuit, InputMap } from "@noir-lang/noir_js";
import { ethers } from "ethers";
import fs from "node:fs";
import path from "node:path";
import toml from "smol-toml";
import { z } from "zod";

export class MpcProverService {
  async prove(params: {
    circuit: CompiledCircuit;
    input0: InputMap;
    input1: InputMap;
    inputPublic: InputMap;
    // TODO: infer number of public inputs
    numPublicInputs: number;
  }) {
    const id = crypto.randomUUID();
    const workingDir = path.join(__dirname, "work-dirs", id);
    fs.mkdirSync(workingDir, { recursive: true });
    try {
      fs.writeFileSync(
        path.join(workingDir, "Prover1.toml"),
        // merge public inputs into first prover because it does not matter which one public inputs are in
        toml.stringify({ ...params.input0, ...params.inputPublic }),
      );
      fs.writeFileSync(
        path.join(workingDir, "Prover2.toml"),
        toml.stringify(params.input1),
      );

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
    } finally {
      fs.rmSync(workingDir, { recursive: true });
    }
  }
}

const makeRunCommand = (cwd?: string) => async (command: string) => {
  const { exec } = await import("child_process");
  const { promisify } = await import("util");
  const execAsync = promisify(exec);
  // TODO(security): escape command arguments (use spawn)
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd,
      maxBuffer: Infinity,
    });
    if (stdout) {
      console.log(stdout);
    }
    if (stderr) {
      console.error(stderr);
    }
  } catch (error) {
    console.error(`Error executing command: ${command}`);
    console.error((error as any).stderr || (error as any).message);
    throw new Error(`Error executing command: ${command}`);
  }
};
