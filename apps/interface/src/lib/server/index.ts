import { lib } from "$lib";
import { sdk } from "@repo/contracts/sdk";

const backendSdk = sdk.createBackendSdk(lib, {
  rollup: import("@repo/contracts/noir/target/rollup.json"),
});

export const serverLib = {
  ...backendSdk,
};
