# Build and release validation

## Compiler

| Setting | Value |
|---|---|
| Solidity | 0.8.30+commit.73712a01 |
| Optimizer | Enabled, 200 runs |
| EVM version | Prague |
| viaIR | false |
| Metadata | IPFS |
| Factory | WorldDeploymentBSCV2 |
| Constructor arguments | None |
| Deployment value | 0 BNB |

Foundry uses Prague and the remappings in `contracts/foundry.toml`. The release compiler uses the same source bytes with the 18 verified `src/...` and `@openzeppelin/contracts/...` source unit names and no remappings. Source unit names affect metadata.

From `app/`, `pnpm run validate:release` checks the complete factory creation bytecode against `contracts/release/testnet-deployment-input.hex`:

- Length: 18,749 bytes
- SHA256: `0a9f615a012e810d49123b7d27ab3cd5c25087e0a9e62306f29552486eb5ddeb`
- Reference transaction: `0xd3e609f84f6dfbc9222b2557d17e383eb5a5223531620b2f6f394b80913ac2c5`, BSC Testnet block 133830577

`pnpm run build:contracts:release` writes the four release artifacts and Standard JSON compiler input to ignored `contracts/out/release/`. Neither command sends a transaction.

The local integration fixtures in `app/tests/fixtures/contracts/` retain their Cancun compilation target for regression continuity. Their source contents and ABIs match the release; the separate release tests compile Prague and require an exact creation-bytecode match, including metadata. `SHA256SUMS.json` verifies these fixture files only.

## Mainnet deployment

BSC Mainnet, Chain ID 56, block **125288896**.

Transaction: `0xbecbfdda60a28d6c365ac2fc07728bc99fcbeb6db989337f7528d8db2c640721`.

| Contract | Address |
|---|---|
| WorldDeploymentBSCV2 | 0x2F8e4b4De457aC01992e4628794DBd681f09Be30 |
| WorldTokenBSCV2 | 0xB1D67858e8374636Ca4379d2842FB166A2197A55 |
| WorldCoreBSCV2 | 0x755bae50BcAc16F3b11fc84BCfCFE0a192c009e7 |
| WorldLandProfileBSCV2 | 0x33b2FE6F3EBF80eBBE74e8c388C0FEB1717EE2e0 |

All four contracts are Verified / Exact Match on BscScan. Token takes Core, Core takes Token, and Profile takes Core as their constructor address arguments. The factory creates and binds them in one transaction. No external library linking is required.

## Network configuration

`app/config/networks/mainnet.json` and `testnet.json` define the public network identities. Vite and Wrangler select one manifest at build time. Mainnet uses Chain ID 56 and the addresses above. Testnet uses Chain ID 97 and deployment block 133830577.

The production Mainnet flags are `mainnetEnabled=true` and `MAINNET_ENABLED=true`. Incomplete configuration or disabled flags close the transaction boundary. A missing address never falls back to another network.

Wallets sign and send transactions. Browser reads use same-origin `/rpc` and shared endpoints. Mainnet uses the encrypted runtime binding `NODEREAL_MAINNET_RPC_URL`; Testnet uses `NODEREAL_RPC_URL`. Never put binding values in Vite variables, build variables, source or command arguments.

## Worker builds

| Target | Config | Worker | Assets |
|---|---|---|---|
| Mainnet | `app/wrangler.jsonc` | `world-bsc-mainnet` | `dist` |
| Testnet | `app/wrangler.testnet.jsonc` | `world-bsc-v2` | `dist-testnet` |

Both use `single-page-application` asset routing. Use Node 24 and pnpm 11.19.0, with `app/` as the build root. This public repository is a source release; it has no production deployment integration. Existing production infrastructure is managed separately.

## Validation

From `app/`:

```sh
pnpm install --frozen-lockfile
pnpm run test:all
pnpm run build:workers
pnpm run workers:check
pnpm run build:workers:testnet
pnpm run workers:check:testnet
node scripts/check-network-builds.mjs
node scripts/audit-public-docs.mjs mainnet
node scripts/audit-public-docs.mjs testnet
pnpm run test:worker
```

From `contracts/`, run `python scripts/check.py`. `FORGE_BIN` and `SOLC_BIN` can select installed tool paths. From the repository root, run `node scripts/verify-integrity.mjs` and `python scripts/scan-secrets.py`.

Worker checks use isolated local chains and nonfunctional RPC placeholders. Production builds and Wrangler dry-runs do not deploy or send public-network transactions.
