import type { CompiledCircuit, InputMap } from "@noir-lang/noir_js";
import { ethers } from "ethers";
import { range } from "lodash";
import fs from "node:fs";
import path from "node:path";
import toml from "smol-toml";

export async function splitInput(circuit: CompiledCircuit, input: InputMap) {
  return await inWorkingDir(async (workingDir) => {
    const proverPath = path.join(workingDir, "ProverX.toml");
    fs.writeFileSync(proverPath, toml.stringify(input));
    const circuitPath = path.join(workingDir, "circuit.json");
    fs.writeFileSync(circuitPath, JSON.stringify(circuit));
    const runCommand = makeRunCommand(__dirname);
    await runCommand(`./split-inputs.sh ${proverPath} ${circuitPath}`);
    const shared = range(3).map((i) => {
      const x = Uint8Array.from(fs.readFileSync(`${proverPath}.${i}.shared`));
      return ethers.hexlify(x);
    });
    return shared;
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

export const makeRunCommand = (cwd?: string) => async (command: string) => {
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
