<img align="right" width="150" height="150" top="100" src="https://github.com/user-attachments/assets/c80982e6-103e-45b0-8bd1-b6c38c5debe5">

# Mezcal

Mezcal (Nahuatl: mexcalli - agave booze) - on-chain dark pool implementation using [Noir](https://noir-lang.org) and [Taceo coNoir](https://taceo.io). Hides EVERYTHING about orders and traders(tokens, amounts and addresses of traders are completely hidden). Trades settled on an EVM chain using a very simplified version of [Aztec Protocol](https://aztec.network). The tradeoff is O(N^2) order matching engine.

The code is highly experimental. The core code is located in `packages/contracts`.

## TODO

### contracts and circuits

- [x] split contract into a generic rollup and ERC20 specific
  - [x] extract PoolGeneric storage into a struct
- [x] join Erc20Note
- [ ] split Erc20Note
- [ ] negative tests
- [x] use bignumber for amounts
- [ ] support ETH
- [ ] fees
- [ ] prove against a historical note hash tree root
- [x] PublicInputsBuilder
- [ ] deploy as proxy
- [ ] test contracts with larger token amounts
- [ ] TODO(security): parse inputs to circuits instead of assuming they are correct. Same applies to types returned from `unconstrained` functions. <https://github.com/noir-lang/noir/issues/7181> <https://github.com/noir-lang/noir/issues/4218>
