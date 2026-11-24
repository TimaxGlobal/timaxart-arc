# Contracts and tooling

Solidity 0.8.26, EVM `cancun`, optimizer on, `via_ir`. Built with Foundry (`foundry.toml`, `remappings.txt`). **Not independently audited.**

## `src/`
| File | Role |
|---|---|
| ArtShare.sol | Restricted ERC-20 share of one artwork |
| ArtPoolHook.sol | Uniswap v4 hook for the permissioned sale pool |
| ArtSwapRouter.sol | Router for swaps into the pool |
| ArtAppraisalOracle.sol | Appraisal price per share used by the credit market |
| ArtBuybackNote.sol | Fixed-return buyback note |
| Create2Factory.sol | Deterministic deployment helper |
| components/ArtShares/ | Front-end modals for buying, credit and notes (React) |

## `script/`
Foundry scripts, run in order: 1 deploy hook, 2 launch art pools, 3 create credit market, 4 update appraisal, 5 set artwork link, 6 deploy buyback note.

## `tools/` and `*.ps1`
Operator tooling for adding and publishing a painting, whitelisting wallets, lender bonus, note series and checks.

## `offer/`
The public offer page and per-artwork metadata (`offer/paintings/ART001`, `ART002`).

Addresses are listed in [docs/EVIDENCE.md](../docs/EVIDENCE.md).
