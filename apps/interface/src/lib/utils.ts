import ky from "ky";
import { route } from "./ROUTES";

// TODO: move to a service
export function requestRollup() {
  return ky.post(route("POST /api/rollup"));
}
