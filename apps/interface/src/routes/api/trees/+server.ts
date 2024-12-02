import { serverLib } from "$lib/server/index.js";
import { sdk } from "@repo/contracts/sdk/index.js";
import { z } from "zod";

const schema = z.object({
  method: z.enum(sdk.REMOTE_TREES_ALLOWED_METHODS),
  args: z.array(z.any()),
});
export async function POST({ request }) {
  const inputs = schema.parse(await request.json());
  const result = await serverLib.trees[inputs.method](
    ...(inputs.args as [any, any, any]),
  );
  return Response.json(result);
}
