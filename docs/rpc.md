# WORLD Reads

Browser reads use same-origin shared endpoints. Connected wallets supply user state and transaction-critical reads through their EIP-1193 provider, with same-origin `/rpc` fallback. Wallet signing and sending stay in the wallet.

## Public Snapshots

| Endpoint | Worker TTL | Browser TTL |
| --- | ---: | ---: |
| `/api/world-snapshot` | 5 seconds | 2 seconds |
| `/api/profiles` | 45 seconds | 30 seconds |
| `/api/constants` | 1 day | 1 day |
| `/api/leaderboard` | 10 minutes | 10 minutes |

No client query parameters bypass the cache. In-flight reads coalesce. Maps, wallet balances, quotes and transaction preflight never wait for the leaderboard.

The official DApp has no History route or event feed. `/api/history` and `/api/reigns` return 404. The leaderboard response contains a timestamp, indexed block and up to 25 LAND/controller/epoch aggregate rows ranked by exact Return Multiple, without raw logs or reign timelines.

## Leaderboard Cursor

Each network has a separate version-3 verified checkpoint: Mainnet uses `app/public-mainnet/data/leaderboard-checkpoint.json`; Testnet uses `app/public/data/leaderboard-checkpoint.json`. Provenance records the source SHA-256, deployment block, indexed block, and verification method. Checkpoints contain per-reign burn and settled-credit totals and active LAND settlement boundaries. Full inputs are operator evidence in ignored `app/work/`, not client payloads. `pnpm run index:rebuild mainnet` performs an intentional operator-only Mainnet rebuild with receipt, Token burn, storage and aggregate conservation checks. The operator scripts default to Testnet; Mainnet requires the explicit argument.

Cold workers resume strictly after their network's checkpoint. Each refresh scans at most 50,000 blocks, in contiguous 5,000-block requests, excludes the newest 12 blocks, and verifies event blocks, Core code hash, Earned arithmetic, takeover order and all 50 LAND storage records. Every published prefix is complete through its stated block. An old checkpoint may require several TTLs to catch up; extend Mainnet before releasing with `cd app && pnpm run index:checkpoint mainnet`. Omitting the argument extends Testnet only.

The private Cache API cursor is retained for up to 30 days but is evictable and local to each Cloudflare location. This is not durable indexing. No database or scheduled paid service is added.

Expired results return immediately and refresh in `waitUntil`. Failed or invalid refreshes retain the last verified result and back off for 60 seconds. The browser keeps it visible with its last update time. A reorganized anchor requires an operator checkpoint recovery; there is no automatic genesis replay.

## Rewards

Settled Earned is `sum(attributed Earned.delta) / (65 * 2^96)` wei per LAND/controller/epoch. Closing Earned precedes Taken and belongs to the old reign; neutral first-claim treasure belongs to the new epoch-1 reign. Events are ordered by block, transaction and log index.

Controller burn includes opening Taken, own AttackProgress during the reign, and Defended where supporter equals controller. Enemy progress, pre-reign failed attacks and third-party defense are excluded; external support is tracked separately. Reference cost is `controllerBurnAtoms * 10^12 / 10^18` wei. Return Multiple divides settled credits by that cost. This is a protocol-price reference, not verified personal acquisition cost. Fractional wei and ranking use exact integers/rationals. Reigns qualify with at least 1 WORLD of controller burn; external support is excluded and sub-threshold records stay in the checkpoint; LIVE rows show return so far, FINAL rows are closed. Withdrawals, current claimable and unsettled rewards never supply the numerator.

## Transactions

Buy refreshes wallet and Treasury. Attack refreshes its LAND, wallet and Treasury. Defend refreshes its LAND and wallet. Settle and Withdraw update reward state. These actions do not force leaderboard refresh or scan historical events. The normal shared world poll remains independent.

Name editing reads the current full Profile getter and preserves non-name fields. If an old epoch hides them, it may read canonical ProfileUpdated events to recover the original bytes. This is write-safety recovery, not a History feed, and can incur additional wallet/fallback requests.

## Security and Observations

`/rpc` retains its read/simulation allowlist, body and batch limits, fixed NodeReal target and safe failures. Mainnet uses the encrypted Runtime Secret `NODEREAL_MAINNET_RPC_URL`; Testnet uses `NODEREAL_RPC_URL`. The bindings and chain-ID guards are independent. No upstream credentials enter frontend resources.

Existing Cloudflare observability records anonymous cache outcomes, upstream request counts and latency. `world_leaderboard` reports checkpoint, indexed block, target, verified suffix size and completion. It contains no wallet addresses, signatures, raw errors or RPC parameters. Cache observations include internal world lookups, not just browser requests.

Local benchmarks report Worker/upstream counts. Real NodeReal CU requires Dashboard measurements; it is not inferred from local latency. Within one location and TTL, warm leaderboard users add no upstream reads. Different locations and cache evictions can each incur a refresh.
