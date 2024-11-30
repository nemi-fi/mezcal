import { lib } from "$lib";

export async function POST() {
  lib.rollup.rollup();
  return new Response("", { status: 200 });
}
