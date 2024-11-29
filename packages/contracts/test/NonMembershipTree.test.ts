import type { Fr } from "@aztec/aztec.js";
import chai, { expect } from "chai";
import chaiAsPromised from "chai-as-promised";
import { NonMembershipTree } from "./NonMembershipTree";
chai.use(chaiAsPromised);

describe("NonMembershipTree", () => {
  const depth = 32;
  let leaves: Fr[];
  let tree: NonMembershipTree;
  beforeEach(async () => {
    const { Fr } = await eval(`import("@aztec/aztec.js")`);
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
