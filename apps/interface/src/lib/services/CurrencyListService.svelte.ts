import deployments from "@repo/contracts/deployments.json";
import { utils } from "@repo/utils";
import { Token } from "@uniswap/sdk-core";
import ky from "ky";
import { z } from "zod";

export class CurrencyListService {
  #currenciesOnAllChains: Token[] = $state([]);

  constructor(private chainId: number) {}

  get currencies(): Token[] {
    if (this.chainId === 31337) {
      const chainId = this.chainId;
      return [
        new Token(chainId, deployments[chainId].contracts.MockUSDC, 6, "USDC"),
        new Token(chainId, deployments[chainId].contracts.MockBTC, 8, "BTC"),
      ] as const;
    }
    return this.#currenciesOnAllChains
      .filter((currency) => {
        return currency.chainId === this.chainId;
      })
      .filter((c) => ["USDC", "cbBTC"].includes(c.symbol!));
  }

  getByAddress(address: string) {
    return this.currencies.find((c) =>
      utils.isAddressEqual(c.address, address),
    );
  }

  async load() {
    const schema = z.object({
      tokens: z.array(
        z.object({
          chainId: z.number(),
          address: z.string(),
          decimals: z.number(),
          symbol: z.string().nullish(),
          name: z.string().nullish(),
        }),
      ),
    });

    const response = schema.parse(
      await ky.get("https://ipfs.io/ipns/tokens.uniswap.org").json(),
    );

    this.#currenciesOnAllChains = response.tokens.map(
      (token) =>
        new Token(
          token.chainId,
          token.address,
          token.decimals,
          token.symbol ?? undefined,
          token.name ?? undefined,
        ),
    );
  }
}
