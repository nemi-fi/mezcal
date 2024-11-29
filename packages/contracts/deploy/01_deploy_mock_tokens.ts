import { DeployFunction } from "hardhat-deploy/types";

declare module "hardhat/types/runtime" {
  interface TypedHardhatDeployNames {
    MockUSDC: "MockERC20";
    MockBTC: "MockERC20";
  }
}

const deploy: DeployFunction = async ({
  typedDeployments,
  safeGetNamedAccounts,
}) => {
  const { deployer } = await safeGetNamedAccounts({ deployer: true });

  await typedDeployments.deploy("MockUSDC", {
    from: deployer,
    log: true,
    args: ["USD Coin", "USDC"],
    contract: "MockERC20",
  });

  await typedDeployments.deploy("MockBTC", {
    from: deployer,
    log: true,
    args: ["Bitcoin", "BTC"],
    contract: "MockERC20",
  });
};

export default deploy;
