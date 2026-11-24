# Evidence (addresses)

Chain: Arc mainnet, chain ID 5042, RPC https://rpc.mainnet.arc.io. Source: `offer/paintings/*/painting.json` and `launch.arc.json` in this repo. Transaction hashes are still to be added.

## Shared infrastructure
| Item | Address |
|---|---|
| Safe (2 of 3) | 0x54030De9e5AC2De5E9d1E073a914B527A314C7d3 |
| Art pool hook | 0xdbdf4cbaa958692092b46b53b50e49e0b9712880 |
| Swap router | 0xa52aaae57645bb796cb449502810579d31f5ba43 |
| Uniswap v4 PoolManager | 0x8366a39CC670B4001A1121B8F6A443A643e40951 |
| Uniswap v4 PositionManager | 0x6049c9a0e26405C0985f9E3685C87d0aE917f82B |
| Morpho Blue | 0x34CD04070dD72b14E241112F6d83812Df5Af7fCD |
| Morpho interest rate model | 0xf02615d094fc02fc031c35fe705e175aa4653f20 |
| USDC | 0x3600000000000000000000000000000000000000 |
| EURC | 0xbef5f6d51cb62b58e6a8f77868681825c6fe21c1 |

## ART001 "Vernissage 2" (valued at GBP 10,000; 10,000 shares, 4,900 offered)
| Item | Address or ID |
|---|---|
| Share token | 0x7b597b8D121D2E5DAEF5649dc1d8AE79E8E6Dd47 |
| Buyback note | 0x4Fa0ad4D822d461E4bf53e9Ff0771Ab771fAE135 |
| USDC oracle | 0xD78F940F3bE804127AA39E4d16d9Ec2338cd7832 |
| USDC Morpho market | 0x251cd39c79406c9854fd09aef9cc57ab97e7caa0acc1a792d5714c5708835c2f |
| EURC oracle | 0xedB1cf7fed68c49760fdBd6FFAFF121B9f20aA2d |
| EURC Morpho market | 0xab4650d45e77da93da2bd5d567a0bac4726ca57a214866450670417bf30f5f57 |

## ART002 "Dreams" (valued at GBP 100,000; 100,000 shares, 49,000 offered)
| Item | Address or ID |
|---|---|
| Share token | 0xc808fCF5ccF25D57949a940CDcC2c91B4643D9E5 |
| USDC oracle | 0x2E26306a80861584Ce81AFD9C41d2076766aF642 |
| USDC Morpho market | 0x85d332e86c5c30b7eaa1547e99e29494e553c84b57da89652e2d82b1e780f080 |
| EURC oracle | 0x685990C09F20c3Eb03a1f17F70f85719b5A172bd |
| EURC Morpho market | 0xe413da7c5b246ac1187db8cf31e29537d0b357b94687d77fdacc44ea7d4ea828 |

Maximum loan to value on both lots: 38.5%. Valuer, custodian and owner of both works is TimaxArt Limited; there is no independent valuation yet.

## Safe transaction batches
Safe batch files are in `bonus/`: verification (`safe-kyc-*`), oracle acceptance (`safe-accept-oracles-ART002.json`), buyback note (`safe-note-*`) and P2P escrow setup (`safe-p2p-*`). Executed transaction hashes: to be added.
