<script lang="ts">
  import { lib } from "$lib";
  import ShieldForm from "$lib/components/ShieldForm.svelte";
  import {
    IERC20__factory,
    MockERC20__factory,
  } from "@repo/contracts/typechain-types";
  import { Ui } from "@repo/ui";
  import { utils } from "@repo/utils";
  import { createQuery } from "@tanstack/svelte-query";
  import { CurrencyAmount, Token } from "@uniswap/sdk-core";
  import { ethers } from "ethers";

  const privateKey =
    "0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6";
  const account = new ethers.Wallet(privateKey, lib.provider);

  const balances = createQuery({
    queryKey: ["balances", lib.tokens],
    queryFn: async () => {
      const balances = await Promise.all(
        lib.tokens.map(async (token) => {
          const tokenContract = IERC20__factory.connect(
            token.address,
            lib.provider,
          );
          const balance = await tokenContract.balanceOf(account);
          return CurrencyAmount.fromRawAmount(token, balance.toString());
        }),
      );
      return balances;
    },
  });

  const shieldedBalances = createQuery({
    queryKey: ["shieldedBalances", lib.tokens],
    queryFn: async () => {
      const balances = await Promise.all(
        lib.tokens.map(async (token) => {
          const balance = await lib.rollup.balanceOf(token.address, privateKey);
          return CurrencyAmount.fromRawAmount(token, balance.toString());
        }),
      );
      return balances;
    },
  });
</script>

<Ui.GapContainer class="container">
  <section>
    <div class="prose mb-2">
      <h2>App</h2>
    </div>
  </section>

  <Ui.Card.Root>
    <Ui.Card.Header>
      <Ui.Card.Title>Balances</Ui.Card.Title>
    </Ui.Card.Header>
    <Ui.Card.Content>
      <Ui.Query query={$balances}>
        {#snippet success(data)}
          {@render balancesBlock(data)}
        {/snippet}
      </Ui.Query>

      <Ui.LoadingButton
        onclick={async () => {
          for (const token of lib.tokens) {
            const contract = MockERC20__factory.connect(
              token.address,
              lib.relayer,
            );
            // const tx = await contract.mintForTests(account.address, 10000000n);

            const whaleAddress = "0x40ebc1ac8d4fedd2e144b75fe9c0420be82750c6";
            await lib.provider.send("anvil_impersonateAccount", [whaleAddress]);
            const whale = await lib.provider.getSigner(whaleAddress);
            const tx = await contract
              .connect(whale)
              .transfer(
                account.address,
                utils.parseCurrencyAmount(token, "10").quotient.toString(),
              );

            await tx.wait();
            lib.queries.invalidateAll();
          }
        }}
      >
        Mint public tokens
      </Ui.LoadingButton>
    </Ui.Card.Content>
  </Ui.Card.Root>

  <Ui.Card.Root>
    <Ui.Card.Header>
      <Ui.Card.Title>Shielded Balances</Ui.Card.Title>
    </Ui.Card.Header>

    <Ui.Card.Content>
      <Ui.Query query={$shieldedBalances}>
        {#snippet success(data)}
          {@render balancesBlock(data)}
        {/snippet}
      </Ui.Query>

      <ShieldForm secretKey={privateKey} {account} token={lib.tokens[0]} />
    </Ui.Card.Content>
  </Ui.Card.Root>
</Ui.GapContainer>

{#snippet balancesBlock(data: CurrencyAmount<Token>[])}
  <div class="flex flex-col gap-2">
    {#each data as balance}
      <div class="flex gap-2">
        <div class="flex-1">
          <span class="text-sm font-bold">
            {balance.currency.symbol}
          </span>
        </div>
        <div class="flex-1">
          <span class="text-lg font-bold">
            {balance.toExact()}
          </span>
        </div>
      </div>
    {/each}
  </div>
{/snippet}
