<script lang="ts">
  import { lib } from "$lib";
  import { requestRollup } from "$lib/utils";
  import { IERC20__factory } from "@repo/contracts/typechain-types";
  import { Ui } from "@repo/ui";
  import { utils } from "@repo/utils";
  import type { Token } from "@uniswap/sdk-core";
  import type { ethers } from "ethers";
  import { z } from "zod";

  let {
    token,
    account,
    secretKey,
  }: {
    token: Token;
    account: ethers.Signer;
    secretKey: string;
  } = $props();

  const schema = z.object({
    amount: utils.CurrencyAmountInputSchema,
  });

  async function onsubmit(formData: z.infer<typeof schema>) {
    const amount = utils.parseCurrencyAmount(token, formData.amount);
    const tokenContract = IERC20__factory.connect(token.address, account);
    await (
      await tokenContract.approve(
        lib.rollup.contract,
        amount.quotient.toString(),
      )
    ).wait();
    await lib.rollup.shield({
      account,
      token: token.address,
      amount: BigInt(amount.quotient.toString()),
      secretKey,
    });
    await requestRollup();
    lib.queries.invalidateAll();
  }
</script>

<Ui.Form {schema} {onsubmit}>
  {#snippet children(form, formData)}
    <Ui.Form.Field {form} name="amount">
      <Ui.Form.Control let:attrs>
        <Ui.Form.Label>Amount of tokens you want to shield</Ui.Form.Label>
        <Ui.Form.CurrencyInput {...attrs} bind:value={formData.amount} />
      </Ui.Form.Control>
      <Ui.Form.Description></Ui.Form.Description>
      <Ui.Form.FieldErrors />
    </Ui.Form.Field>

    <Ui.Form.SubmitButton variant="default">Shield</Ui.Form.SubmitButton>
  {/snippet}
</Ui.Form>
