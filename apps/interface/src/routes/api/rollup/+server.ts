import { serverLib } from "$lib/server";

export async function POST() {
  serverLib.rollup.rollup();
  return new Response("", { status: 200 });
}
