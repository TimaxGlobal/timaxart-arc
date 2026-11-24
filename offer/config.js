// Edit the painting and legal text by hand. Contract addresses come from deployment.js, which ..\launch-painting.ps1 writes after a launch.
// Preview mode: with "contracts": null the page shows the offer terms only and keeps buying disabled.
window.ART_OFFER = {
  draft: true,                       // true shows a "not approved for public offer" banner. Set false only after legal sign-off.
  appUrl: "https://app.timaxpay.com", // where Lend and Borrow open (existing TimaxPay credit pages)
  painting: {
    title: "Harbour at Dusk",
    code: "ART001",
    artist: "FILL_ME",
    medium: "Oil on canvas",
    imageUrl: "",                    // https:// or data: URL of the painting photo
    appraisalGbp: 10000,
    valuer: "FILL_ME (independent valuer)",
    reportUri: "ipfs://FILL_ME",
    custodian: "FILL_ME (storage and insurance)",
    owner: "FILL_ME (company that holds the painting)"
  },
  offer: { totalShares: 10000, offeredShares: 4900, sharePriceGbp: 1 },
  chain: null,        // { name, chainId, rpc (public RPC, no API key), explorer }
  contracts: null,    // { hook, router, share, poolManager, morpho, safe }
  quotes: [],         // [{ symbol, address, decimals, oracle, marketId }]
  lltv: 0.385
};
