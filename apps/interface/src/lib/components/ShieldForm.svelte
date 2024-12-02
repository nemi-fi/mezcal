<script lang="ts">
  import { lib } from "$lib";
  import { requestRollup } from "$lib/utils";
  import { IERC20__factory } from "@repo/contracts/typechain-types";
  import { Ui } from "@repo/ui";
  import { utils } from "@repo/utils";
  import { z } from "zod";
  import CurrencySelect from "./CurrencySelect.svelte";

  const schema = z.object({
    token: z.string(),
    amount: utils.CurrencyAmountInputSchema,
  });

  async function onsubmit(formData: z.infer<typeof schema>) {
    const account = await lib.evm.getSigner();
    utils.assertConnected(account);
    const token = lib.tokens.find((t) =>
      utils.isAddressEqual(t.address, formData.token),
    );
    utils.assert(token, `token not found: ${formData.token}`);
    const amount = utils.parseCurrencyAmount(token, formData.amount);
    console.log("acc", await account.getAddress());
    const tokenContract = IERC20__factory.connect(token.address, account);
    await (
      await tokenContract.approve(
        lib.poolErc20.contract,
        amount.quotient.toString(),
      )
    ).wait();
    console.log("approved");
    await lib.poolErc20.shield({
      account,
      token: token.address,
      amount: BigInt(amount.quotient.toString()),
      secretKey: await lib.evm.getSecretKey(account),
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
