# Waztec

## TODO

### contracts and circuits

- [x] split contract into a generic rollup and ERC20 specific
  - [x] extract PoolGeneric storage into a struct
- [x] join ValueNote
- [ ] split ValueNote
- [ ] negative tests
- [x] use bignumber for amounts
- [ ] support ETH
- [ ] fees
- [ ] get the remained of tokens from router to relayer/treasury
- [x] PublicInputsBuilder
- [ ] deploy as proxy
- [ ] test contracts with larger token amounts
- [ ] Rename ValueNote to Erc20Note and namespace all erc20 circuit names
- [ ] Make PoolGeneric permissionless and make PoolERC20.execute permissionless (if possible)

### Backend

- [x] prove using native bb
- [ ] persist merkle trees
- [ ] return pending tree roots

### UI

- [x] shield
- [ ] transfer
- [ ] join (maybe behind the scenes, multicall)
- [ ] unshield
- [ ] wallet connect to interact with dapps

### compliance

- [ ] unshield only mode
- [ ] set shield limit to 10 USDC
