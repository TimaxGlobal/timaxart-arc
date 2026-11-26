# On-chain evidence

Generated 2026-11-26T14:24:47.287Z from Arc (chain 5042) logs. Every hash below can be opened in the explorer.

## ART002 Dreams

| Contract | Address | Source code |
|---|---|---|
| hook | `0xdbdf4cbaa958692092b46b53b50e49e0b9712880` | [Verified](https://arc.etherscan.io/address/0xdbdf4cbaa958692092b46b53b50e49e0b9712880#code) |
| router | `0xa52aaae57645bb796cb449502810579d31f5ba43` | [Not verified (stateless, holds no funds)](https://arc.etherscan.io/address/0xa52aaae57645bb796cb449502810579d31f5ba43#code) |
| share | `0xc808fCF5ccF25D57949a940CDcC2c91B4643D9E5` | [Verified](https://arc.etherscan.io/address/0xc808fCF5ccF25D57949a940CDcC2c91B4643D9E5#code) |
| poolManager | `0x8366a39CC670B4001A1121B8F6A443A643e40951` | [Third-party contract](https://arc.etherscan.io/address/0x8366a39CC670B4001A1121B8F6A443A643e40951#code) |
| morpho | `0x34CD04070dD72b14E241112F6d83812Df5Af7fCD` | [Third-party contract](https://arc.etherscan.io/address/0x34CD04070dD72b14E241112F6d83812Df5Af7fCD#code) |
| safe | `0x54030De9e5AC2De5E9d1E073a914B527A314C7d3` | [Third-party contract](https://arc.etherscan.io/address/0x54030De9e5AC2De5E9d1E073a914B527A314C7d3#code) |
| P2P escrow V5.2 | `0x007dee5a43FF48e15596702bca9ED87c51e8aEEf` | [Verified](https://arc.etherscan.io/address/0x007dee5a43FF48e15596702bca9ED87c51e8aEEf#code) |
| USDC appraisal oracle | `0x2e26306a80861584ce81afd9c41d2076766af642` | [Verified](https://arc.etherscan.io/address/0x2e26306a80861584ce81afd9c41d2076766af642#code) |
| EURC appraisal oracle | `0x685990c09f20c3eb03a1f17f70f85719b5a172bd` | [Verified](https://arc.etherscan.io/address/0x685990c09f20c3eb03a1f17f70f85719b5a172bd#code) |

### Pool creation (Uniswap v4, KYC hook)

- ART002/USDC pool `0xfe50488b16d9104e443bd6d3ef23c2f1d32365fd577a82bf75b61e54da224dd5`: [`0x72f076ca36d3dcc41cce4e52875c3962675fb51bce150f88996effde6a541ec0`](https://arc.etherscan.io/tx/0x72f076ca36d3dcc41cce4e52875c3962675fb51bce150f88996effde6a541ec0) (block 32904981, 2026-11-24T12:32:20Z)
- ART002/EURC pool `0x116f6a4f7065b607933dd78a7f74764c428e03308c34dfdd0cc9aaeae898affc`: [`0x050ddd92424ca4b9b4523606d68a1e2af6d6e3d7063d7977ea65e2b5945db16a`](https://arc.etherscan.io/tx/0x050ddd92424ca4b9b4523606d68a1e2af6d6e3d7063d7977ea65e2b5945db16a) (block 32904981, 2026-11-24T12:32:20Z)

### Morpho markets (credit)

- ART002/USDC market `0x85d332e86c5c30b7eaa1547e99e29494e553c84b57da89652e2d82b1e780f080`
  - created: [`0x63f1e6e5bd6df0af4b97d29b541d0a6144be5267093f23eb041d73ee4081810d`](https://arc.etherscan.io/tx/0x63f1e6e5bd6df0af4b97d29b541d0a6144be5267093f23eb041d73ee4081810d) (2026-11-24T12:32:27Z)
  - first supply: [`0x4c5f4815c5bffeaa20cae2c3ec2c080ea16ca6a2056caeacf03a545052d78d3b`](https://arc.etherscan.io/tx/0x4c5f4815c5bffeaa20cae2c3ec2c080ea16ca6a2056caeacf03a545052d78d3b) (2026-11-25T14:13:47Z)
  - credit activity:
    - lender supplied 5 USDC: [`0x4c5f4815c5bffeaa20cae2c3ec2c080ea16ca6a2056caeacf03a545052d78d3b`](https://arc.etherscan.io/tx/0x4c5f4815c5bffeaa20cae2c3ec2c080ea16ca6a2056caeacf03a545052d78d3b) (2026-11-25T14:13:47Z)
    - collateral posted 1 ART002: [`0xdf0642aafb54ac341c61d0fe8c701d8629ca25caec8362f6cf86dd4abc7d1b08`](https://arc.etherscan.io/tx/0xdf0642aafb54ac341c61d0fe8c701d8629ca25caec8362f6cf86dd4abc7d1b08) (2026-11-25T14:14:55Z)
    - borrowed 0.403695 USDC: [`0x538ba60a1d11535cc13445928c79fc1568b68b6aa9c5c1521808448a9d47b15e`](https://arc.etherscan.io/tx/0x538ba60a1d11535cc13445928c79fc1568b68b6aa9c5c1521808448a9d47b15e) (2026-11-25T14:15:00Z)
    - repaid 0.403695 USDC: [`0x50441e1296dc7cf2b521c1fc0419a045c0c0fdc4f03f893985bc3ac6f2eb4f9d`](https://arc.etherscan.io/tx/0x50441e1296dc7cf2b521c1fc0419a045c0c0fdc4f03f893985bc3ac6f2eb4f9d) (2026-11-25T14:15:27Z)
    - collateral withdrawn 1 ART002: [`0x1802220d1b8dc339127eea81ea11e6a61ff91c0b6d93a4e926aa6d0ba4edacdd`](https://arc.etherscan.io/tx/0x1802220d1b8dc339127eea81ea11e6a61ff91c0b6d93a4e926aa6d0ba4edacdd) (2026-11-25T14:26:54Z)
    - lender withdrew 5 USDC: [`0x8078d080b2ca356d09d9f81a6bf6c7196b19244a19741076fed7f9cbac5c4fd3`](https://arc.etherscan.io/tx/0x8078d080b2ca356d09d9f81a6bf6c7196b19244a19741076fed7f9cbac5c4fd3) (2026-11-26T00:22:33Z)
- ART002/EURC market `0xe413da7c5b246ac1187db8cf31e29537d0b357b94687d77fdacc44ea7d4ea828`
  - created: [`0x421c24e60441f20bcf599a8a83f5059da6d4312985cde2e3819ddfbbac1fd6af`](https://arc.etherscan.io/tx/0x421c24e60441f20bcf599a8a83f5059da6d4312985cde2e3819ddfbbac1fd6af) (2026-11-24T12:32:27Z)

### Buyback note series

- No note contract recorded for this painting.

### Safe batches (multisig executions touching ART002)

- [`0x61196b7a85139d15ffe34d186793426478fcaeb4fe6e3d85c4f7d00018f47c91`](https://arc.etherscan.io/tx/0x61196b7a85139d15ffe34d186793426478fcaeb4fe6e3d85c4f7d00018f47c91) (block 32970444, 2026-11-24T21:45:00Z)

### ART002 share movements (P2P escrow, pool, credit, transfers)

- 100,000 ART002: mint/burn → 0x55e5…4ccc: [`0xe8580267e8b365dafb25d66a2b948f4ed197c4266a71e8cd1bf7f43c696aac22`](https://arc.etherscan.io/tx/0xe8580267e8b365dafb25d66a2b948f4ed197c4266a71e8cd1bf7f43c696aac22) (2026-11-24T12:32:20Z)
- 24,500 ART002: 0x55e5…4ccc → pool manager: [`0x6486f90150aaf42348dea4e64a0f074875c8387a3c94add32f38e45661c6b858`](https://arc.etherscan.io/tx/0x6486f90150aaf42348dea4e64a0f074875c8387a3c94add32f38e45661c6b858) (2026-11-24T12:32:20Z)
- 24,500 ART002: 0x55e5…4ccc → pool manager: [`0x18e025f320088564ef768483a402984e27ad625604ca1630655c40b62d47c79c`](https://arc.etherscan.io/tx/0x18e025f320088564ef768483a402984e27ad625604ca1630655c40b62d47c79c) (2026-11-24T12:32:20Z)
- 3.6785 ART002: pool manager → 0x518d…c252: [`0x6e6ae16779797b82fc5365b43f219dc7d4f6b3fe5d05b80069907c700f7ce23c`](https://arc.etherscan.io/tx/0x6e6ae16779797b82fc5365b43f219dc7d4f6b3fe5d05b80069907c700f7ce23c) (2026-11-25T14:13:18Z)
- 1 ART002: 0x518d…c252 → Morpho (credit): [`0xdf0642aafb54ac341c61d0fe8c701d8629ca25caec8362f6cf86dd4abc7d1b08`](https://arc.etherscan.io/tx/0xdf0642aafb54ac341c61d0fe8c701d8629ca25caec8362f6cf86dd4abc7d1b08) (2026-11-25T14:14:55Z)
- 1 ART002: Morpho (credit) → 0x518d…c252: [`0x1802220d1b8dc339127eea81ea11e6a61ff91c0b6d93a4e926aa6d0ba4edacdd`](https://arc.etherscan.io/tx/0x1802220d1b8dc339127eea81ea11e6a61ff91c0b6d93a4e926aa6d0ba4edacdd) (2026-11-25T14:26:54Z)
- 2 ART002: 0x518d…c252 → P2P escrow: [`0x6c46b5b43c4be1c89fca162dd401dc4df1e683b20f4ed582c22d864e268d0b06`](https://arc.etherscan.io/tx/0x6c46b5b43c4be1c89fca162dd401dc4df1e683b20f4ed582c22d864e268d0b06) (2026-11-25T14:31:38Z)
- 0.0025 ART002: P2P escrow → fee treasury: [`0x9556c7e098770b0cad6136e3d0ebaf46e4f564160ef4510a6be7f3f77bb90672`](https://arc.etherscan.io/tx/0x9556c7e098770b0cad6136e3d0ebaf46e4f564160ef4510a6be7f3f77bb90672) (2026-11-25T21:22:53Z)
- 0.9975 ART002: P2P escrow → 0xff90…46a1: [`0x9556c7e098770b0cad6136e3d0ebaf46e4f564160ef4510a6be7f3f77bb90672`](https://arc.etherscan.io/tx/0x9556c7e098770b0cad6136e3d0ebaf46e4f564160ef4510a6be7f3f77bb90672) (2026-11-25T21:22:53Z)
- 1 ART002: P2P escrow → 0x518d…c252: [`0x648d64db9c2140a0559afad9dcc99b6d8b004bdc97d615f6c719363b39da73e3`](https://arc.etherscan.io/tx/0x648d64db9c2140a0559afad9dcc99b6d8b004bdc97d615f6c719363b39da73e3) (2026-11-26T00:27:37Z)
- 0.9875 ART002: 0xff90…46a1 → 0x518d…c252: [`0xbf5239a02db775b7f1b467c74112ef2e1a1b1ec56804001d22f0ec3d536d8909`](https://arc.etherscan.io/tx/0xbf5239a02db775b7f1b467c74112ef2e1a1b1ec56804001d22f0ec3d536d8909) (2026-11-26T14:00:02Z)

