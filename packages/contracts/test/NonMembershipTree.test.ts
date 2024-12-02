import type { Fr } from "@aztec/aztec.js";
import chai, { expect } from "chai";
import chaiAsPromised from "chai-as-promised";
import type { sdk } from "../sdk";
const { tsImport } = require("tsx/esm/api"); // TODO: remove when hardhat supports ESM
chai.use(chaiAsPromised);

describe("NonMembershipTree", () => {
  const depth = 32;
  let leaves: Fr[];
  let tree: sdk.NonMembershipTree;
  beforeEach(async () => {
    const { Fr } = await eval(`import("@aztec/aztec.js")`);
    const { sdk } = (await tsImport(
      "../sdk",
      __filename,
    )) as typeof import("../sdk");
    leaves = [1, 3, 4, 8].map((x) => new Fr(BigInt(x)));
    tree = await sdk.NonMembershipTree.new(leaves, depth);
  });

  it("proves non-membership", async () => {
    const { Fr } = await eval(`import("@aztec/aztec.js")`);
    await tree.getNonMembershipWitness(new Fr(2));
  });

  it("fails for members", async () => {
    for (const leaf of leaves) {
      await expect(tree.getNonMembershipWitness(leaf)).rejectedWith(
        `key already present: "${leaf}"`,
      );
    }
  });
});
