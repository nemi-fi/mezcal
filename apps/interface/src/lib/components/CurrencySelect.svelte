<script lang="ts">
  import { lib } from "$lib";
  import { Ui } from "@repo/ui";
  import type { HTMLSelectAttributes } from "svelte/elements";

  let tokens = $derived(lib.tokens);

  let { value = $bindable(), ...props }: HTMLSelectAttributes = $props();
</script>

<select
  {...props}
  class={Ui.cn(
    props.class,
    "flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid]:border-destructive [&>span]:line-clamp-1 data-[placeholder]:[&>span]:text-muted-foreground",
  )}
  bind:value
>
  {#each tokens as token}
    <option value={token.address}>{token.symbol}</option>
  {/each}
</select>
