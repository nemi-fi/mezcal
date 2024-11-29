import type { Fr } from "@aztec/aztec.js";
import type { NonMembershipTree } from "@repo/interface/src/lib/services/NonMembershipTree";
import chai, { expect } from "chai";
import chaiAsPromised from "chai-as-promised";
const { tsImport } = require("tsx/esm/api"); // TODO: remove when hardhat supports ESM
chai.use(chaiAsPromised);

describe("NonMembershipTree", () => {
  const depth = 32;
  let leaves: Fr[];
  let tree: NonMembershipTree;
  beforeEach(async () => {
    const { Fr } = await eval(`import("@aztec/aztec.js")`);
    const { NonMembershipTree } = (await tsImport(
      "@repo/interface/src/lib/services/NonMembershipTree",
      __filename,
    )) as typeof import("@repo/interface/src/lib/services/NonMembershipTree");
    leaves = [1, 3, 4, 8].map((x) => new Fr(BigInt(x)));
    tree = await NonMembershipTree.new(leaves, depth);
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
