import { DeployFunction } from "hardhat-deploy/types";

declare module "hardhat/types/runtime" {
  interface TypedHardhatDeployNames {
    PoolERC20: "PoolERC20";
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
  const rollupVerifier = await deployVerifier("RollupVerifier", "rollup");

  const pool = await typedDeployments.deploy("PoolERC20", {
    from: deployer,
    log: true,
    args: [
      shieldVerifier.address,
      unshieldVerifier.address,
      joinVerifier.address,
      transferVerifier.address,
      rollupVerifier.address,
    ],
  });
};

export default deploy;
