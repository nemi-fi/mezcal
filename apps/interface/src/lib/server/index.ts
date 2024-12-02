import { lib } from "$lib";
import { sdk } from "@repo/contracts/sdk";
import { createBackendSdk } from "@repo/contracts/sdk/backendSdk";

const trees = new sdk.TreesService(lib.contract);
const backendSdk = createBackendSdk(lib, trees, {
  rollup: import("@repo/contracts/noir/target/rollup.json"),
});

export const serverLib = {
  ...backendSdk,
  trees,
};
