# WORLD V2 Contract Integration

## Network

| Parameter | Value |
| --- | --- |
| Network | BNB Smart Chain Testnet |
| Chain ID | `97` |
| Native asset | `tBNB`, 18 decimals |
| Deployment block | `133830577` |
| Public DApp read endpoint | Same-origin `/rpc` |

Wallet transactions use the connected wallet provider. No mainnet deployment is described here.

## Contracts

| Role | Address | ABI |
| --- | --- | --- |
| Deployment | `0xB0272c944BCC22553cF9869B30f3418be535C3df` | [WorldDeploymentBSCV2](../abi/WorldDeploymentBSCV2.json) |
| Core | `0x1Bd3815Bec1ac3Bf0ECF3BF81E7D6AccBd875829` | [WorldCoreBSCV2](../abi/WorldCoreBSCV2.json) |
| Token | `0xC5f69e2bD3f43b8593279370071d4D39c993f27f` | [WorldTokenBSCV2](../abi/WorldTokenBSCV2.json) |
| Profile | `0x30b098ab2535D38044e45D542cb0855D0c32AB36` | [WorldLandProfileBSCV2](../abi/WorldLandProfileBSCV2.json) |

Deployment's constructor creates Token, Core, then Profile in one transaction and verifies their bindings. It has no separate deployment or administrative method. Its `token()`, `core()`, and `profile()` getters identify the instances.

Verify `Core.token()`, `Token.core()`, and `Profile.core()` against those addresses. Bindings are permanent. Do not reuse V1 addresses, allowances, event decoders, or cached state. Include chain ID and contract addresses in cache keys.

Contract source is in `contracts/src/`; public ABIs are in `contracts/abi/`. `scripts/verify-release.mjs` reproduces the Prague release and compares its complete creation bytecode with the deployment input. `app/scripts/compile.mjs` validates the pinned local integration fixtures; it does not deploy contracts.

## Units

Use bigint and exact integer or rational arithmetic.

```text
1 WORLD = 1e18 atoms
1 BNB   = 1e18 wei
Q       = 2^64
B       = 2^96
W       = 65
D       = W * B
Resistance in WORLD = resistanceRaw / (Q * 1e18)
Claim balance in wei = claimableNumerator / D
```

`claimable(address)` and `Earned.delta` are reward numerators, not wei. `checkpoint()` returns `U` and `J` in B-scaled wei. Divide only for display or when selecting a whole-wei withdrawal; retain remainders.

| Core constant | Value |
| --- | --- |
| `N()` | `50` |
| `W()` | `65` |
| `T()` | `5184000` seconds: Treasury's 60-day half-life |
| `B()` | `2^96` |
| `TOKEN_UNIT()` | `1e18` |
| `WORLD_PRICE()` | `1e12` wei per whole WORLD |
| `RESISTANCE_HALF_LIFE()` | `3888000` seconds: 45 days |
| `MAX_WAR_ATOMS()` | `2^128`, exclusive |
| `RESISTANCE_LIMIT()` | `2^192`, exclusive raw wall limit |

`Token.decimals()` is `18`. `weightOf(1)` is `6`; IDs `2..6` have weight `3`; IDs `7..50` have weight `1`.

## Read Methods

Pin related reads to one block. Keep its number, hash, and timestamp for previews and history verification.

| Contract / method | Result |
| --- | --- |
| Core `lands(id)` | `(address controller, uint256 resistanceRaw, uint64 lastResistanceUpdate, uint256 epoch, uint256 j)` |
| Core `currentResistanceRaw(id)` | Effective Q64-atom wall at the selected block; no storage update |
| Core `minimumAttackAtoms(id)` | `(currentResistanceRaw(id) >> 64) + 1` |
| Core `weightOf(id)` | LAND weight; valid IDs are `1..50` |
| Core `quoteBuy(q)` | Required whole-wei payment for `q` atoms |
| Core `checkpoint()` | `(uint256 U, uint256 J)`: current unreleased amount and cumulative release, both B-scaled |
| Core `U0()`, `J0()`, `t0()` | Stored Treasury checkpoint |
| Core `accountedBNB()` | Recognized BNB liability, in wei |
| Core `claimable(account)` | Settled aggregate reward numerator for that address |
| Token `balanceOf(account)`, `totalSupply()` | WORLD atoms |
| Token `allowance(account, core)` | WORLD atoms authorized for this Core |
| Profile `getCurrentProfile(id)` | `(bool valid, address controller, uint256 epoch, string name, string logoURI, string website)` |

Batch LAND and Profile reads. Cache immutable protocol constants by instance. Load current world state before the independent aggregated leaderboard; do not serialize 50 independent LAND reads or refetch state on language changes.

## Buy WORLD

```solidity
quoteBuy(uint256 q) returns (uint256)
buyWorld(uint256 q, address recipient) payable
```

Call `quoteBuy(q)` immediately before `buyWorld(q, recipient)`. Set `msg.value` to that quote.

```text
costWei = ceil(q * WORLD_PRICE / TOKEN_UNIT)
```

`q` must be positive and `recipient` nonzero. Every purchased atom is minted. Core recognizes the payment and any existing unaccounted BNB surplus as Treasury income. Gas is separate.

Core-held WORLD is never sale inventory. Direct BNB transfers are recognized by `syncSurplus()` or a later purchase. `syncSurplus()` pays no bounty.

## Attack

```solidity
Token.approve(address spender, uint256 value) returns (bool)
Core.attack(uint256 id, uint256 expectedEpoch, uint256 amount) returns (bool taken)
```

Approve the current Core for the intended amount, then submit Attack. Only Core can call Token's `burnFrom(account, amount)`; the caller's allowance and balance must cover the burn. Approval alone does not burn. A holder's direct `burn(amount)` does not affect LAND.

At execution, let `r` be the decayed wall and `x` the submitted atoms:

```text
0 < x < MAX_WAR_ATOMS
spendRaw = x * Q

spendRaw <= r: new wall = r - spendRaw; controller and epoch unchanged
spendRaw >  r: new wall = spendRaw - r; controller = msg.sender; epoch += 1
```

All `x` atoms burn on either successful path. Equality clears the wall without taking control. Only `Taken` confirms a takeover; a successful receipt containing `AttackProgress` does not.

Before takeover, `Earned` credits the old controller. For first occupation it credits the attacker with the unclaimed treasure. Self-conquest follows the same settlement and epoch rules.

`minimumAttackAtoms(id)` uses the full fractional wall. A quote at or above `MAX_WAR_ATOMS` cannot be used for a single attack. Resistance decay rounds upward; do not replace it with floating-point exponentiation.

`expectedEpoch` does not lock same-epoch Resistance. The DApp compares the stored `resistanceRaw` and `lastResistanceUpdate` before simulation and wallet submission; these are client checks, not extra ABI arguments. Time can still change the effective wall. Never silently increase a submitted amount to force takeover.

A revert rolls back the burn, allowance change, rewards, state, and emitted logs.

## Defend

```solidity
defend(uint256 id, uint256 expectedEpoch, uint256 amount)
```

Defend requires a controlled LAND, matching epoch, valid positive amount, and sufficient balance and Core allowance. Any WORLD holder may support it.

Core decays the old wall, burns the full amount, and stores `wallRaw + amount * Q`. The result must be strictly below `RESISTANCE_LIMIT`. Defend changes neither controller nor epoch and gives the supporter no reward share or Profile rights.

Only successful Attack and Defend update the Resistance time anchor.

## Settle

```solidity
settleLand(uint256 id)
```

Anyone may settle a controlled LAND. Core credits its current controller and updates the LAND's `j` checkpoint:

```text
deltaNumerator = weightOf(id) * (J - land.j)
claimable[controller] += deltaNumerator
land.j = J
```

Settlement on an unclaimed LAND is a no-op. It does not send BNB or update Resistance. There is no `claim()` method and no all-LAND settlement method; the DApp's Claim action calls `settleLand`.

## Rewards

```text
pendingLandNumerator = weightOf(id) * (checkpoint.J - land.j)
withdrawableWei = floor(claimable(account) / (W * B))
```

A pending amount is not yet in the address's claim balance. Settle the relevant controlled LANDs before withdrawing their pending rewards.

```solidity
withdrawRewards(address payable to, uint256 amountWei)
```

The caller spends its own claim balance; `to` may be another nonzero address. `amountWei` must be positive and affordable. The debit is `amountWei * W * B`. Rejected BNB transfers revert atomically. Core supports partial withdrawals; the current DApp submits the available whole-wei balance. Fractional credit remains.

Losing a LAND does not erase previously settled rewards. `Withdrawn` is address-level: do not attribute a wallet withdrawal to one LAND or reign. See the [ranking reference](REIGN_PERFORMANCE.md) for exact entitlement and reference-multiple accounting.

## Events

| Contract | Event and fields |
| --- | --- |
| Core | `Bought(payer, recipient, q, cost)` |
| Core | `Earned(id, beneficiary, delta, J)` |
| Core | `AttackProgress(id, epoch, attacker, amount, resistanceRaw, lastResistanceUpdate)` |
| Core | `Taken(id, epoch, oldController, newController, amount, wallRaw, resistanceRaw, lastResistanceUpdate)` |
| Core | `Defended(id, epoch, supporter, amount, resistanceRaw, lastResistanceUpdate)` |
| Core | `Withdrawn(beneficiary, to, amountWei)` |
| Profile | `ProfileUpdated(landId, epoch, controller, name, logoURI, website)` |
| Deployment | `WorldDeployed(token, core, profile)` |
| Token | `Transfer(from, to, value)`, `Approval(owner, spender, value)` |

Use the linked ABI for field types and indexed topics. In `Taken`, `wallRaw` is the effective old wall, `amount` is the complete takeover burn, and `resistanceRaw` is the excess wall. `Earned` precedes `Taken` in the transaction. First occupation and self-conquest both create reigns.

Order events by block, transaction index, then log index. Deduplicate by transaction hash and log index; verify canonical block hashes before retaining history. Do not count Token burn transfers again when burn totals already come from Core war events.

The recent activity reader uses bounded block ranges; its 5,000-block window is not complete reign coverage. Full rankings require replay from deployment and historical state checks.

## Profile

```solidity
setProfile(uint256 landId, uint256 expectedEpoch, string name, string logoURI, string website)
```

Only the current nonzero controller may call it, with the current epoch. It replaces all three fields; empty strings clear content. UTF-8 byte limits are `64` for name and `256` each for logo URI and website. There is no protocol fee or token approval; gas applies.

`getCurrentProfile` returns `valid = true` only for a submission matching the current controller and epoch, including an intentional all-empty submission. On mismatch it returns `false`, the current Core controller and epoch, and empty strings.

Takeover invalidates the previous Profile, even when the controller address is unchanged. Partial Attack, Defend, decay, settlement, and withdrawal do not.

Core does not call Profile. A Profile read failure must not replace valid Core state with zero values. Wait for the current Profile to load before editing so unread fields are not overwritten.

The contract enforces byte limits, not URI schemes. Render names as text. The current DApp edits and displays only the name. Before saving, it reads and preserves `logoURI` and `website` unchanged. When the getter hides an old epoch's record, it recovers the last canonical `ProfileUpdated` event. Incomplete or inconsistent history blocks submission. It rechecks the non-name fields before requesting a signature; the contract itself has no same-epoch compare-and-swap guard.

A contract controller must submit through that contract; its operator's EOA does not inherit editing rights.

## RPC Requirements

Browser reads use `/rpc`. The Worker reads its fixed upstream from an encrypted Cloudflare Runtime Secret. Never publish the upstream URL or key in source, Vite variables, bundles, reports, or errors.

The existing proxy accepts JSON-RPC 2.0 POST requests only, with a 256 KiB body limit and batches of 1 through 100 distinct-ID requests. It does not forward arbitrary URLs, signing methods, or transaction submission. MetaMask signs and sends wallet transactions directly.

Required reads include `eth_chainId`, `eth_blockNumber`, `eth_getBlockByNumber`, `eth_getCode`, `eth_call`, `eth_getBalance`, `eth_getLogs`, and transaction receipt reads. The proxy also permits the existing gas and simulation methods used by the DApp. A missing Runtime Secret fails safely; static assets remain available.

Historical rankings require archive `eth_call` at past blocks, complete event ranges from deployment, and stable block hashes. Batch all calls at the selected block. Freeze each reference price at its event block by reading the protocol constants there; do not substitute today's price for unavailable historical state.

On an archive or log-query failure, report the coverage limitation. Do not invent history, silently truncate it, or label partial data as complete. Current LAND state can still load independently.

## Error Handling

Decode errors using the ABI of the failing contract. Show a short user message and retain sanitized diagnostics.

| Error | User action |
| --- | --- |
| `IncorrectPayment()` | Read the quote again and use the exact payment. |
| Core `StaleEpoch()` | Refresh the LAND and preview again. |
| Profile `StaleEpoch(uint256,uint256)` | Reload the current controller and epoch before editing. |
| `NeutralLand()` | Occupy the LAND before Defend or Profile editing. |
| `ResistanceRange()` | Use an amount and resulting wall inside the documented limits. |
| `InvalidLand()`, `InvalidAmount()`, `InvalidRecipient()` | Correct the ID, amount, or recipient. |
| `ERC20InsufficientAllowance(address,uint256,uint256)` | Approve the current Core for enough WORLD. |
| `ERC20InsufficientBalance(address,uint256,uint256)` | Use an affordable WORLD amount. |
| `InsufficientClaim()` | Settle pending LAND rewards or reduce the withdrawal. |
| `BNBTransferFailed()` | Use a recipient that accepts BNB. |
| `NotController(address,address)` | Submit from the current controller. |
| `NameTooLong()`, `LogoURITooLong()`, `WebsiteTooLong()` | Shorten the field by UTF-8 byte length. |

Distinguish wrong network, wallet rejection, RPC failure, unavailable history, and a mined revert. A submitted transaction whose receipt is temporarily unavailable is not an unsent transaction. Do not report confirmed burns or takeovers until the receipt supports them. Diagnostics must not expose RPC credentials.

## Official DApp Data

The official DApp shows current WORLD state and an aggregated leaderboard. Detailed historical events remain on-chain and can be queried independently. The official DApp does not provide a transaction feed or reign timeline. See [leaderboard definitions](REIGN_PERFORMANCE.md).
