import { browser } from "$app/environment";
import deployments from "@repo/contracts/deployments.json";
import { PoolERC20__factory } from "@repo/contracts/typechain-types/index.js";
import { QueryClient } from "@tanstack/svelte-query";
import { Token } from "@uniswap/sdk-core";
import { ethers } from "ethers";
import { ReownService } from "./reown.js";
import { EncryptionService } from "./services/EncryptionService.js";
import { EvmAccountService } from "./services/EvmAccountService.svelte.js";
import { QueriesService } from "./services/QueriesService.svelte.js";
import { RollupService } from "./services/RollupService.js";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      enabled: browser,
    },
  },
});

const queries = new QueriesService(queryClient);

// TODO: remove this provider
const provider = new ethers.JsonRpcProvider("http://localhost:8545");

const chainId = 31337;
const tokens = [
  new Token(chainId, deployments[chainId].contracts.MockUSDC, 6, "USDC"),
  new Token(chainId, deployments[chainId].contracts.MockBTC, 8, "BTC"),
] as const;

// const chainId = 8453;
// const tokens = [
//   new Token(chainId, "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", 6, "USDC"),
//   new Token(chainId, "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf", 8, "BTC"),
// ] as const;

const encryption = EncryptionService.getSingleton();
async function getCircuit(artifact: any) {
  const { Noir } = await import("@noir-lang/noir_js");
  const { UltraPlonkBackend } = await import("@aztec/bb.js");
  artifact = await artifact;
  const noir = new Noir(artifact);
  const backend = new UltraPlonkBackend(artifact.bytecode);
  return { noir, backend };
}
const relayer = new ethers.Wallet(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  provider,
);
const contract = PoolERC20__factory.connect(
  deployments[chainId].contracts.PoolERC20,
  relayer,
);
const rollup = new RollupService(
  contract,
  encryption,
  ethers.resolveProperties({
    shield: getCircuit(import("@repo/contracts/noir/target/shield.json")),
    unshield: getCircuit(import("@repo/contracts/noir/target/unshield.json")),
    join: getCircuit(import("@repo/contracts/noir/target/join.json")),
    execute: getCircuit(import("@repo/contracts/noir/target/execute.json")),
    transfer: getCircuit(import("@repo/contracts/noir/target/transfer.json")),
    rollup: getCircuit(import("@repo/contracts/noir/target/rollup.json")),
  }),
);
const reown = new ReownService(contract);
const evm = new EvmAccountService();

export const lib = {
  queries,
  rollup,
  chainId,
  relayer,
  tokens,
  provider,
  reown,
  evm,
};
