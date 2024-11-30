<script lang="ts">
  import type { ComponentProps } from "svelte";
  import { Input } from "../ui/input";

  let { value = $bindable(), ...props }: ComponentProps<Input> = $props();
</script>

<Input
  {...props}
  bind:value
  inputmode="decimal"
  pattern="^[0-9]*[.,]?[0-9]*$"
/>
