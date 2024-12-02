<script lang="ts">
  import { lib } from "$lib";
  import { requestRollup } from "$lib/utils";
  import { sdk } from "@repo/contracts/sdk";
  import { Ui } from "@repo/ui";
  import { utils } from "@repo/utils";
  import { assert } from "ts-essentials";
  import { z } from "zod";
  import CurrencySelect from "./CurrencySelect.svelte";

  const schema = z.object({
    token: z.string(),
    amount: utils.CurrencyAmountInputSchema,
    to: z.string(),
  });

  async function onsubmit(formData: z.infer<typeof schema>) {
    const account = await lib.evm.getSigner();
    utils.assertConnected(account);
    const secretKey = await lib.evm.getSecretKey(account);

    const token = lib.currencyList.getByAddress(formData.token);
    utils.assert(token, `token not found: ${formData.token}`);
    const amount = utils.parseCurrencyAmount(token, formData.amount);
    const [note] = await lib.poolErc20.getBalanceNotesOf(
      token.address,
      secretKey,
    );
    assert(
      note &&
        utils.isAddressEqual(note.amount.token, amount.currency.address) &&
        note.amount.amount >= BigInt(amount.quotient.toString()),
      "not enough balance",
    );
    const to = sdk.CompleteWaAddress.fromString(formData.to);

    await lib.poolErc20.transfer({
      secretKey,
      fromNote: note,
      to,
      amount: BigInt(amount.quotient.toString()),
    });
    await requestRollup();
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

    <Ui.Form.Field {form} name="to">
      <Ui.Form.Control let:attrs>
        <Ui.Form.Label>To</Ui.Form.Label>
        <Ui.Input {...attrs} bind:value={formData.to} />
      </Ui.Form.Control>
    </Ui.Form.Field>

    <Ui.Form.SubmitButton variant="default">Send</Ui.Form.SubmitButton>
  {/snippet}
</Ui.Form>
