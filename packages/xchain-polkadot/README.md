# `@thorswap-lib/xchain-polkadot`

Polkadot Module for XChainJS Clients

## Installation

```
yarn add @thorswap-lib/xchain-polkadot
```

## Polkadot Client Testing

```
yarn install
yarn test
```

Following peer dependencies have to be installed into your project. These are not included in `@thorswap-lib/xchain-polkadot`.

```
yarn add axios @polkadot/api @polkadot/util @thorswap-lib/xchain-client @thorswap-lib/xchain-crypto @thorswap-lib/xchain-util
```

## Service Providers

This package uses the following service providers:

| Function                    | Service          | Notes                                                                                                 |
| --------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------- |
| Balances                    | Subscan          | `POST https://polkadot.subscan.io/api/open/account`                                                   |
| Transaction history         | Subscan          | https://docs.api.subscan.io/#transfers                                                                |
| Transaction details by hash | Subscan          | https://docs.api.subscan.io/#extrinsic                                                                |
| Transaction fees            | Substrate RPC    | https://polkadot.js.org/docs/substrate/rpc/#queryinfoextrinsic-bytes-at-blockhash-runtimedispatchinfo |
| Transaction broadcast       | Substrate RPC    | https://polkadot.js.org/docs/substrate/rpc#submitextrinsicextrinsic-extrinsic-hash                    |
| Explorer                    | Subscan Explorer | https://polkadot.subscan.io                                                                           |

Subscan API rate limits: https://docs.api.subscan.io/#rate-limiting
