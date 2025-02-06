import "@nomicfoundation/hardhat-toolbox";
import "hardhat-deploy";
import "hardhat-plugin-noir";
import { HardhatUserConfig } from "hardhat/config";
import envConfig from "./envConfig";
import "./shared/typed-hardhat-deploy";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: {
        enabled: true,
        runs: 100000000,
      },
    },
  },
  noir: {
    version: "1.0.0-beta.1",
    bbVersion: "0.67.0",
  },
  networks: {},
  etherscan: {
    apiKey: {
      sepolia: "BSFWY85F56JH998I6GBM1R4YZJTM6G5WGA",
    },
  },
  namedAccounts: {
    deployer: {
      hardhat: 0,
      localhost: 0,
      baseSepolia: `privatekey://${envConfig.DEPLOYER_PRIVATE_KEY}`,
    },
  },
  mocha: {
    timeout: 999999999,
  },
};

export default config;
