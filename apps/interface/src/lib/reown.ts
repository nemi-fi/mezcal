import { lib } from "$lib";
import { WalletKit } from "@reown/walletkit";
import type { PoolERC20 } from "@repo/contracts/typechain-types";
import { Core } from "@walletconnect/core";
import { buildApprovedNamespaces, getSdkError } from "@walletconnect/utils";

const core = new Core({
  projectId: "64614c892df35675580b5cb21249418b",
});

const metadata = {
  name: "Mezcal",
  description: "Private anything",
  url: "https://reown.com/appkit", // origin must match your domain & subdomain
  icons: ["https://assets.reown.com/reown-profile-pic.png"],
};

export class ReownService {
  private readonly kit: Promise<InstanceType<typeof WalletKit>>;

  constructor(private contract: PoolERC20) {
    this.kit = WalletKit.init({
      core,
      metadata,
    }).then((kit) => {
      kit.on("session_proposal", async (proposal) => {
        console.log("session_proposal", proposal);
        try {
          const namespaces = buildApprovedNamespaces({
            proposal: proposal.params,
            supportedNamespaces: {
              eip155: {
                chains: [`eip155:${lib.chainId}`],
                methods: ["eth_sendTransaction"],
                events: ["accountsChanged", "chainChanged"],
                accounts: [
                  `eip155:${lib.chainId}:${await this.contract.getAddress()}`,
                ],
              },
            },
          });
          await kit.approveSession({
            id: proposal.id,
            namespaces,
          });
        } catch (e) {
          console.error(e);
          await kit.rejectSession({
            id: proposal.id,
            reason: getSdkError("USER_REJECTED"),
          });
          return;
        }
      });

      kit.on("session_request", async (request) => {
        console.log("session_request", request);
      });

      return kit;
    });
  }

  async pair(uri: string) {
    const kit = await this.kit;
    await kit.pair({ uri });
  }
}
