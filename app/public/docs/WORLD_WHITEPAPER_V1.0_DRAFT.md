# WORLD V1 Whitepaper Archive

## Status

This is an English summary of the earlier BSC V1 review draft. It is historical, not the current gameplay specification or a new audit certificate. The original Chinese draft is preserved byte-for-byte in the repository's documentation archive.

For the deployed Burn + Resistance model, read the [WORLD V2 Rules](V2_UI_RULES.md) and [V2 Contract Integration](V2_CONTRACT_INTEGRATION.md). Do not apply V1 Reserve or D/P rules to V2 transactions.

## V1 Model

The earlier model used locked Defense (`D`), cumulative Pressure (`P`), and a reusable WORLD Reserve.

- Partial attacks accumulated Pressure and moved WORLD into Reserve.
- Successful takeovers moved the old Defense and the attack's gap portion into Reserve. The excess became the new locked Defense.
- Defend added locked WORLD to Defense.
- Wars did not burn those WORLD tokens. Core sold Reserve inventory before minting a purchase's shortfall.
- Defense and Pressure did not decay with time. Equality did not take control; takeover required a strict crossing.

These mechanics are absent from the current V2 Core.

## Parameters Retained in V2

Both BSC versions use 50 LANDs with total weight 65: LAND #1 has weight 6, #2-#6 have weight 3, and #7-#50 have weight 1. WORLD has 18 decimals.

Treasury uses a 60-day half-life. Released BNB is attributed by LAND weight, credited through settlement, and transferred through withdrawal. Unclaimed LANDs accumulate treasure for their first controller. Previous controllers keep credited rewards after losing control.

Controller plus epoch identifies valid Profile metadata. A self-takeover also begins a new epoch.

## V2 Replacement

V2 burns the full WORLD amount on every successful Attack and Defend. Primary purchases mint the full purchased amount. There is no Reserve, locked token Defense, or inventory-first sale.

V2 replaces Defense and Pressure with fractional Resistance and a 45-day Resistance half-life. Each real war first decays the old wall, then applies its own amount. Reads, rewards operations, and Profile edits do not restart that clock.

V1 implementation reports and test counts are historical evidence. They do not certify the current V2 contracts, DApp, deployment, or documentation.
