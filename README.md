# BlazeSwap

[![Actions Status](https://github.com/blazeswap/contracts/workflows/CI/badge.svg)](https://github.com/blazeswap/contracts/actions)
[![Version](https://img.shields.io/npm/v/@blazeswap/contracts)](https://www.npmjs.com/package/@blazeswap/contracts)

BlazeSwap is decentralized exchange to swap cryptocurrencies on the Flare networks (Flare/Songbird/Coston).

Highly inspired by Uniswap V2, it adds full support for FTSO provider delegation and FTSO/F-Asset rewards, generated by the liquidity locked in the pair contracts.

On Flare it'll support also the 3-years distribution of the Flare tokens.

In-depth documentation on Uniswap V2 is available at [uniswap.org](https://docs.uniswap.org/protocol/V2/concepts/protocol-overview/how-uniswap-works).

The built contract artifacts can be browsed via [unpkg.com](https://unpkg.com/browse/@blazeswap/contracts@latest/).

# License

Most of the code is licensed under the GPL 3.0 or later. The code of the plugins, handling the FTSO delegation and all rewards, is licensed under the Business Source License 1.1.
In short this means that the plugin code will become GPL after a specific date, and before such date it *cannot* be copied/used/called in production by external projects without a specific use grant.

All the interfaces of the smart contracts (both GPL and BSL) can be freely used to develop 3rd party applications that interact with the deployments of the BlazeSwap DEX.

# Local Development

The following assumes the use of `node@>=14`.

## Install Dependencies

`npm i`

## Compile Contracts

`npm run build`

## Run Tests

`npm test`
