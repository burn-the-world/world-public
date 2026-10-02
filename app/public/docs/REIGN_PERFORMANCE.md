# WORLD Return Leaderboard

The official DApp shows current WORLD state and a cached Return Leaderboard.
Detailed events remain on-chain and can be queried independently. There is no
transaction feed, reign timeline, or archive explorer.

## One Record per Reign

A record is identified by LAND, controller, and epoch. A controller can be a
wallet or a contract. A self-takeover closes one record and opens another.

LIVE means the reign has not ended at the indexed block. Its multiple is the
return so far. FINAL means the reign has ended. Neither includes future rewards.
Names are current Profile names only when controller and epoch still match;
otherwise the row uses LAND #<id>.

## Controller Burn

Controller burn, in WORLD atoms, is:

- The opening `Taken.amount`.
- `AttackProgress.amount` from that controller during the reign.
- `Defended.amount` where the supporter is that controller.

Enemy partial attacks, failed attacks before the reign, and third-party defense
are excluded. Third-party defense is recorded separately as external support.
The opening takeover burn belongs to the new reign, not the reign that ended.

## Settled Rewards

`Earned` credits the beneficiary's aggregate claim balance. It does not transfer
BNB. The leaderboard attributes each credit to its LAND reign in
`blockNumber, transactionIndex, logIndex` order.

A takeover settles the old controller before `Taken`. Those closing credits
belong to the old reign, including self-takeovers. For the first occupation,
treasure is credited immediately before the epoch-1 `Taken` and belongs to the
new epoch-1 reign.

Only emitted `Earned.delta` enters the numerator. Current claimable, withdrawals,
unsettled LAND rewards, and projected rewards do not enter it.

## Protocol Reference Cost

Current V2 constants:

```text
TOKEN_UNIT = 10^18 WORLD atoms
WORLD_PRICE = 10^12 wei per WORLD
rewardDenominator = 65 * 2^96

settledEarnedWei = sum(attributed Earned.delta) / rewardDenominator
protocolCostWei = controllerBurnAtoms * WORLD_PRICE / TOKEN_UNIT
returnMultiple = settledEarnedWei / protocolCostWei
```

This is the protocol buy-price reference, not the wallet's verified acquisition
cost. The price is immutable for this Core. All accounting and ordering use
integer numerators and denominators. Fractional wei are retained; rounding is
display-only. For dust burns, this linear reference can be smaller than the
rounded `quoteBuy` payment. A small denominator and first-claim treasure can
produce a large reference multiple without proving a large personal return.

The page shows the top 25 reigns with at least 1 WORLD (10^18 atoms) of controller
burn. The threshold applies to each reign separately, before sorting and selecting
the top 25. External support does not count toward it. Sub-threshold reigns remain
in the checkpoint and can qualify after further controller burns. This is a
leaderboard filter, not a minimum Attack or Defend amount. Zero settled rewards
display 0x. Positive multiples below 0.01 display <0.01x.

## Shared Checkpoint

An operator-generated checkpoint covers a verified contiguous event range.
Incremental indexing reads only subsequent `Earned`, `Taken`, `AttackProgress`,
and `Defended` events. It checks canonical hashes, event order, and all 50 LAND
controller, epoch, and settlement checkpoints against storage.

The browser receives top aggregate rows, never a full event array. Snapshots
refresh at most once every 10 minutes per Cloudflare location and exclude the
newest 12 blocks. The page shows the last verified timestamp and block.

Expired snapshots remain visible during refresh. An invalid range or upstream
failure cannot replace the last complete result. A reorg requires operator
recovery; the Worker does not rescan from deployment. Map and transactions do
not wait for the leaderboard.

Cache API is local and evictable. A cold location resumes from the bundled
checkpoint. Extend it with `pnpm run index:checkpoint`. An intentional offline
full rebuild uses `pnpm run index:rebuild`; it corroborates receipts, Token burns,
LAND storage, and total credited rewards before atomically replacing the file.

See [rules](V2_UI_RULES.md) and [contract integration](V2_CONTRACT_INTEGRATION.md).
