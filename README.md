# WORLD

WORLD is a LAND game on BSC. Players burn WORLD to attack or defend LAND. Controllers receive released Treasury rewards in BNB.

## Networks

| Network | DApp | Chain ID |
|---|---|---:|
| BSC Mainnet | [burntheworld.xyz](https://burntheworld.xyz) | 56 |
| BSC Testnet | [test.burntheworld.xyz](https://test.burntheworld.xyz) | 97 |

## Architecture

- WorldCore manages 50 LANDs, Resistance, purchases and Treasury rewards.
- WorldToken mints purchases and burns attacks and defenses.
- WorldLandProfile binds metadata to controller and epoch; the DApp edits LAND names only.
- WorldDeployment creates and permanently binds Token, Core and Profile.
- The React DApp reads through a Cloudflare Worker. Wallets sign and send transactions.

`app/` contains the DApp, Worker and frontend tests. `contracts/` contains Solidity, pinned dependencies, contract tests and release checks. `docs/` contains developer references.

## Mainnet Contracts

BSC Mainnet, Chain ID **56**, deployment block **125288896**. All four contracts are **Verified / Exact Match** on BscScan.

| Contract | Address |
|---|---|
| WorldDeployment | [0x2F8e4b4De457aC01992e4628794DBd681f09Be30](https://bscscan.com/address/0x2F8e4b4De457aC01992e4628794DBd681f09Be30#code) |
| WorldToken | [0xB1D67858e8374636Ca4379d2842FB166A2197A55](https://bscscan.com/address/0xB1D67858e8374636Ca4379d2842FB166A2197A55#code) |
| WorldCore | [0x755bae50BcAc16F3b11fc84BCfCFE0a192c009e7](https://bscscan.com/address/0x755bae50BcAc16F3b11fc84BCfCFE0a192c009e7#code) |
| WorldProfile | [0x33b2FE6F3EBF80eBBE74e8c388C0FEB1717EE2e0](https://bscscan.com/address/0x33b2FE6F3EBF80eBBE74e8c388C0FEB1717EE2e0#code) |

Public network identities are maintained in [`app/config/networks/`](app/config/networks/).

## Development

Use Node 24, pnpm 11.19.0, Python 3, Foundry and solc 0.8.30. Integration tests use Anvil on localhost; set `ANVIL_BIN` if it is not on PATH.

```sh
cd app
pnpm install --frozen-lockfile
pnpm run test:all
pnpm run build:workers
pnpm run workers:check
cd ../contracts
python scripts/check.py
cd ..
node scripts/verify-integrity.mjs
python scripts/scan-secrets.py
```

The default build targets Mainnet. Testnet checks use `pnpm run build:workers:testnet` and `pnpm run workers:check:testnet` from `app/`. These commands do not deploy. This public source repository is not connected to production deployment automation.

## Documentation

- [Rules](app/public-mainnet/docs/V2_UI_RULES.md)
- [Contract integration](app/public-mainnet/docs/V2_CONTRACT_INTEGRATION.md)
- [Leaderboard accounting](app/public-mainnet/docs/REIGN_PERFORMANCE.md)
- [Build and release validation](docs/deployment.md)
- [RPC and caching](docs/rpc.md)

## License

WORLD code is available under the [MIT License](LICENSE). Vendored dependencies retain their own licenses; see [third-party notices](docs/third-party.md).
