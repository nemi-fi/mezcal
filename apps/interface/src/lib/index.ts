import { browser } from "$app/environment";
import { QueryClient } from "@tanstack/svelte-query";
import { QueriesService } from "./services/QueriesService.svelte.js";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      enabled: browser,
    },
  },
});

const queries = new QueriesService(queryClient);

export const lib = {
  queries,
};
