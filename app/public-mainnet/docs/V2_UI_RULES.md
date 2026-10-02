# WORLD V2 Rules

## WORLD

WORLD has 18 decimals: `1 WORLD = 1e18 atoms`.

Buy WORLD with the exact BNB quote returned by Core. The current primary price is `0.000001 BNB` per WORLD; payment is rounded up to whole wei. Every purchased atom is newly minted to the recipient. Gas is separate. The primary price is not a DEX price or a redemption rate.

Each successful Attack or Defend immediately burns the entire submitted WORLD amount. Approval is a separate transaction and does not burn WORLD. A reverted war transaction burns nothing.

There is no Reserve, locked Defense, or inventory-first sale. WORLD sent directly to Core does not become inventory and has no recovery function. Burning WORLD directly through Token does not create Resistance or LAND rewards.

## LAND

WORLD has 50 LANDs, numbered 1 through 50, with 65 total weight.

| LAND | Count | Weight per LAND |
| --- | ---: | ---: |
| #1 | 1 | 6 |
| #2-#6 | 5 | 3 |
| #7-#50 | 44 | 1 |

Each LAND has one controller. A wallet or contract can control several LANDs. Map position does not affect the rules. Core has no direct LAND transfer or abdication method.

## Attack

Attack a LAND with a positive WORLD amount. The result uses its effective Resistance when the transaction executes.

| Submitted amount | Result |
| --- | --- |
| Less than Resistance | Reduce Resistance; keep the current controller. |
| Equal to Resistance | Set Resistance to zero; keep the current controller. |
| Greater than Resistance | Take control; the excess becomes the new Resistance. |

The entire submitted amount burns in all three cases. A successful transaction does not always mean a takeover.

A positive attack takes an unclaimed LAND. Taking control increases its epoch by one. A controller can attack its own LAND; crossing the wall still burns WORLD and starts a new epoch.

Time alone never changes control, including when Resistance becomes very small. `expectedEpoch` rejects a transaction for an ended reign, but does not lock Resistance within the same epoch. Attacks, reinforcement, and time can change a preview before execution. The receipt and updated chain state determine the result.

## Defense

Any WORLD holder can Defend a controlled LAND. Core first decays the old Resistance to execution time, then adds the submitted amount.

Defend burns the full amount. It does not change the controller or epoch. Supporting another ruler does not grant rewards, profile rights, or a refund. An unclaimed LAND cannot be defended.

## Resistance

Resistance has a 45-day half-life. Without another war, a wall of 1,000 WORLD becomes 500 WORLD after 45 days, subject to integer rounding.

Only a successful Attack or Defend updates the stored Resistance and its time anchor. Reading state, settling rewards, withdrawing, synchronizing BNB donations, or editing a Profile does not restart decay.

Resistance uses fractional-atom precision and upward rounding. A small positive wall is not zero. The minimum takeover amount is the smallest whole atom strictly above the current wall.

A single Attack or Defend must use `0 < amount < 2^128` atoms. The combined wall must remain below the contract's Resistance limit. A minimum takeover quote outside this input range cannot be submitted in one attack.

## Treasury

Treasury has a 60-day half-life. This is not a 60-day expiry or a deadline for claiming rewards. Resistance and Treasury use separate decay calculations.

Primary purchase payments enter Treasury. Direct BNB donations are recognized by a later purchase or `syncSurplus()`. Synchronizing a donation pays no caller bounty.

Released BNB is allocated by LAND weight across all 65 weight units. The Treasury balance shown as unreleased is not an address's withdrawable balance.

## Rewards

Rewards have three distinct states:

- Unreleased BNB remains in Treasury.
- Released but unsettled rewards belong to a LAND's current controller, or remain as treasure on an unclaimed LAND.
- Settled rewards enter the beneficiary address's aggregate claim balance.

On takeover, Core settles the old controller's LAND rewards before changing control. The first controller of an unclaimed LAND receives its accumulated treasure. Losing a LAND does not remove rewards already credited to the old controller.

Use Claim to settle a controlled LAND, then Withdraw to transfer whole wei from the address's claim balance. Anyone can settle a controlled LAND for its controller. Settlement does not itself send BNB. Fractional-wei credit remains for later withdrawals. Core supports partial withdrawals; the DApp withdraws the available whole-wei balance.

The Return Leaderboard compares already-settled LAND rewards with that reign's controller-owned burns valued at the protocol primary price. It includes the opening takeover, controller attacks and controller defense, excludes third-party support, and does not establish actual acquisition cost or wallet withdrawals. See the [ranking reference](REIGN_PERFORMANCE.md).

## Profiles

The DApp supports custom LAND names only. The current controller can save a name of up to 64 UTF-8 bytes for the current epoch. An empty name displays as `LAND #<id>`. Editing has no protocol fee; gas still applies.

Profiles are valid only while their recorded controller and epoch match Core. A takeover, including self-conquest, invalidates the previous epoch's Profile. Defend, partial Attack, decay, settlement, and withdrawal do not invalidate it.

Images and websites are not displayed or editable in the DApp. Saving a name preserves existing non-name fields on chain. If those fields cannot be verified, the DApp does not submit the update.

## BSC Mainnet

The public DApp uses BSC Mainnet, Chain ID `56`, with BNB for payments and gas.

Reads use the same-origin `/rpc` endpoint. Your wallet signs and sends transactions. The proxy does not sign transactions or hold wallet keys.

See the [contract integration guide](V2_CONTRACT_INTEGRATION.md) for addresses and interfaces. The [V1 archive](WORLD_WHITEPAPER_V1.0_DRAFT.md) describes an earlier model; use this document for current gameplay.

## Official DApp Data

The official DApp shows current WORLD state and an aggregated leaderboard. Detailed historical events remain on-chain and can be queried independently. The official DApp does not provide a transaction feed or reign timeline. See [leaderboard definitions](REIGN_PERFORMANCE.md).
