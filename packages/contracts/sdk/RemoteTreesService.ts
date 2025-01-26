import ky from "ky";
import type { ElementOf } from "ts-essentials";
import type { TreesService } from "./TreesService";

export const REMOTE_TREES_ALLOWED_METHODS = [
  "getContext",
  "getNoteConsumptionInputs",
] as const;
export type ITreesService = Pick<
  TreesService,
  ElementOf<typeof REMOTE_TREES_ALLOWED_METHODS>
>;

export interface RemoteTreesService extends ITreesService {}
export class RemoteTreesService {
  constructor(private url: string) {
    for (const method of REMOTE_TREES_ALLOWED_METHODS) {
      (this as any)[method] = async (...args: any[]) => {
        return await ky
          .post(this.url, {
            json: {
              method,
              args,
            },
          })
          .json();
      };
    }
  }
}
