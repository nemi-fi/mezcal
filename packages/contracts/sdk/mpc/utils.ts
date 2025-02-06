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
