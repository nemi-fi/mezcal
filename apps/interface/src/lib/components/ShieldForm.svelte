<script lang="ts">
  import { lib } from "$lib";
  import { requestRollup } from "$lib/utils";
  import { IERC20__factory } from "@repo/contracts/typechain-types";
  import { Ui } from "@repo/ui";
  import { utils } from "@repo/utils";
  import type { ethers } from "ethers";
  import { z } from "zod";
  import CurrencySelect from "./CurrencySelect.svelte";

  let {
    account,
    secretKey,
  }: {
    account: ethers.Signer;
    secretKey: string;
  } = $props();

  const schema = z.object({
    token: z.string(),
    amount: utils.CurrencyAmountInputSchema,
  });

  async function onsubmit(formData: z.infer<typeof schema>) {
    const token = lib.tokens.find((t) =>
      utils.isAddressEqual(t.address, formData.token),
    );
    utils.assert(token, `token not found: ${formData.token}`);
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
    <Ui.Form.Field {form} name="token">
      <Ui.Form.Control let:attrs>
        <Ui.Form.Label>Token</Ui.Form.Label>
        <CurrencySelect {...attrs} bind:value={formData.token} />
      </Ui.Form.Control>
    </Ui.Form.Field>

    <Ui.Form.Field {form} name="amount">
      <Ui.Form.Control let:attrs>
        <Ui.Form.Label>Amount</Ui.Form.Label>
        <Ui.Form.CurrencyInput {...attrs} bind:value={formData.amount} />
      </Ui.Form.Control>
      <Ui.Form.Description></Ui.Form.Description>
      <Ui.Form.FieldErrors />
    </Ui.Form.Field>

    <Ui.Form.SubmitButton variant="default">Shield</Ui.Form.SubmitButton>
  {/snippet}
</Ui.Form>
