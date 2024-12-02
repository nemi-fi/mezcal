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
  const shieldVerifier = await deployVerifier(
    "Erc20ShieldVerifier",
    "erc20_shield",
  );
  const unshieldVerifier = await deployVerifier(
    "Erc20UnshieldVerifier",
    "erc20_unshield",
  );
  const joinVerifier = await deployVerifier("Erc20JoinVerifier", "erc20_join");
  const transferVerifier = await deployVerifier(
    "Erc20TransferVerifier",
    "erc20_transfer",
  );
  const executeVerifier = await deployVerifier(
    "Erc20ExecuteVerifier",
    "erc20_execute",
  );
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
      unshieldVerifier.address,
      joinVerifier.address,
      transferVerifier.address,
      executeVerifier.address,
      rollupVerifier.address,
    ],
  });
  if (
    (await typedDeployments.read("RouterERC20", "pool")).toLowerCase() !==
    pool.address.toLowerCase()
  ) {
    await typedDeployments.execute(
      "RouterERC20",
      { from: deployer, log: true },
      "initialize",
      pool.address,
    );
  }
};

export default deploy;
