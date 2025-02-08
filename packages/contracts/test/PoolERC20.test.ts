import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers, noir, typedDeployments } from "hardhat";
import type { sdk as interfaceSdk } from "../sdk";
import type { createBackendSdk } from "../sdk/backendSdk";
import { SwapResult } from "../sdk/LobService";
import { parseUnits, snapshottedBeforeEach } from "../shared/utils";
import {
  MockERC20,
  MockERC20__factory,
  PoolERC20,
  PoolERC20__factory,
} from "../typechain-types";
const { tsImport } = require("tsx/esm/api"); // TODO: remove when hardhat supports ESM

describe("PoolERC20", () => {
  let alice: SignerWithAddress,
    bob: SignerWithAddress,
    charlie: SignerWithAddress;
  const aliceSecretKey =
    "0x118f09bc73ec486db2030077142f2bceba2a4d4c9e0f6147d776f8ca8ec02ff1";
  const bobSecretKey =
    "0x2120f33c0d324bfe571a18c1d5a1c9cdc6db60621e35bc78be1ced339f936a71";
  const charlieSecretKey =
    "0x038c0439a42280637b202fd2f0d25d6e8e3c11908eab966a6d85bd6797eed5d5";
  let pool: PoolERC20;
  let usdc: MockERC20;
  let btc: MockERC20;
  let sdk: ReturnType<typeof interfaceSdk.createInterfaceSdk>;
  let backendSdk: ReturnType<typeof createBackendSdk>;
  let CompleteWaAddress: typeof import("../sdk").sdk.CompleteWaAddress;
  let TokenAmount: typeof import("../sdk").sdk.TokenAmount;
  snapshottedBeforeEach(async () => {
    [alice, bob, charlie] = await ethers.getSigners();
    await typedDeployments.fixture();
    pool = PoolERC20__factory.connect(
      (await typedDeployments.get("PoolERC20")).address,
      alice,
    );

    usdc = await new MockERC20__factory(alice).deploy("USD Coin", "USDC");
    btc = await new MockERC20__factory(alice).deploy("Bitcoin", "BTC");

    await usdc.mintForTests(alice, await parseUnits(usdc, "1000000"));
    await usdc.connect(alice).approve(pool, ethers.MaxUint256);
    await btc.mintForTests(bob, await parseUnits(btc, "1000000"));
    await btc.connect(bob).approve(pool, ethers.MaxUint256);
    await btc.mintForTests(charlie, await parseUnits(btc, "1000000"));
    await btc.connect(charlie).approve(pool, ethers.MaxUint256);

    ({ CompleteWaAddress, TokenAmount } = (
      await tsImport("../sdk", __filename)
    ).sdk);
  });

  before(async () => {
    const { sdk: interfaceSdk } = (await tsImport(
      "../sdk",
      __filename,
    )) as typeof import("../sdk");
    const { createBackendSdk } = (await tsImport(
      "../sdk/backendSdk",
      __filename,
    )) as typeof import("../sdk/backendSdk");

    const coreSdk = interfaceSdk.createCoreSdk(pool);

    const trees = new interfaceSdk.TreesService(pool);
    sdk = interfaceSdk.createInterfaceSdk(coreSdk, trees, {
      shield: noir.getCircuitJson("erc20_shield"),
      unshield: noir.getCircuitJson("erc20_unshield"),
      join: noir.getCircuitJson("erc20_join"),
      transfer: noir.getCircuitJson("erc20_transfer"),
      swap: noir.getCircuitJson("lob_router_swap"),
    });

    backendSdk = createBackendSdk(coreSdk, trees, {
      rollup: noir.getCircuitJson("rollup"),
    });

    console.log("roots", await trees.getTreeRoots());
  });

  it("shields", async () => {
    const amount = 100n;
    const { note } = await sdk.poolErc20.shield({
      account: alice,
      token: usdc,
      amount,
      secretKey: aliceSecretKey,
    });

    await backendSdk.rollup.rollup();
    expect(
      await sdk.poolErc20.getBalanceNotesOf(usdc, aliceSecretKey),
    ).to.deep.equal([note]);
    expect(await sdk.poolErc20.balanceOf(usdc, aliceSecretKey)).to.equal(
      amount,
    );
    expect(await usdc.balanceOf(pool)).to.equal(amount);
  });

  it("shields many", async () => {
    await sdk.poolErc20.shield({
      account: alice,
      token: usdc,
      amount: 100n,
      secretKey: aliceSecretKey,
    });
    await sdk.poolErc20.shield({
      account: alice,
      token: usdc,
      amount: 200n,
      secretKey: aliceSecretKey,
    });
    await backendSdk.rollup.rollup();
    expect(await sdk.poolErc20.balanceOf(usdc, aliceSecretKey)).to.equal(300n);

    await sdk.poolErc20.shield({
      account: alice,
      token: usdc,
      amount: 300n,
      secretKey: aliceSecretKey,
    });
    await backendSdk.rollup.rollup();
    expect(await sdk.poolErc20.balanceOf(usdc, aliceSecretKey)).to.equal(600n);
  });

  // TODO(security): re-enable this test
  it.skip("unshield", async () => {
    const amount = 100n;
    const unshieldAmount = 40n;
    await sdk.poolErc20.shield({
      account: alice,
      token: usdc,
      amount,
      secretKey: aliceSecretKey,
    });
    await backendSdk.rollup.rollup();
    expect(await sdk.poolErc20.balanceOf(usdc, aliceSecretKey)).to.equal(
      amount,
    );

    const [fromNote] = await sdk.poolErc20.getBalanceNotesOf(
      usdc,
      aliceSecretKey,
    );
    await sdk.poolErc20.unshield({
      secretKey: aliceSecretKey,
      fromNote,
      token: await usdc.getAddress(),
      to: await bob.getAddress(),
      amount: unshieldAmount,
    });

    expect(await usdc.balanceOf(bob)).to.eq(unshieldAmount);
    expect(await usdc.balanceOf(pool)).to.equal(amount - unshieldAmount);

    await backendSdk.rollup.rollup();

    expect(await sdk.poolErc20.balanceOf(usdc, aliceSecretKey)).to.equal(
      amount - unshieldAmount,
    );
  });

  it("joins", async () => {
    const amount0 = 100n;
    const amount1 = 200n;
    await sdk.poolErc20.shield({
      account: alice,
      token: usdc,
      amount: amount0,
      secretKey: aliceSecretKey,
    });
    await sdk.poolErc20.shield({
      account: alice,
      token: usdc,
      amount: amount1,
      secretKey: aliceSecretKey,
    });
    await backendSdk.rollup.rollup();
    expect(await sdk.poolErc20.balanceOf(usdc, aliceSecretKey)).to.equal(
      amount0 + amount1,
    ); // sanity check

    const notes = await sdk.poolErc20.getBalanceNotesOf(usdc, aliceSecretKey);
    expect(notes.length).to.equal(2); // sanity check
    await sdk.poolErc20.join({
      secretKey: aliceSecretKey,
      notes,
    });
    await backendSdk.rollup.rollup();

    expect(await sdk.poolErc20.balanceOf(usdc, aliceSecretKey)).to.equal(
      amount0 + amount1,
    );
    expect(
      (await sdk.poolErc20.getBalanceNotesOf(usdc, aliceSecretKey)).length,
    ).to.equal(1);
  });

  it("transfers", async () => {
    // prepare
    const amount = 500n;
    await sdk.poolErc20.shield({
      account: alice,
      token: usdc,
      amount,
      secretKey: aliceSecretKey,
    });
    await backendSdk.rollup.rollup();

    // interact
    const [note] = await sdk.poolErc20.getBalanceNotesOf(usdc, aliceSecretKey);
    const transferAmount = await TokenAmount.from({
      token: await usdc.getAddress(),
      amount: 123n,
    });
    const { nullifier, changeNote, toNote } = await sdk.poolErc20.transfer({
      secretKey: aliceSecretKey,
      fromNote: note,
      to: await CompleteWaAddress.fromSecretKey(bobSecretKey),
      amount: transferAmount,
    });

    const pendingTxsAfter = (await pool.getAllPendingTxs()).slice(1);
    expect(pendingTxsAfter).to.deep.equal([
      [
        false, // rolledUp
        [
          // note hashes
          await changeNote.hash(),
          await toNote.hash(),
        ],
        [
          // nullifiers
          nullifier,
        ],
      ],
    ]);

    await backendSdk.rollup.rollup();

    expect(await sdk.poolErc20.balanceOf(usdc, aliceSecretKey)).to.equal(
      amount - transferAmount.amount,
    );
    expect(await sdk.poolErc20.balanceOf(usdc, bobSecretKey)).to.equal(
      transferAmount.amount,
    );
  });

  it("transfers many", async () => {
    await sdk.poolErc20.shield({
      account: alice,
      token: usdc,
      amount: 100n,
      secretKey: aliceSecretKey,
    });
    await backendSdk.rollup.rollup();
    const [shieldedNote] = await sdk.poolErc20.getBalanceNotesOf(
      usdc,
      aliceSecretKey,
    );

    await sdk.poolErc20.transfer({
      secretKey: aliceSecretKey,
      fromNote: shieldedNote,
      to: await CompleteWaAddress.fromSecretKey(bobSecretKey),
      amount: await TokenAmount.from({
        token: await usdc.getAddress(),
        amount: 30n,
      }),
    });
    // TODO: split notes even if they are not rolled up
    // const {  } = await sdk.poolErc20.transfer({
    //   secretKey: aliceSecretKey,
    //   fromNote: shieldedNote,
    //   to: await sdk.poolErc20.computeWaAddress(charlieSecretKey),
    //   amount: 10n,
    // });
    await backendSdk.rollup.rollup();
    const [bobNote] = await sdk.poolErc20.getBalanceNotesOf(usdc, bobSecretKey);

    await sdk.poolErc20.transfer({
      secretKey: bobSecretKey,
      fromNote: bobNote,
      to: await CompleteWaAddress.fromSecretKey(charlieSecretKey),
      amount: await TokenAmount.from({
        token: await usdc.getAddress(),
        amount: 10n,
      }),
    });
    await backendSdk.rollup.rollup();

    expect(await sdk.poolErc20.balanceOf(usdc, aliceSecretKey)).to.equal(
      100n - 30n,
    );
    expect(await sdk.poolErc20.balanceOf(usdc, bobSecretKey)).to.equal(
      30n - 10n,
    );
    expect(await sdk.poolErc20.balanceOf(usdc, charlieSecretKey)).to.equal(10n);
  });

  it("can't double spend a note", async () => {
    const amount = await TokenAmount.from({
      token: await usdc.getAddress(),
      amount: 100n,
    });
    await sdk.poolErc20.shield({
      account: alice,
      token: usdc,
      amount: amount.amount,
      secretKey: aliceSecretKey,
    });
    await backendSdk.rollup.rollup();

    const [note] = await sdk.poolErc20.getBalanceNotesOf(usdc, aliceSecretKey);
    await sdk.poolErc20.transfer({
      secretKey: aliceSecretKey,
      fromNote: note,
      to: await CompleteWaAddress.fromSecretKey(bobSecretKey),
      amount: amount,
    });

    await sdk.poolErc20.transfer({
      secretKey: aliceSecretKey,
      fromNote: note,
      to: await CompleteWaAddress.fromSecretKey(charlieSecretKey),
      amount: amount,
    });
    // TODO(security): check that this fails on proof verification level. I.e., try to insert the same nullifier twice.
    // TODO(security): also check that the nullifier cannot be set in the place of the low leaf(i get this impression from reading `merkle_tree::indexed_tree::batch_insert` code)
    await expect(backendSdk.rollup.rollup()).to.be.rejectedWith(
      "Cannot insert duplicated keys",
    );
  });

  // TODO(security): write these tests
  it.skip("fails to transfer more than balance", async () => {});
  it.skip("fails to transfer if note does not exist", async () => {});
  it.skip("fails to transfer if note is pending", async () => {});
  it.skip("fails to transfer if note is nullified", async () => {});
  it.skip("fails to double spend a note", async () => {});
  it.skip("fails to unshield too much", async () => {});

  it("does not have notes until it's rolled up", async () => {
    const { note } = await sdk.poolErc20.shield({
      account: alice,
      token: usdc,
      amount: 100n,
      secretKey: aliceSecretKey,
    });
    expect(
      await sdk.poolErc20.getBalanceNotesOf(usdc, aliceSecretKey),
    ).to.deep.equal([]);
    await backendSdk.rollup.rollup();
    expect(
      await sdk.poolErc20.getBalanceNotesOf(usdc, aliceSecretKey),
    ).to.deep.equal([note]);

    const { changeNote } = await sdk.poolErc20.transfer({
      secretKey: aliceSecretKey,
      fromNote: note,
      to: await CompleteWaAddress.fromSecretKey(bobSecretKey),
      amount: await TokenAmount.from({
        token: await usdc.getAddress(),
        amount: 100n,
      }),
    });
    expect(
      await sdk.poolErc20.getBalanceNotesOf(usdc, aliceSecretKey),
    ).to.deep.equal([note]); // still exists
    await backendSdk.rollup.rollup();
    expect(changeNote.amount.amount).to.eq(0n); // sanity check
    expect(
      await sdk.poolErc20.getBalanceNotesOf(usdc, aliceSecretKey),
    ).to.deep.equal([changeNote]);
  });

  it("swaps", async () => {
    const { note: aliceNote } = await sdk.poolErc20.shield({
      account: alice,
      token: usdc,
      amount: 100n,
      secretKey: aliceSecretKey,
    });
    const { note: bobNote } = await sdk.poolErc20.shield({
      account: bob,
      token: btc,
      amount: 10n,
      secretKey: bobSecretKey,
    });

    await backendSdk.rollup.rollup();

    await sdk.lob.swap({
      sellerSecretKey: aliceSecretKey,
      sellerNote: aliceNote,
      sellerAmount: await TokenAmount.from({
        token: await usdc.getAddress(),
        amount: 70n,
      }),
      buyerSecretKey: bobSecretKey,
      buyerNote: bobNote,
      buyerAmount: await TokenAmount.from({
        token: await btc.getAddress(),
        amount: 2n,
      }),
    });

    await backendSdk.rollup.rollup();

    expect(await sdk.poolErc20.balanceOf(usdc, aliceSecretKey)).to.equal(30n);
    expect(await sdk.poolErc20.balanceOf(btc, aliceSecretKey)).to.equal(2n);
    expect(await sdk.poolErc20.balanceOf(usdc, bobSecretKey)).to.equal(70n);
    expect(await sdk.poolErc20.balanceOf(btc, bobSecretKey)).to.equal(8n);
  });

  it("swaps mpc", async () => {
    if (process.env.CI) {
      // TODO: install co-noir on github actions and remove this
      console.log("skipping mpc swap test");
      return;
    }

    const { note: aliceNote } = await sdk.poolErc20.shield({
      account: alice,
      token: usdc,
      amount: 100n,
      secretKey: aliceSecretKey,
    });
    const { note: bobNote } = await sdk.poolErc20.shield({
      account: bob,
      token: btc,
      amount: 10n,
      secretKey: bobSecretKey,
    });

    await backendSdk.rollup.rollup();

    const sellerAmount = await TokenAmount.from({
      token: await usdc.getAddress(),
      amount: 70n,
    });
    const buyerAmount = await TokenAmount.from({
      token: await btc.getAddress(),
      amount: 2n,
    });

    const swapAlicePromise = sdk.lob.requestSwap({
      secretKey: aliceSecretKey,
      note: aliceNote,
      sellAmount: sellerAmount,
      buyAmount: buyerAmount,
    });
    const swapBobPromise = sdk.lob.requestSwap({
      secretKey: bobSecretKey,
      note: bobNote,
      sellAmount: buyerAmount,
      buyAmount: sellerAmount,
    });
    const [swapAlice, swapBob] = await Promise.all([
      swapAlicePromise,
      swapBobPromise,
    ]);
    await sdk.lob.commitSwap({ swapA: swapAlice, swapB: swapBob });

    await backendSdk.rollup.rollup();

    expect(await sdk.poolErc20.balanceOf(usdc, aliceSecretKey)).to.equal(30n);
    expect(await sdk.poolErc20.balanceOf(btc, aliceSecretKey)).to.equal(2n);
    expect(await sdk.poolErc20.balanceOf(usdc, bobSecretKey)).to.equal(70n);
    expect(await sdk.poolErc20.balanceOf(btc, bobSecretKey)).to.equal(8n);
  });

  it("swaps 4 orders", async () => {
    if (process.env.CI) {
      // TODO: install co-noir on github actions and remove this
      return;
    }

    const { note: aliceNote0 } = await sdk.poolErc20.shield({
      account: alice,
      token: usdc,
      amount: 100n,
      secretKey: aliceSecretKey,
    });
    const { note: aliceNote1 } = await sdk.poolErc20.shield({
      account: alice,
      token: usdc,
      amount: 100n,
      secretKey: aliceSecretKey,
    });
    const { note: bobNote } = await sdk.poolErc20.shield({
      account: bob,
      token: btc,
      amount: 10n,
      secretKey: bobSecretKey,
    });
    const { note: charlieNote } = await sdk.poolErc20.shield({
      account: charlie,
      token: btc,
      amount: 20n,
      secretKey: charlieSecretKey,
    });
    await backendSdk.rollup.rollup();

    let swaps0Promise: Promise<[SwapResult, SwapResult]>;
    {
      // alice <-> bob
      const sellerAmount = await TokenAmount.from({
        token: await usdc.getAddress(),
        amount: 70n,
      });
      const buyerAmount = await TokenAmount.from({
        token: await btc.getAddress(),
        amount: 2n,
      });
      swaps0Promise = Promise.all([
        sdk.lob.requestSwap({
          secretKey: aliceSecretKey,
          note: aliceNote0,
          sellAmount: sellerAmount,
          buyAmount: buyerAmount,
        }),
        sdk.lob.requestSwap({
          secretKey: bobSecretKey,
          note: bobNote,
          sellAmount: buyerAmount,
          buyAmount: sellerAmount,
        }),
      ]);
    }

    let swaps1Promise: Promise<[SwapResult, SwapResult]>;
    {
      // alice <-> charlie
      const sellerAmount = await TokenAmount.from({
        token: await usdc.getAddress(),
        amount: 30n,
      });
      const buyerAmount = await TokenAmount.from({
        token: await btc.getAddress(),
        amount: 1n,
      });
      swaps1Promise = Promise.all([
        sdk.lob.requestSwap({
          secretKey: aliceSecretKey,
          note: aliceNote1,
          sellAmount: sellerAmount,
          buyAmount: buyerAmount,
        }),
        sdk.lob.requestSwap({
          secretKey: charlieSecretKey,
          note: charlieNote,
          sellAmount: buyerAmount,
          buyAmount: sellerAmount,
        }),
      ]);
    }

    const swaps0 = await swaps0Promise;
    const swaps1 = await swaps1Promise;
    await sdk.lob.commitSwap({ swapA: swaps0[0], swapB: swaps0[1] });
    await sdk.lob.commitSwap({ swapA: swaps1[0], swapB: swaps1[1] });
    await backendSdk.rollup.rollup();

    expect(await sdk.poolErc20.balanceOf(usdc, aliceSecretKey)).to.equal(
      200n - 70n - 30n,
    );
    expect(await sdk.poolErc20.balanceOf(btc, aliceSecretKey)).to.equal(
      2n + 1n,
    );

    expect(await sdk.poolErc20.balanceOf(usdc, bobSecretKey)).to.equal(70n);
    expect(await sdk.poolErc20.balanceOf(btc, bobSecretKey)).to.equal(8n);

    expect(await sdk.poolErc20.balanceOf(usdc, charlieSecretKey)).to.equal(30n);
    expect(await sdk.poolErc20.balanceOf(btc, charlieSecretKey)).to.equal(19n);
  });

  it("fails to swap if order amounts do not match", async () => {
    if (process.env.CI) {
      // TODO: install co-noir on github actions and remove this
      return;
    }

    const { note: aliceNote } = await sdk.poolErc20.shield({
      account: alice,
      token: usdc,
      amount: 100n,
      secretKey: aliceSecretKey,
    });
    const { note: bobNote } = await sdk.poolErc20.shield({
      account: bob,
      token: btc,
      amount: 10n,
      secretKey: bobSecretKey,
    });

    await backendSdk.rollup.rollup();

    const sellerAmount = await TokenAmount.from({
      token: await usdc.getAddress(),
      amount: 70n,
    });
    const buyerAmount = await TokenAmount.from({
      token: await btc.getAddress(),
      amount: 2n,
    });

    const swapAlicePromise = sdk.lob.requestSwap({
      secretKey: aliceSecretKey,
      note: aliceNote,
      sellAmount: sellerAmount,
      buyAmount: buyerAmount,
    });
    const swapBobPromise = sdk.lob.requestSwap({
      secretKey: bobSecretKey,
      note: bobNote,
      sellAmount: buyerAmount,
      buyAmount: await TokenAmount.from({
        token: await usdc.getAddress(),
        amount: 71n, // amount differs
      }),
    });
    await expect(
      Promise.all([swapAlicePromise, swapBobPromise]),
    ).to.be.rejectedWith("mpc generated invalid proof");
  });
});
