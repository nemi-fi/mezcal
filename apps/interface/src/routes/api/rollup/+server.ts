import { lib } from "$lib";

export async function POST() {
  await lib.rollup.rollup();
  return new Response("", { status: 200 });
}
