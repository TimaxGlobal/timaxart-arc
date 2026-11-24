# TimaxArt on Arc

Tokenised art credit and sales on Arc, settled in USDC and EURC. Public home of our Circle Developer Grant (Arc) application, progress and evidence.

Applicant: TimaxArt Limited (UK company no. 15123152), Cardiff. Operating platform: TimaxPay.

## What it is
One physical artwork becomes restricted digital shares that verified clients can buy, borrow against, lend to or hold for a fixed return, all on Arc and run from one admin panel.

- Restricted ERC-20 art shares, verified through the Arc KYC hook
- Permissioned Uniswap v4 sale pool (fee decays 5.00% to 0.50% over 3 days)
- Morpho Blue credit market per lot, maximum loan to value 38.5% on an appraisal oracle (a higher valuation is limited to +10% a week)
- Buyback note and lender bonus
- P2P-escrow bank-transfer sales within a set band of the appraisal
- Control through a 2-of-3 Safe: `0x54030De9e5AC2De5E9d1E073a914B527A314C7d3`
- Non-custodial: the client's own wallet signs every transaction

## Status
See [docs/STATUS.md](docs/STATUS.md). Seen working end to end on ART001. ART002 deployed; its credit test is pending. Contracts are **not yet independently audited**.

## Grant plan
See [docs/GRANT.md](docs/GRANT.md) and [docs/EVIDENCE.md](docs/EVIDENCE.md).

## Open source
Interfaces and documentation will be published here under MIT as milestones complete.

## Security
See [SECURITY.md](SECURITY.md).
