# Third-party notices

The root MIT License applies to WORLD code. Dependencies retain their copyright notices and license terms.

| Dependency | Version | License files |
|---|---|---|
| OpenZeppelin Contracts | 5.6.1 | [MIT](../contracts/lib/openzeppelin-contracts/LICENSE) |
| Forge Standard Library | 1.16.2 | [MIT](../contracts/lib/forge-std/LICENSE-MIT), [Apache-2.0](../contracts/lib/forge-std/LICENSE-APACHE) |
| Compound-derived OpenZeppelin vendor code | Pinned with OpenZeppelin | [BSD license](../contracts/lib/openzeppelin-contracts/contracts/vendor/compound/LICENSE) |

Pinned source revisions are recorded in `contracts/BSC_DEPENDENCIES.lock.json`. The dependency checksum manifest is checked by `contracts/scripts/verify_frozen_inputs.py`. JavaScript dependencies and their exact versions are recorded in `app/pnpm-lock.yaml`; their licenses are distributed with their packages.
