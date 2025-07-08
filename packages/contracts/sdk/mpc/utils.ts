import type { CompiledCircuit, InputMap } from "@noir-lang/noir_js";
import { ethers } from "ethers";
import { range } from "lodash";
import fs from "node:fs";
import path from "node:path";
import toml from "smol-toml";
import type { PartyIndex } from "./MpcNetworkService.js";

export async function splitInput(circuit: CompiledCircuit, input: InputMap) {
  return await inWorkingDir(async (workingDir) => {
    const proverPath = path.join(workingDir, "ProverX.toml");
    fs.writeFileSync(proverPath, toml.stringify(input));
    const circuitPath = path.join(workingDir, "circuit.json");
    fs.writeFileSync(circuitPath, JSON.stringify(circuit));
    const runCommand = makeRunCommand(__dirname);
    await runCommand("./split-inputs.sh", [proverPath, circuitPath]);
    const shared = range(3).map((i) => {
      const x = Uint8Array.from(fs.readFileSync(`${proverPath}.${i}.shared`));
      return ethers.hexlify(x);
    });
    return Array.from(shared.entries()).map(([partyIndex, inputShared]) => ({
      partyIndex: partyIndex as PartyIndex,
      inputShared,
    }));
  });
}

export async function inWorkingDir<T>(f: (workingDir: string) => Promise<T>) {
  const id = crypto.randomUUID();
  const workingDir = path.join(__dirname, "work-dirs", id);
  fs.mkdirSync(workingDir, { recursive: true });
  try {
    return await f(workingDir);
  } finally {
    fs.rmSync(workingDir, { recursive: true });
  }
}

export const makeRunCommand =
  (cwd?: string) =>
  async (command: string, args: (string | number)[] = []) => {
    const { spawn } = await import("node:child_process");

    const spawned = spawn(
      command,
      args.map((arg) => arg.toString()),
      { cwd },
    );
    spawned.stdout.on("data", (data) => {
      process.stdout.write(data);
    });

    spawned.stderr.on("data", (data) => {
      process.stderr.write(data);
    });

    return await new Promise<void>((resolve, reject) => {
      spawned.on("close", (code: number) => {
        if (code !== 0) {
          reject(new Error(`Process exited with code ${code}`));
          return;
        }

        resolve();
      });

      spawned.on("error", (err) => {
        reject(
          new Error(
            `Error executing command \`${
              command + " " + args.join(" ")
            }\`: ${err.message}`,
          ),
        );
      });
    });
  };
