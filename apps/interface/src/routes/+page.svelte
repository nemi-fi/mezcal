<script lang="ts">
  import { lib } from "$lib";
  import ShieldForm from "$lib/components/ShieldForm.svelte";
  import { sdk } from "@repo/contracts/sdk";
  import {
    IERC20__factory,
    MockERC20__factory,
  } from "@repo/contracts/typechain-types";
  import { Ui } from "@repo/ui";
  import { utils } from "@repo/utils";
  import { createQuery } from "@tanstack/svelte-query";
  import { CurrencyAmount, Token } from "@uniswap/sdk-core";

  const balances = $derived(
    createQuery(
      {
        queryKey: ["balances", lib.tokens, lib.evm.address],
        queryFn: async () => {
          const address = lib.evm.address;
          if (!address) {
            return [];
          }
          const balances = await Promise.all(
            lib.tokens.map(async (token) => {
              const tokenContract = IERC20__factory.connect(
                token.address,
                lib.evm.provider,
              );
              const balance = await tokenContract.balanceOf(address);
              return CurrencyAmount.fromRawAmount(token, balance.toString());
            }),
          );
          return balances;
        },
      },
      lib.queries.queryClient,
    ),
  );

  const shieldedBalances = $derived(
    createQuery(
      {
        queryKey: ["shieldedBalances", lib.tokens, lib.evm.address],
        queryFn: async () => {
          const signer = await lib.evm.getSigner();
          if (!signer) {
            return [];
          }
          const secretKey = await lib.evm.getSecretKey(signer);
          const balances = await Promise.all(
            lib.tokens.map(async (token) => {
              const balance = await lib.poolErc20.balanceOf(
                token.address,
                secretKey,
              );
              return CurrencyAmount.fromRawAmount(token, balance.toString());
            }),
          );
          return balances;
        },
      },
      lib.queries.queryClient,
    ),
  );

  const waAddress = $derived(
    createQuery(
      {
        queryKey: ["waAddress", lib.evm.address],
        queryFn: async () => {
          const signer = await lib.evm.getSigner();
          if (!signer) {
            return null;
          }
          const secretKey = await lib.evm.getSecretKey(signer);
          return (
            await sdk.CompleteWaAddress.fromSecretKey(secretKey)
          ).toString();
        },
      },
      lib.queries.queryClient,
    ),
  );
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
      <div>
        Private address:
        <Ui.Query query={$waAddress}>
          {#snippet success(data)}
            {data}
          {/snippet}
        </Ui.Query>
      </div>

      <Ui.Query query={$balances}>
        {#snippet success(data)}
          {@render balancesBlock(data)}
        {/snippet}
      </Ui.Query>

      <Ui.LoadingButton
        onclick={async () => {
          utils.assertConnected(lib.evm.address);
          for (const token of lib.tokens) {
            const contract = MockERC20__factory.connect(
              token.address,
              lib.relayer,
            );
            let tx;
            if (lib.chainId === 31337) {
              tx = await contract.mintForTests(lib.evm.address, 10000000n);
            } else {
              const whaleAddress = "0x40ebc1ac8d4fedd2e144b75fe9c0420be82750c6";
              await lib.evm.provider.send("anvil_impersonateAccount", [
                whaleAddress,
              ]);
              const whale = await lib.evm.provider.getSigner(whaleAddress);
              tx = await contract
                .connect(whale)
                .transfer(
                  lib.evm.address,
                  utils.parseCurrencyAmount(token, "10").quotient.toString(),
                );
            }

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

      <ShieldForm />
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
