<script lang="ts">
  import { utils } from "@repo/utils";
  import type { ComponentProps } from "svelte";
  import { Input } from "../ui/input";

  let { value = $bindable(), ...props }: ComponentProps<Input> = $props();
</script>

<Input
  {...props}
  bind:value
  inputmode="decimal"
  pattern={utils.DECIMAL_INPUT_REGEX}
/>
