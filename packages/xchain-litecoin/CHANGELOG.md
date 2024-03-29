# v.0.8.0 (2022-06-01)

- changes client call signature to enable privkey hydration
- adds privkey caching to improve performance

# v.0.7.6 (2022-06-27)

- decreases build size and changes README

# v.0.7.4 (2022-04-05)

- remove non existing `module` source

# v.0.7.3 (2022-02-09)

- export `buildTx` utils

# v.0.7.2 (2022-02-09)

- fetch txHex UTXO

# v.0.7.1 (2022-01-10)

- upgrade axios dependency to latest

# v.0.7.0 (2021-12-29)

## Breaking change

- Add stagenet environment handling for `Network` and `BaseXChainClient` changes client to default to mainnet values until stagenet is configured.

# v.0.6.11 (2021-12-13)

- export `scanUTXO` function
- update `coininfo` dependency

# v.0.6.10 (2021-09-06)

- updated to the latest dependencies

# v.0.6.9 (2021-07-07)

- Use latest `xchain-client@0.10.1` + `xchain-util@0.3.0`

# v.0.6.8 (2021-07-03)

- refactored client methods to use regular method syntax (not fat arrow) in order for bcall to super.xxx() to work properly

# v.0.6.7 (2021-06-29)

- added support for pulling fees from thornode.

# v.0.6.6 (2021-06-19)

- changed rollupjs to treat axios as external lib

# v.0.6.5 (2021-06-02)

- fix adding duplicated memo output in the `Utils.buildTx()`

# v.0.6.4 (2021-05-31)

- refactor utils.buildTx() to include the memo for calculating inputs with accumulate() but re-adds it into outputs using `psbt.addOutput` to avoid dust attack error

# v.0.6.3 (2021-05-31)

### Breaking change

- don't add memo output to `coinselect/accumulative`
- add memo output by using `psbt.addOutput`

# v.0.6.1 (2021-05-30)

- add unit test for sochain apis
- add `coinselect/accumulative` to devDependency and peerDependency, to select which utxos to use as inputs for transfer
- add recursive call to https://sochain.com/api#get-unspent-tx to make sure we fetch ALL utxos

# v.0.6.0 (2021-05-17)

### Breaking change

- added support for HD wallets

# v.0.5.0 (2021-05-05)

### Breaking change

- Latest @thorswap-lib/xchain-client@0.8.0
- Latest @thorswap-lib/xchain-util@0.2.7

# v.0.4.2 (2021-04-19)

### Update

- export Utils.`calFee`

# v.0.4.1 (2021-03-14)

### Update

- export Utils.`validateAddress`
- Fix default mainnet url

# v.0.4.0 (2021-03-02)

### Breaking change

- replace `find`, `findIndex`
- Update @thorswap-lib/xchain-client package to 0.7.0

# v.0.3.0 (2021-02-25)

### Breaking change

- Refactored Client.transfer to call node's JSON rpc

### Update

- Updated LitecoinClientParams to provide optional nodeUrl and nodeAuth parameters

# v.0.2.0 (2021-02-24)

### Breaking change

- Update @thorswap-lib/xchain-client package to 0.6.0

### Update

- Uses Bitaps to submit transactions instead of Sochain

### Fix

- Fix `getExplorerUrl` to bitaps.

# v.0.1.0 (2021-02-19)

### Breaking change

- Update @thorswap-lib/xchain-client package to 0.5.0
- Update @thorswap-lib/xchain-crypto package to 0.2.3
- Update parameters of Sochain APIs ...
- Update `getSuggestedFee`
- Make `feeRate` optional in `transfer()`, default is `fast`
- Update README.md

### Update

- Define / Export `LTC_DECIMAL`
- Add `Service Providers` section in README.md
- Update litecoin address prefix

### Fix

- Fix derivation path
- Fix `peerDependencies`

# v.0.0.2 (2021-01-30)

- Clear lib folder on build

# v.0.0.1 (2021-01-29)

First release
