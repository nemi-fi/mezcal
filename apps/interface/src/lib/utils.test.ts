import { describe, expect, test } from "vitest";
import { fromNoirU256, toNoirU256 } from "./utils";

describe("U256", () => {
  test("to and from", () => {
    const values = [
      // random values
      0n,
      1n,
      2n,
      3n,
      1234n,
      4958341723432n,
      2n ** 128n - 1234n,
      // edge cases
      2n ** 120n - 1n,
      2n ** 120n,
      2n ** 120n + 1n,
      2n * 240n - 1n,
      2n * 240n,
      2n * 240n + 1n,
      2n * 256n - 1n,
      2n * 256n,
    ];

    for (const value of values) {
      const limbs = toNoirU256(value);
      const recovered = fromNoirU256(limbs);
      expect(recovered).toEqual(value);
    }
  });
});
