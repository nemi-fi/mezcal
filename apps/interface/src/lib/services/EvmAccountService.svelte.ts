import { utils } from "@repo/utils";
import { ethers } from "ethers";
import { keccak256ToFr } from "./RollupService";

export class EvmAccountService {
  readonly provider!: ethers.BrowserProvider;
  address: string | undefined = $state();

  #secretKeys: Record<string, Promise<string>> = {};

  constructor() {
    if (typeof window !== "undefined") {
      this.provider = new ethers.BrowserProvider((window as any).ethereum);
      this.#fetchAddress();
      (window as any).ethereum.on("accountsChanged", (accounts: string[]) => {
        this.address = accounts[0];
      });
    }
  }

  async connect() {
    await this.provider.send("eth_requestAccounts", []);
    await this.#fetchAddress();
  }

  async getSigner() {
    if (!this.address) {
      return undefined;
    }
    try {
      return await this.provider.getSigner(this.address);
    } catch (e) {
      console.error(e);
      return undefined;
    }
  }

  async #fetchAddress() {
    this.address = (await this.provider.send("eth_accounts", []))[0];
  }

  async getSecretKey(account: ethers.Signer) {
    const message =
      "Sign this message to generate a encrypted-evm.oleh.wtf secret key"; // TODO(security): put the correct domain here
    const address = (await account.getAddress()).toLowerCase();
    if (!this.#secretKeys[address]) {
      this.#secretKeys[address] = utils.iife(async () => {
        const signature0 = await account.signMessage(message);
        const signature1 = await account.signMessage(message);
        if (signature0 !== signature1) {
          throw new Error(
            "Secret key cannot be generated because your wallet signatures are not deterministic",
          );
        }
        return (await keccak256ToFr(signature0)).toString();
      });
    }
    return this.#secretKeys[address];
  }
}
