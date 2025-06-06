import { browser } from "$app/environment";
import deployments from "@repo/contracts/deployments.json";
import { sdk } from "@repo/contracts/sdk";
import { PoolERC20__factory } from "@repo/contracts/typechain-types/index.js";
import { QueryClient } from "@tanstack/svelte-query";
import { ethers } from "ethers";
import { ReownService } from "./reown.js";
import { route } from "./ROUTES.js";
import { CurrencyListService } from "./services/CurrencyListService.svelte.js";
import { EvmAccountService } from "./services/EvmAccountService.svelte.js";
import { QueriesService } from "./services/QueriesService.svelte.js";

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

const currencyList = new CurrencyListService(chainId);

const relayer = new ethers.Wallet(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  provider,
);
const contract = PoolERC20__factory.connect(
  deployments[chainId].contracts.PoolERC20,
  relayer,
);
const coreSdk = sdk.createCoreSdk(contract);
const trees = new sdk.RemoteTreesService(route("POST /api/trees"));
const interfaceSdk = sdk.createInterfaceSdk(coreSdk, trees, {
  shield: import("@repo/contracts/noir/target/erc20_shield.json"),
  unshield: import("@repo/contracts/noir/target/erc20_unshield.json"),
  join: import("@repo/contracts/noir/target/erc20_join.json"),
  transfer: import("@repo/contracts/noir/target/erc20_transfer.json"),
});
const reown = new ReownService(contract);
const evm = new EvmAccountService();

export const lib = {
  queries,
  chainId,
  relayer,
  currencyList,
  provider,
  reown,
  evm,
  ...coreSdk,
  ...interfaceSdk,
};
