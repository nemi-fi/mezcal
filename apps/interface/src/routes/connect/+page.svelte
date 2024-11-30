<script lang="ts">
  import { lib } from "$lib";
  import { Ui } from "@repo/ui";
  import { z } from "zod";

  const schema = z.object({
    uri: z.string(),
  });

  async function onsubmit(formData: z.infer<typeof schema>) {
    await lib.reown.pair(formData.uri);
  }
</script>

<Ui.GapContainer>
  <Ui.Card.Root>
    <Ui.Card.Header>
      <Ui.Card.Title>Connect an app</Ui.Card.Title>
    </Ui.Card.Header>
    <Ui.Card.Content>
      <Ui.Form {schema} {onsubmit}>
        {#snippet children(form, formData)}
          <Ui.GapContainer>
            <Ui.Form.Field {form} name="uri">
              <Ui.Form.Control let:attrs>
                <Ui.Form.Label>App URI</Ui.Form.Label>
                <Ui.Input {...attrs} bind:value={formData.uri} />
              </Ui.Form.Control>
            </Ui.Form.Field>

            <Ui.Form.SubmitButton variant="default">
              Connect
            </Ui.Form.SubmitButton>
          </Ui.GapContainer>
        {/snippet}
      </Ui.Form>
    </Ui.Card.Content>
  </Ui.Card.Root>
</Ui.GapContainer>
