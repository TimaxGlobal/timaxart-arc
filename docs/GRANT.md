# Circle Developer Grant (Arc) – TimaxArt Limited: stablecoin credit against restricted assets, with art as the first collateral

2026-11-26 · @Valerii Tkachenko

## Project summary

TimaxArt Limited (UK) requests a Circle Developer Grant of **$35,000 over 3 months** to prove stablecoin credit against restricted real-world assets on Arc, with art as the first collateral: complete an independent review and the legal base, open live credit markets to outside users and add a second gallery artwork. **What we have:** two artworks are already tokenised on Arc as restricted ERC-20 shares (ART001 "Vernissage 2", valued at £10,000; ART002 "Dream", valued at £100,000). Each has a permissioned Uniswap v4 pool, a Morpho Blue credit market and an admin panel, and ART001's pool, credit market and fixed-return note, and ART002's pool purchase and full lending and borrowing cycle, have been checked with real transactions on Arc (between our own wallets). Around it, TimaxPay already runs a P2P escrow on Arc (14 deals, $850,000), 12 EU/UK/Swiss SMEs settle €1,450,000 on Stripe and Monerium rails, and MoneyGram cash-out and cash-in run on Stellar. **What we will build:** an independent review and legal base, Safe control of every admin role, live USDC and EURC credit markets with outside users, the first lender-bonus payout and a second gallery artwork. The mainnet scale-up and a collection token are a follow-on, not requested here. Everything settles in USDC and EURC, and the client's own wallet signs every transaction (non-custodial).

**Product in one line.** One physical artwork becomes restricted digital shares that verified clients can borrow against, lend to, buy or hold for a fixed return, all on Arc and run from one admin panel.

Circle building blocks used: USDC and EURC (quote, credit and settlement assets), Arc (chain 5042) as the settlement chain, and CCTP v2 and the Circle SDK, already integrated in TimaxPay.

## Applicant

The applicant is **TimaxArt Limited**, a UK company (number 15123152) registered at Tramshed Tech, Unit D, Pendyris Street, Cardiff, Wales, CF11 6BH. TimaxArt Limited holds the works and runs its own art gallery (timaxglobal.com): it has offered art collections for auction for more than ten years, with listings on artnet and LiveAuctioneers. The works, the artist relationships and the sales experience therefore already exist; the grant pays for the on-chain credit, valuation and legal layers, not for building a gallery. The platform is built by Viking ProArt OÜ (Estonia) and sold through TimaxPay (app.timaxpay.com), a non-custodial multi-chain payments and DeFi platform: each client connects their own wallet, and login and embedded wallets run through Dynamic.xyz. Support contact: support@timaxpay.com.

## Problem and solution

Capital sits locked in art inventory and private collections. A full sale gives up a work its owner may want to keep showing, traditional art lenders look at large collections and move slowly, and buyers for a £100,000 work are few while buyers who would put in £500 to £5,000 are many.

TimaxArt turns a work into restricted shares that only verified wallets can hold, and gives its owner three options on Arc:

1. **Borrow against the work.** Shares are posted as collateral and the owner borrows USDC or EURC from verified lenders, up to 38.5% of the appraised value, and repays when ready.
2. **Sell a minority share.** For example sell 30% of the shares and keep 70%. Buyers are verified clients of the TimaxPay app.
3. **A new buyer channel.** Shares are sold in a pool or by bank transfer through an escrow, with the price held within ±3% of the independent appraisal.

Credit is valued on the appraisal, not on the thin pool price, so a small pool cannot push a loan into liquidation.

## What we have today: live on Arc

Two lots are live on Arc (chain 5042): **ART001 "Vernissage 2"** (oil on canvas, valued at £10,000, 10,000 shares) and **ART002 "Dream"** (carved marble sculpture by Alexey Vladimirov, valued at £100,000, 100,000 shares). One share has a reference price of £1.00, which is 1.3107 USDC or 1.194973 EURC. Each product below is a separate contract or module, and they share one verified-wallet list and one valuation per lot.

| Product | What the client gets | State today |
| --- | --- | --- |
| Art share token | A restricted ERC-20 fraction of one work; only verified wallets can hold it | Live, both lots |
| Permissioned pool (Uniswap v4) | Buy shares with USDC or EURC; the fee falls from 5.00% to 0.50% | Live, both lots |
| Credit market (Morpho Blue) | Borrow USDC or EURC against shares, or lend to borrowers; maximum loan 38.5% of value | Live on both lots; a full lending and borrowing cycle on ART002 (supply, collateral, borrow, repay, withdraw) checked with real transactions on 25 and 26 Nov 2026 |
| Lender bonus | Bonus from TimaxArt: 20% a year on USDC supplied, paid if the supply stays 90 days in a row | Live in the app (rate, hold period and budget set in the admin panel); first payout on a real chain is a grant deliverable |
| Buyback note | A fixed payout on a set date, with the full payout reserved in the contract first | Live on ART001; none on ART002 |
| Bank transfer | Buy or sell shares by SEPA or bank payment link through the P2P escrow | ART002: one share settled through the escrow on 25 Nov 2026 (test between our own wallets); no bank-transfer sale yet |
| Admin panel | Gallery, funds, bonus, verified wallets, balances and closing a lot | Live |

**What is proven and what is not yet.** Seen working on ART001: the pool, the credit market and a buyback series. Also seen working on ART002, in test transactions between our own wallets on 25 and 26 Nov 2026: a pool purchase, a full credit cycle of 0.403695 USDC (supply, collateral, borrow, repay, withdraw) and one share settled through the P2P escrow. Not yet done: the first bank-transfer sale of a share, the first use by a client outside our team, the first lender-bonus payout on a real chain, and an independent smart-contract audit. We list these as grant deliverables, not as shipped.

Around the art product, TimaxPay already runs a P2P escrow V3 on Arc with Stripe and Monerium bank rails, an Arc credit market on Morpho Blue, an Arc EURC/USDC Uniswap v4 pool, a live multi-aggregator bridge with CCTP v2, an FX exchange with Chainlink sanity bands, and MoneyGram SEP-24 non-custodial cash-out and cash-in on Stellar mainnet in production (cash-out in more than 170 countries, cash-in in more than 25). Revenue lines already exist in TimaxPay: a platform fee on swaps and routes and the P2P escrow platform fee.

**Evidence for each claim.** Each figure can be checked at the source named.

| Claim | Figure | Where to verify |
| --- | --- | --- |
| SME clients on Stripe and Monerium rails | 12 SMEs | Stripe and Monerium dashboard exports (redacted, dated), attached |
| Volume settled on those rails | €1,450,000 | Same exports, with the period stated, attached |
| Art share tokens ART001 and ART002 | 2 lots; 10,000 and 100,000 shares | ART001 share 0x7b597b8D121D2E5DAEF5649dc1d8AE79E8E6Dd47; ART002 share 0xc808fCF5ccF25D57949a940CDcC2c91B4643D9E5 (source verified on the Arc explorer) |
| Permissioned pools | 4,900 of 10,000 shares offered on ART001 (49%); 49,000 of 100,000 on ART002 (49%) | Pool creation: ART001 on 23 Nov 2026, ART002 on 24 Nov 2026 (hashes at github.com/TimaxGlobal/timaxart-arc, docs/EVIDENCE.md). Hook 0xdbdf4cbaa958692092b46b53b50e49e0b9712880 |
| ART001 credit market and buyback series | Live and seen working | Markets created 23 Nov 2026 (USDC 0x251cd39c…5c2f, EURC 0xab4650d4…5f57); note contract 0x4Fa0ad4D822d461E4bf53e9Ff0771Ab771fAE135, series #0 started 23 Nov 2026; full hashes in docs/EVIDENCE.md in the repo |
| ART002 oracles and escrow | Both oracles accepted by the Safe; escrow set up; bank-transfer readiness check returns ready | USDC oracle 0x2e26306a80861584ce81afd9c41d2076766af642, EURC oracle 0x685990c09f20c3eb03a1f17f70f85719b5a172bd; Safe batch 0x61196b7a85139d15ffe34d186793426478fcaeb4fe6e3d85c4f7d00018f47c91 (24 Nov 2026). ART002/USDC credit cycle, 25–26 Nov 2026: supply 0x4c5f4815…8d3b, collateral 0xdf0642aa…1b08, borrow 0x538ba60a…b15e, repay 0x50441e12…4f9d, collateral withdrawn 0x1802220d…cdd, lender withdrawal 0x8078d080…4fd3; escrow settlement 0x9556c7e0…0672 and 0x648d64db…73e3. Full hashes in docs/EVIDENCE.md in the repo |
| P2P escrow V3 on Arc | 14 deals, $850,000 | Contract `0xfacD92D54f1b1850C9067A97B8248029143A33BB` on the Arc explorer, with the list of deal transaction hashes; the art lots use escrow V5.2 at 0x007dee5a43FF48e15596702bca9ED87c51e8aEEf (verified source) |
| Arc credit factory and Safe | Deployed, Safe-owned | `0xCC6c3c84d6fBfd6f1Da4131f14de37878dCfce15` and Safe `0x54030De9e5AC2De5E9d1E073a914B527A314C7d3`; Morpho Blue on Arc `0x34CD04070dD72b14E241112F6d83812Df5Af7fCD` (Morpho's contract, the base of our markets) |
| Arc EURC/USDC pool, live and tested 16 November 2026 | Plain Uniswap v4 pool, no hook, client-signed positions | Pool ID `0xeb0fd02fb8044d5514fb6e165ee134fd547eff0378bb33b76f4b81d8b03bd1ae` on PoolManager `0x8366a39CC670B4001A1121B8F6A443A643e40951`; PositionManager `0x6049c9a0e26405C0985f9E3685C87d0aE917f82B` |
| Arc cirBTC/USDC vault (Uniswap v3) | In the app: vault card and a swap route | Pool `0x82916bee18fCEF517B26C72d7Cb5F13694E1dB41`, fee 0.01% |
| Uniswap v4 hook precedent | 12 auction lots on Polygon | Hook `0x2d47F85cbd93F8a1BdC9518cD418C8f284CB5080`, with the list of lots and transaction hashes |
| MoneyGram cash-out and cash-in | In production: 170+ and 25+ countries | Country coverage as published by MoneyGram; [completed cash-out and cash-in counts and Stellar explorer links to be attached] |

## What we will build with the grant

$35,000 over 3 months funds the next layer on top of what is live: an independent security review and the legal base, live USDC and EURC credit markets with outside users, the first on-chain lender bonus payout and a second gallery artwork. The mainnet scale-up, seed liquidity and the collection token are a follow-on, not requested in this application. **Not funded here:** marketing, the buyback-note payout reserve (a cost to the issuer, paid from TimaxArt's own cash), public or retail distribution, the AI-managed liquidity vault (next phase), and our separate auction prediction market, which is a different product and application.

| Workstream | What exists today | What the grant builds | Milestone |
| --- | --- | --- | --- |
| 1. Review and legal base | New contracts, not yet audited; no named valuer or counsel view | Independent review of the share token, KYC hook, appraisal oracle and credit factory with findings fixed; counsel's view on the share's legal form and promotion rules; signed valuation for ART002 | M1 |
| 2. Control | The Safe owns both ART002 oracles and is admin of the ART002 share; hook admin, KYC operator, 51,000 ART002 shares and pool positions are still on the deployer wallet | Every role, share and position moved to the Safe before outside investors are invited | M1 |
| 3. Live credit with outside users | ART001 and ART002 pools and credit cycles checked with our own wallets | Live USDC and EURC credit markets on Arc mainnet; 5 outside verified wallets and one outside loan borrowed and repaid in M1, 10 outside wallets by M2 | M1, M2 |
| 4. Lender bonus and second artwork | Bonus live in the app; no payout on a real chain yet | First on-chain bonus payout through a Safe batch; a second gallery artwork with its own oracle | M2 |
| 5. Results | Evidence file with hashes | Public results report and updated video | M2 |
| 6. Collection token and open interfaces | One-holder share token already works as a whole-painting token | Follow-on, not funded here | Follow-on |

## Why Arc and Circle

Arc is where the art product settles, and Circle products are structural parts of it, not add-ons.

| Circle building block | Role in the project |
| --- | --- |
| USDC on Arc | Quote asset of every pool, loan and lender asset, and the reference price of a share (1.3107 USDC per £1.00) |
| EURC on Arc | Euro leg: euro-priced buying, borrowing and notes (1.194973 EURC per £1.00), and the Arc USDC/EURC pool |
| CCTP v2 | Brings USDC from other chains to buy shares or lend, and sends it back (already integrated in TimaxPay) |
| Circle SDK / Wallets | Client onboarding and signing flows (already integrated) |
| Arc | Deterministic settlement and predictable fees for valuation updates, liquidations, bonus payouts and note payouts |

**Arc is our home chain.** We are replacing Polygon with Arc across our products because enterprise clients are more comfortable settling on a chain built by a regulated stablecoin issuer, with deterministic settlement and predictable fees, than on a general-purpose chain. That is why the P2P deal escrow (`0xfacD92D54f1b1850C9067A97B8248029143A33BB`), the credit factory (`0xCC6c3c84d6fBfd6f1Da4131f14de37878dCfce15`) and the Safe (`0x54030De9e5AC2De5E9d1E073a914B527A314C7d3`) were built for Arc first, and why both art lots live there.

Lending and borrowing is one of Circle's priority areas, and Arc's own lending guidance asks for tokenised real-world credit assets with transfer restrictions and KYC: that is this product. The focus use cases map directly: **treasury management** (galleries and collectors raise stablecoin credit against an asset they keep, and lenders earn the market rate plus a bonus), **stablecoin FX** (works valued in pounds are priced in USDC and EURC) and **payments** (SEPA or a bank payment link buys Arc shares through an escrow).

## How the product works

1. **Art share token.** One ERC-20 per artwork. A transfer works only if the receiving wallet is verified on the Arc KYC hook, or is an exempt address (the Safe, the P2P escrow, the fee treasury, the pool manager). A valuation oracle reports the price per share in USDC and EURC: a lower valuation applies at once, a higher one is limited to +10% a week, and the oracle flags itself stale if it is not renewed.
2. **Permissioned pool (Uniswap v4).** Shares are sold from a one-sided pool: only shares were put in, so clients buy with USDC or EURC and nobody can sell into an empty pool. The hook checks every swap (verified wallets, allowed quote tokens and routers only). The fee starts at 5.00% after quiet periods and decays to a 0.50% base over 3 days, which discourages quick flipping. ART001 offers 4,900 of its 10,000 shares; ART002 offers 49,000 of 100,000.
3. **Credit market (Morpho Blue).** Clients supply USDC or EURC to a Morpho Blue market per lot, or post shares as collateral and borrow. Loans are valued on the appraisal oracle, with a maximum loan to value of 38.5%. A loan above 38.5% can be liquidated. The art card talks to Morpho directly, because the share token only allows verified wallets and Morpho itself.
4. **Lender bonus.** TimaxArt adds a bonus on top of the market rate for lenders who stay. Rate, hold period, budget and end date are set in the admin panel; a lender who withdraws before the hold ends loses the pending bonus. The backend keeps the ledger, snapshots each lender's balance and prepares a payment batch for the Safe.
5. **Buyback note (fixed return).** A series has a price, a fixed return (capped at 30% a year) and a term of 7 to 730 days. The whole payout is placed in the contract before the note is sold, and the admin can withdraw only money that nobody is owed. At maturity the holder takes the fixed payout or keeps the shares. The return is paid from TimaxArt's own cash, so this product is a cost to the issuer, not income. It is not a bank deposit and is not insured.
6. **Bank-transfer sales (P2P escrow).** The seller posts an offer and the escrow locks the shares. The buyer pays by SEPA or a bank payment link, and the shares are then released. The price must stay within ±3% of the appraisal, and an unverified buyer is refused before anything is charged. A new lot joins this list automatically when it is published.
7. **Admin panel.** One panel inside the art card, behind an allowed wallet list and a password (5 failed logins in 15 minutes lock it out; a session lasts 2 hours). Tabs: Gallery, Note reserve and series, Lender bonus, Verified wallets, Balances and Close lot. Contract actions are sent directly when the connected wallet is the contract admin; otherwise the panel writes a Safe batch file for the owners to sign, and every action is logged.

**A lot goes live in five steps:** describe the work (title, artist, valuation, photos, report); launch it on Arc (share token, sale pools, credit markets); publish the site files (hidden in the panel); the Safe signs one file (oracles accepted, escrow set up; wallets are verified separately); then one tick on "Published" opens the pool, credit and bank transfer to clients. Closing a lot is a checklist read live from the chain: all money must be withdrawn before a lot can be hidden or deleted.

**Worked example: a £100,000 sculpture.** These are calculations, not offers.

| Option | What happens | Result |
| --- | --- | --- |
| Borrow, maximum | 38.5% of 131,070 USDC value | About 50,460 USDC (about £38,500) |
| Borrow, comfortable | Under 20% of value | About 26,214 USDC |
| Sell 30% | 30,000 of 100,000 shares | About 39,321 USDC before the pool fee (0.5% to 5%) |
| Lend | 10,000 USDC at a 20% a year bonus for 90 days | About 493.15 USDC of bonus, plus variable market interest |
| Fixed-return note | 1,000 USDC at 8% for 90 days | 1,019.73 USDC |

A loan near the limit can be liquidated if the valuation falls, so the comfortable level is the one to plan with.

## Safety and control

- **Verified buyers only.** Shares can be held only by verified wallets, so every counterparty is known.
- **Appraisal, not the pool price, sets credit.** A thin pool cannot push loans into liquidation. A higher valuation can rise only 10% a week; a lower one applies at once.
- **Reserve first.** A note is sold only after its whole payout is in the contract.
- **A falling fee.** The pool fee starts at 5.00% and drops to 0.50% over 3 days, which favours holders over flippers.
- **Controlled by a multi-signature Safe.** The Safe (`0x54030De9e5AC2De5E9d1E073a914B527A314C7d3`, 2 of 3) holds contract authority. It already owns both ART002 oracles and is the admin of the ART002 share.
- **Checked before a lot closes.** Balances, reserves and bonus ledgers are read from the chain and must be clear before a lot can be closed.

**Still on the deployer wallet today:** the hook admin and KYC operator, the 51,000 ART002 shares and probably the pool position NFTs. A single hot key still holds them, so they move to the Safe in M1, before any outside investor is invited. The contracts are new and not yet independently audited.

## First external lot and collection token

**The offer to a gallery owner or collector: keep the work, unlock its value.** The owner raises cash against a work, or sells a minority share of it to verified buyers, without selling the piece.

- **The owner keeps** the work in their care and on display, and a majority holding if they sell a minority share. Who decides on a future sale of the work is set in the legal papers, not by the token.
- **We need** a named independent valuer, the work's provenance papers, insurance details and a company (SPV) that holds or pledges the work. The legal structure is drawn up with counsel before any share is issued.
- **Fees** for a pilot are agreed with the owner. We would rather price a first work together than quote a schedule that has not been tested.
- **Next step:** a 30-minute call about one work the owner would like to test, then a pilot with that single work and small amounts, and a joint decision on whether to widen it.

**Collection token (proposed, tested with collectors before it is built).** A share token with a single holder already works as "the whole painting as one token": a collector holds all shares and borrows against them without selling. The next step is a private basket token that bundles several works of one owner, so a collector can borrow against a collection. We will interview 5 collectors or gallery owners in M2 and build it in the follow-on tranche only if they confirm the demand.

## Team

The team is the same one that built TimaxPay and that stands behind our Innovate UK Frontier AI application.

| Name | Role | Background |
| --- | --- | --- |
| Valerii Tkachenko | Founder, CEO, team lead and lead developer | 20+ years in finance, statistics, maths and AI development; PhD in Technical Engineering; investment management and insurance (1993 to 2011); founder and CEO of Timax Global Ltd (UK) since 2017 |
| Ivan Istomin | CTO | 18 years in retail banking and payments (Kredyt Bank, UkrSibbank, FidoBank, BNP Paribas); CEO and co-founder of PayForce LLC, Ukraine |
| Ivanna Fedko | Mathematics and statistics | 15 years in statistical modelling and calculation; M.A. in Economics (Kyiv National Economic University); economic research and public-finance policy, with study visits and internships at the UK and Serbian parliaments (House of Commons Library Scrutiny Unit; Parliamentary Budget Office of Serbia) |

The wider team is 7 people, with outside counsel and a named valuer to be engaged for the pilot. Technical ownership is clear: one lead developer ships contracts, backends and frontends, and the CTO owns payments, compliance and integrations. Everything listed as live above was built by this team.

## Milestones, budget and KPIs

Three months, two milestones, each paid on delivery. The mainnet pilot is a follow-on tranche, not requested now. Budget: **$35,000**.

| Month | Milestone | Deliverable (the gate) | Payment |
| --- | --- | --- | --- |
| 1–2 | M1: Review, legal base and live credit markets | Independent review of the share token, KYC hook, appraisal oracle and credit factory with findings fixed; counsel's view on the share's legal form and promotion rules; signed valuation for ART002; hook admin, KYC operator, ART002 shares and pool positions moved to the Safe; live USDC and EURC credit markets on Arc mainnet (38.5% maximum loan to value); first outside verified lenders and borrowers: 5 outside verified wallets and one outside loan borrowed and repaid, with hashes on arc.etherscan.io. Partners: Circle (USDC, EURC), Uniswap v4, Morpho Blue, Safe | $20,000 |
| 3 | M2: Bonus payout, second artwork and results | First on-chain lender bonus payout (+20% a year after 90 days of supply) through a Safe batch, with its hash; a second gallery artwork from TimaxArt Limited with its own oracle; 10 outside verified wallets; public results report with volume, users, loan to value and incidents; updated video. Partners: as M1 | $15,000 |
| Later | Follow-on: mainnet scale-up and collection token | Seed liquidity for an external lot, the collection token if collector interviews confirm demand, open-source interfaces and documentation. Not requested now | Not requested now |

**Use of the $35,000** (proposed split, to confirm):

| Item | Amount |
| --- | --- |
| Engineering (contract fixes after review, oracle and Safe work, backend, admin panel) | $12,000 |
| Independent security review | $8,000 |
| Legal structuring, SPV and valuation | $9,000 |
| Infrastructure, data and oracle running costs | $4,000 |
| Pilot onboarding and documentation (no marketing) | $2,000 |
| Seed liquidity for an external lot | $0 (follow-on) |
| **Total** | **$35,000** |

**KPIs at month 3** (targets to confirm):

- Independent review published, with no open high-severity findings
- Every admin role, share and pool position under the Safe, with zero single-key holdings
- At least 10 verified wallets outside our team holding or lending against shares, and at least one outside loan borrowed and repaid, each with a published transaction hash
- The first lender bonus payout completed on Arc mainnet, with its hash
- A second gallery artwork live with its own oracle
- Public results report with USDC and EURC volume, users, loan to value and any incident

## Ecosystem impact, risks and compliance

**Impact on Arc.** Every pool and credit market needs USDC or EURC liquidity, and every borrower and lender holds and moves stablecoins on Arc. The permissioned pool hook, the verified-wallet check and the open interfaces give other teams a working pattern for restricted real-world-asset shares on Arc. A euro and sterling product brings EU, UK and Swiss galleries, collectors and SMEs onto Arc.

**Risks and mitigations.**

- **Legal form of a share.** Whether a share is company equity, a beneficial interest or a contract claim decides regulation, accounting and tax. Counsel draws the structure up before any share is issued to an outside investor, and the pilot starts with one work and small amounts.
- **UK financial promotion.** The investor pitches may count as promotions to UK persons. Nothing is distributed to retail clients until an FCA-authorised approver has reviewed it; shares are held only by verified wallets.
- **Wording.** A fixed-return note depends on its reserve in the contract and is not a bank deposit and not insured; we do not describe it as a guarantee in public text until counsel has approved the wording.
- **Smart-contract risk.** The contracts are new with no track record: an independent audit is ordered before real money from outside clients, the Safe holds control, the fee and loan limits are set in the contracts, and the first live amounts are small.
- **Valuation risk.** The credit rests on the appraisal. A named independent valuer and insurer are required per lot, a lower valuation applies at once, a higher one is limited to +10% a week, and a loan above 38.5% can be liquidated. Art values can fall and selling shares depends on other buyers, so we state the comfortable borrowing level (under 20%) next to the maximum.
- **Single-key risk.** The hook admin, KYC operator, ART002 shares and probably the pool positions are still on the deployer wallet; moving them to the Safe is the first gate in M1.
- **Unproven parts.** The first outside loan and the first lender-bonus payout have not yet been done on a real chain; each is a milestone deliverable with a published transaction hash.
- **Issuer cost.** The fixed return and the lender bonus are paid from TimaxArt's own cash, so they are a cost to the issuer, with budget and caps set in the contracts and the admin panel.
- **Demand for the collection token.** It is built only if 5 collector or gallery interviews confirm demand.
- **Regulatory risk.** Non-custodial design; shares restricted to verified wallets; legal advice before any fee-based live offering under the UK cryptoasset regime and the EU rules that apply to the clients served.
