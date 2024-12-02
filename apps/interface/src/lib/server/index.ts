import { lib } from "$lib";
import { sdk } from "@repo/contracts/sdk";

const trees = new sdk.TreesService(lib.contract);
const backendSdk = sdk.createBackendSdk(lib, trees, {
  rollup: import("@repo/contracts/noir/target/rollup.json"),
});

export const serverLib = {
  ...backendSdk,
  trees,
};
