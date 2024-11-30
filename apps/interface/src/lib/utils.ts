import ky from "ky";
import { route } from "./ROUTES";

// TODO: move to a service
export function requestRollup() {
  return ky.post(route("POST /api/rollup"));
}

export function printPublicInputs(publicInputs: string[]) {
  console.log("publicInputs js", publicInputs.length);
  for (const publicInput of publicInputs) {
    console.log(publicInput);
  }
  console.log();
}
