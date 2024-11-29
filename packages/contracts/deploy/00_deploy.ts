import { DeployFunction } from "hardhat-deploy/types";

declare module "hardhat/types/runtime" {
  interface TypedHardhatDeployNames {
    PoolERC20: "PoolERC20";
    RouterERC20: "RouterERC20";
  }
}

const deploy: DeployFunction = async ({
  deployments,
  typedDeployments,
  safeGetNamedAccounts,
}) => {
  const { deployer } = await safeGetNamedAccounts({ deployer: true });

  async function deployVerifier(name: string, circuitName: string) {
    return await deployments.deploy(name, {
      from: deployer,
      log: true,
      args: [],
      contract: `noir/target/${circuitName}.sol:UltraVerifier`,
    });
  }
  const shieldVerifier = await deployVerifier("ShieldVerifier", "shield");
  const transferVerifier = await deployVerifier("TransferVerifier", "transfer");
  const executeVerifier = await deployVerifier("ExecuteVerifier", "execute");
  const rollupVerifier = await deployVerifier("RollupVerifier", "rollup");

  const router = await typedDeployments.deploy("RouterERC20", {
    from: deployer,
    log: true,
    args: [],
  });
  const pool = await typedDeployments.deploy("PoolERC20", {
    from: deployer,
    log: true,
    args: [
      router.address,
      shieldVerifier.address,
      transferVerifier.address,
      executeVerifier.address,
      rollupVerifier.address,
    ],
  });
  await typedDeployments.execute(
    "RouterERC20",
    { from: deployer, log: true },
    "initialize",
    pool.address,
  );
};

export default deploy;
