/**
 * PolyExchangeApp.jsx — Timax Global Exchange
 *
 * UNIFIED EXECUTION FIX:
 * Swap & Bridge logic has been completely removed to prevent collisions.
 * The "Swap & Bridge" tab now seamlessly redirects to the global <BridgeModal /> 
 * via the onOpenBridge prop passed down from App.jsx.
 *
 * FX EXCHANGE TAB (added):
 * New same-chain Polygon currency-pair exchange, backed by the verified
 * FX_CURRENCY_REGISTRY_POLYGON on the backend (/api/fx/currencies,
 * /api/fx/quote). Deliberately currency-first — no chain or token pickers,
 * since the whole point is hiding token/chain complexity from SME clients.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Loader2, ArrowDown, X, ShieldCheck, Globe, AlertTriangle, AlertCircle,
  Activity, Wallet, Landmark, CheckCircle2,
  Store, Lock, PlusCircle, ArrowRight, ChevronLeft, Copy,
  Users, Banknote, Clock, RefreshCcw, History, ExternalLink,
} from 'lucide-react';
import { encodeFunctionData, erc20Abi, createPublicClient, http, formatUnits } from 'viem';
import { useDynamicContext } from '@dynamic-labs/sdk-react-core';
import { useToast } from '../context/ToastContext';
import { buildWidgetUrl, generateValidationCode, formatSignatureForMtPelerin, NETWORKS } from './MtPelerinSDK';

import { useWalletContext } from '../context/WalletContext';
import { useWalletActions } from '../hooks/useWalletActions';
import { useUniversalSigner } from '../hooks/useUniversalSigner';
import FxExchangeModal from './FxExchangeModal';
import GatewayTab from './GatewayTab';   // one USDC/EURC balance across chains (Circle Gateway)
import ArbitrageTab from './ArbitrageTab';   // EUR/USD cross-chain arbitrage analysis, priced with the FX Exchange module
import AllChainsMarket from './p2p/AllChainsMarket';   // all chains' USDC offers in one list
import SellForm, { RailPicker, ReleaseCheckbox } from './p2p/shared/SellForm';   // the offer form, shared by every chain
import { useSellForm, sellFormPayload } from './p2p/shared/useSellForm';
import { computeSellQuote } from './p2p/shared/sellQuote';
import StellarP2P from './p2p/StellarP2P';   // Stellar USDC<->EURC P2P (same screens, shown when "Stellar" is picked in the network dropdown)
import AlertSettings from './StockEarn/AlertSettings';
import { UNISWAP_API_BASE } from './config';
import { P2P_API_BASE } from './p2p/p2pApi';
import MarketCheck from './p2p/MarketCheck';
import { useP2PFetch } from './p2p/useP2PFetch';   // NEW: shared Timax session + authenticated p2pFetch (src/components/p2p)

// ─── Constants ────────────────────────────────────────────────────────────────

const PLATFORM_FEE_PERCENT = 0.0025;

const UNISWAP_V3_EURE_USDC_VAULT = '0x8484ef722627bf18ca5ae6bcf031c23e6e922b30';

// 🚨 ADDED ARBITRUM (42161)
const VAULT_ABI = [
  { inputs:[{internalType:'uint256',name:'amount0',type:'uint256'},{internalType:'uint256',name:'amount1',type:'uint256'}], name:'deposit', outputs:[], stateMutability:'nonpayable', type:'function' }
];


// 🚨 ADDED ARBITRUM (42161)
const CHAINS = [
  { id:'1',       name:'Ethereum', logoURI:'https://raw.githubusercontent.com/lifinance/types/main/src/assets/icons/chains/ethereum.svg' },
  { id:'8453',    name:'Base',     logoURI:'https://raw.githubusercontent.com/lifinance/types/main/src/assets/icons/chains/base.svg'     },
  { id:'137',     name:'Polygon',  logoURI:'https://raw.githubusercontent.com/lifinance/types/main/src/assets/icons/chains/polygon.svg'  },
  { id:'42161',   name:'Arbitrum', logoURI:'https://raw.githubusercontent.com/lifinance/types/main/src/assets/icons/chains/arbitrum.svg' },
  { id:'59144',   name:'Linea',    logoURI:'https://raw.githubusercontent.com/lifinance/types/main/src/assets/icons/chains/linea.svg'    },
  { id:'4217',    name:'Tempo',    logoURI:'https://raw.githubusercontent.com/lifinance/types/main/src/assets/icons/tokens/usdc.png'     },
  { id:'5042',    name:'Arc',      logoURI:'https://raw.githubusercontent.com/lifinance/types/main/src/assets/icons/tokens/usdc.png'     },
  { id:'1151111081099710', name:'Solana',  logoURI:'https://assets.coingecko.com/coins/images/4128/small/solana.png'  },
  { id:'stellar', name:'Stellar',  logoURI:'https://cryptologos.cc/logos/stellar-xlm-logo.png'                                         },
];

// 🚨 ADDED ARBITRUM (42161) TOKENS
const FX_TOKENS = {
  '1': [
    { symbol:'USDC',  address:'0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', name:'USD Coin',        decimals:6,  isCCTP:true  },
    { symbol:'USDT',  address:'0xdAC17F958D2ee523a2206206994597C13D831ec7', name:'Tether USD',        decimals:6,  isCCTP:false },
    { symbol:'EURC',  address:'0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c', name:'Circle EURC',      decimals:6,  isCCTP:true  },
    { symbol:'EURe',  address:'0x3231Cb76718CDeF2155FC47b5286d82e6eDA273f', name:'Monerium EUR',      decimals:18, isCCTP:false },
  ],
  '8453': [
    { symbol:'USDC', address:'0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', name:'Native USDC',  decimals:6,  isCCTP:true  },
    { symbol:'EURC', address:'0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42', name:'Circle EURC',  decimals:6,  isCCTP:true  },
  ],
  '137': [
    { symbol:'USDC', address:'0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', name:'Native USDC',   decimals:6,  isCCTP:true  },
    { symbol:'USDT', address:'0xc2132D05D31c914a87C6611C10748AEb04B58e8F', name:'Tether USD',    decimals:6,  isCCTP:false },
    { symbol:'EURC', address:'0x1aBaEA1f7230f38fFB510518858176357CB4f263', name:'Polygon EURC',  decimals:6,  isCCTP:false },
    { symbol:'EURe', address:'0xE0aEa583266584DafBB3f9C3211d5588c73fEa8d', name:'Monerium EUR',  decimals:18, isCCTP:false },   /* Monerium V2 (V1 0x18ec... still works, forwards to V2) */
  ],
  '42161': [
    { symbol:'USDC', address:'0xaf88d065e77c8cC2239327C5EDb3A432268e5831', name:'Native USDC',   decimals:6,  isCCTP:true  },
    { symbol:'USDT', address:'0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', name:'Tether USD',    decimals:6,  isCCTP:false },
    { symbol:'EURC', address:'0x90A814AE67Aa823053351e2338c2B4A3cdaA68F8', name:'Circle EURC',   decimals:6,  isCCTP:true  },
  ],
  '59144': [
    { symbol:'USDC', address:'0x176211869cA2b568f2A7D4EE941E073a821EE1ff', name:'Native USDC',   decimals:6,  isCCTP:true  },
  ],
  // Circle Arc (5042). USDC = the ERC-20 interface of Arc's native USDC (6 decimals; gas is paid in USDC). Used by the P2P escrow.
  '5042': [
    { symbol:'USDC', address:'0x3600000000000000000000000000000000000000', name:'USDC (Arc)',   decimals:6,  isCCTP:true  },
    { symbol:'EURC', address:'0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1', name:'Circle EURC',  decimals:6,  isCCTP:true  },
    { symbol:'ART001', address:'0x7b597b8D121D2E5DAEF5649dc1d8AE79E8E6Dd47', name:'Vernissage 2 art share', decimals:18, isCCTP:false },   /* art share: priced from its appraisal, sold to verified wallets only */
  ],
  '4217': [
    { symbol:'pathUSD', address:'0x20c0000000000000000000000000000000000000', name:'Path USD', decimals:6, isCCTP:false },
  ],
  '1151111081099710': [
    { symbol:'USDC', address:'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', name:'Solana USDC', decimals:6, isCCTP:true },
  ],
  'stellar': [
    { symbol:'USDC', address:'USDC-GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN', name:'Stellar USDC',   decimals:7, isCCTP:true  },
    { symbol:'EURC', address:'EURC-GDHU6WRG4IEQXM5NZ4BMPKOXHW76MZM4Y2IEMFDVXBSDP6SJY4ITNPP2', name:'Stellar EURC',   decimals:7, isCCTP:true  },
    { symbol:'XLM',  address:'native',                                                         name:'Stellar Lumens', decimals:7, isCCTP:false },
  ],
};

const toWeiStr = (amountHuman, decimals) => {
  try {
    const str    = parseFloat(amountHuman || 0).toFixed(decimals);
    const [i, f] = str.split('.');
    return BigInt(i + (f || '').padEnd(decimals, '0')).toString();
  } catch { return '0'; }
};

// Safari throws "The string did not match the expected pattern" from response.json() when the server
// returns HTML/empty (404, 502, cold start, wrong backend URL). Read text first and raise a useful error.
// Share link of a seller's offer: https://app.timaxpay.com/?p2pOffer=<id>&k=<token>. Captured when the app loads, whenever the P2P tab is opened later.
const P2P_LINK = (() => { try { const q = new URLSearchParams(window.location.search); const id = q.get('p2pOffer'); return id ? { id: String(id).slice(0, 100), token: String(q.get('k') || '').slice(0, 80) } : null; } catch { return null; } })();
// Direct tab links (QR codes): https://app.timaxpay.com/?p2p=merchant  or  ?p2p=market
const P2P_TAB = (() => { try { const q = new URLSearchParams(window.location.search); const m = q.get('p2p'); if (q.get('open') === 'fx') return 'fx'; return m === 'merchant' ? 'merchant' : (m === 'market' ? 'p2p_market' : null); } catch { return null; } })();
const offerLinkUrl = (id, token) => `${window.location.origin}/?p2pOffer=${encodeURIComponent(id)}&k=${encodeURIComponent(token || '')}`;
const repLine = (r) => !r ? 'New seller' : `${r.completionRate != null ? `${r.completionRate}% completion` : 'No finished trades yet'} · ${r.completed} trade${r.completed === 1 ? '' : 's'}${r.avgMinutes != null ? ` · ~${r.avgMinutes < 60 ? `${r.avgMinutes} min` : `${Math.round(r.avgMinutes / 6) / 10} h`} to complete` : ''}`;
const condLine = (c) => { const a = []; if (c?.minCompleted) a.push(`${c.minCompleted}+ completed trades`); if (c?.minAccountAgeDays) a.push(`wallet active ${c.minAccountAgeDays}+ days`); if (c?.maxOpenPerBuyer) a.push(`max ${c.maxOpenPerBuyer} open trade${c.maxOpenPerBuyer > 1 ? 's' : ''} at a time`); return a.join(' · '); };

const readJson = async (res, label = 'P2P service') => {
  const text = await res.text();
  try { return text ? JSON.parse(text) : {}; }
  catch {
    let path = ''; try { path = res.url ? new URL(res.url).pathname : ''; } catch { /* no url */ }
    const said = String(text || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140);
    const why = res.status === 404 ? 'this route is not installed on the backend (deploy the latest bridge-backend p2p folder)' : res.status >= 500 ? 'the backend crashed or is cold-starting, retry in a minute' : res.status === 401 || res.status === 403 ? 'sign in again' : 'unexpected answer';
    throw new Error(`${label}: HTTP ${res.status}${path ? ` on ${path}` : ''} - ${why}.${said ? ` Server said: "${said}"` : ''}`);
  }
};
const P2P_READ_RPC = process.env.REACT_APP_P2P_READ_RPC || 'https://polygon-rpc.com';
// Chains the P2P escrow runs on (the backend decides which are really enabled: GET /api/p2p/escrow/config). Per-chain read RPCs.
const P2P_CHAIN_IDS = ['137', '5042'];
const P2P_READ_RPCS = { '137': P2P_READ_RPC, '5042': process.env.REACT_APP_P2P_ARC_READ_RPC || 'https://rpc.mainnet.arc.io' };
// Tokens a merchant may LOCK for sale on each P2P chain. Polygon: USDC and USDT. Arc: USDC (buyer pays EURC).
const P2P_SELL_TOKENS = { '137': ['USDC', 'USDT'], '5042': ['USDC', 'ART001'] };
// Art shares are priced from their signed appraisal (backend: GET /api/p2p/escrow/art-check), not as 1 token = 1 USD.
const ART_SYMS = ['ART001'];
const ART_SHARE_ADDRESS = '0x7b597b8D121D2E5DAEF5649dc1d8AE79E8E6Dd47';
const ART_ADDR = { ART001: ART_SHARE_ADDRESS };   // symbol -> share address. Lots added from the Art admin panel and published join this list by themselves (see loadArtLots).
let artLotsLoaded = false;
async function loadArtLots() {   // add every published lot from the gallery to the token lists, once per page load
  try {
    const r = await fetch(`${P2P_API_BASE}/api/art/gallery`); const d = await r.json(); let added = false;
    for (const p of (d && d.paintings) || []) {
      const c = p.deployment && p.deployment.contracts; const sym = String(p.code || '').toUpperCase();
      if (!p.added || p.published !== true || !c || !c.share || !/^[A-Z0-9_-]{2,24}$/.test(sym) || ART_ADDR[sym]) continue;
      ART_ADDR[sym] = c.share; ART_SYMS.push(sym); P2P_SELL_TOKENS['5042'].push(sym);
      FX_TOKENS['5042'].push({ symbol: sym, address: c.share, name: `${p.title || sym} art share`, decimals: 18, isCCTP: false }); added = true;
    }
    artLotsLoaded = true; return added;
  } catch { return false; }
}
// Rails a given sell token supports. USDT is sold for EURe (Monerium) only - Stripe/on-chain are not offered for it.
const P2P_TOKEN_RAILS = {};   // no per-token rail limits: USDC and USDT can be sold for fiat through any rail the seller is verified for
// What the buyer pays with on the on-chain (crypto-for-crypto) rail. It needs no Stripe or Monerium account for the seller.
const P2P_ONCHAIN_PAY = { '137': 'EURe', '5042': 'EURC' };
// The buyer's wallet signs ONE transaction to open a trade and pays its gas in the chain's own coin (Polygon: POL; Arc: USDC). Below `min` we warn first.
// (Later Timax will sponsor this for new social-login wallets; then the warning is switched off per chain by deleting its entry.)
const P2P_GAS = { '137': { sym:'POL', chain:'Polygon', min:0.05 }, '5042': { sym:'USDC', chain:'Arc', min:0.05 } };
const P2P_RAIL_ORDER = ['sepa', 'monerium', 'stripe', 'onchain'];   // fiat rails first: sellers are paid fiat by default; on-chain (crypto-for-crypto) only as the fallback
// Symbol of the token the seller locked, derived from the offer/order token address (falls back to USDC).
const sellSymOf = (o, chainId) => {
  const a = String(o?.tokenAddress || '').toLowerCase();
  const cid = String(o?.chainId || chainId || '137');
  const hit = a && (FX_TOKENS[cid] || []).find(t => String(t.address).toLowerCase() === a);
  return hit ? hit.symbol : (o?.tokenSymbol || 'USDC');
};
const P2P_RAIL_LABEL = { stripe:'Stripe · bank payment', sepa:'SEPA · pay from any bank', monerium:'Monerium · EURe', onchain:'On-chain · crypto swap' };
// Symbol of the token the BUYER escrows for this order: EURe (Monerium, Polygon) or e.g. EURC (on-chain rail, Arc).
const legSymOf = (o) => (o?.rail === 'onchain' ? (o.fiatTokenSymbol || 'EURC') : 'EURe');
const P2P_RAIL_SHORT = { stripe:'Stripe', sepa:'SEPA', monerium:'Monerium', onchain:'On-chain' };
const STRIPE_STATUS_LABEL = { VERIFIED: 'Payouts enabled', PAYOUT_ELIGIBLE: 'Payments & payouts enabled' };
// A bank payment (Stripe Checkout) needs 31+ minutes before the order expires. Below that the order can no longer be paid.
const MIN_BANK_PAY_SEC = 1860;
const bankSecLeft = (o) => (o && o.expiresAt ? Number(o.expiresAt) - Math.floor(Date.now() / 1000) : null);
const isTooLateForBank = (o) => !!o && ['stripe', 'sepa'].includes(o.fiatRail || o.rail) && ['ACCEPTING', 'ACCEPTED', 'PAYMENT_CREATED'].includes(o.status) && bankSecLeft(o) !== null && bankSecLeft(o) < MIN_BANK_PAY_SEC;
const P2P_STATUS_TEXT = {
  AWAITING_SELLER_LOCK: 'Not published yet. Tap Verify lock to check the chain, or Discard if the lock never went through',
  OPEN: 'Live', TOPUP: 'Waiting for your EURe', ACCEPTED: 'Your trade is open. No seller approval is needed - the USDC is already locked. Next step: pay on the payment page below.', PAYMENT_CREATED: 'Your trade is open. Next step: pay on the payment page below.', PAYMENT_INITIATED: 'Waiting for your payment',
  PAYMENT_DETECTED: 'Payment detected', FIAT_VERIFIED: 'Payment secured in escrow - the funds are being released to you automatically',
  FIAT_VERIFIED_PENDING_ONCHAIN: 'Payment received - securing it in escrow', RELEASE_REQUESTED: 'Releasing', RELEASED: 'Completed - the funds are in your wallet',
  DISPUTED: 'In dispute - Timax support is reviewing', CANCELLED: 'Cancelled', REFUNDED: 'Refunded',
  ACCEPTING: 'Confirming your part on-chain - this takes a few seconds', FILLED: 'Fully sold',
  REQUESTED: 'Waiting for the seller to approve your request - nothing is locked yet', APPROVED: 'Approved by the seller - lock the trade and pay',
  DECLINED: 'Declined by the seller - nothing was locked', WITHDRAWN: 'Cancelled by you - nothing was locked', EXPIRED: 'Request expired - nothing was locked',
};

// What the SELLER sees for the same order: what is going on and whether anything is needed from them
const P2P_SELLER_STATUS_TEXT = {
  ACCEPTING: 'A buyer is opening a trade - nothing to do',
  ACCEPTED: 'A buyer opened this trade and has not paid yet. Nothing to do - your USDC stays locked. If they do not pay before the order expires, cancel it to get the USDC back.',
  PAYMENT_CREATED: 'Buyer is paying - nothing to do', PAYMENT_INITIATED: 'Buyer is paying - nothing to do',
  PAYMENT_DETECTED: 'Payment received - being verified, nothing to do',
  FIAT_VERIFIED: 'Payment verified - the USDC is being released to the buyer', FIAT_VERIFIED_PENDING_ONCHAIN: 'Payment received - securing it in escrow',
  RELEASE_REQUESTED: 'Releasing', RELEASED: 'Completed - you were paid, the USDC went to the buyer',
  DISPUTED: 'In dispute - Timax support is reviewing', CANCELLED: 'Cancelled - your USDC is back in your wallet', REFUNDED: 'Refunded - your USDC is back in your wallet',
  REQUESTED: 'A buyer asks for this - approve or decline. Nothing is locked until you approve.', APPROVED: 'You approved - waiting for the buyer to lock and pay',
  DECLINED: 'You declined - nothing was locked', WITHDRAWN: 'The buyer cancelled the request - nothing was locked', EXPIRED: 'Request expired - nothing was locked',
};

// Seller-side wording that depends on the escrow version of the order (V5: a cancelled trade goes back INTO the offer)
const sellerTxt = (o, st) => {
  if (o && o.escrowV5 && st === 'ACCEPTED') return 'A buyer you approved opened this trade and has not paid yet. Nothing to do - your USDC stays locked until the trade time is up. If the buyer does not pay, the trade is cancelled automatically and the USDC goes back into your offer.';
  if (o && o.escrowV5 && st === 'CANCELLED') return 'Cancelled - the USDC went back into your offer (or to your wallet if the offer had ended)';
  return P2P_SELLER_STATUS_TEXT[st] || P2P_STATUS_TEXT[st] || st;
};

const cleanWeb3Error = err => {
  const msg = err?.message || err?.toString() || '';
  if (err?.userFacing) return msg;   // our own explanatory errors are shown in full
  if (msg.includes('insufficient funds') || msg.includes('exceeds the balance')) return 'Insufficient balance or gas.';
  if (msg.includes('User rejected') || msg.includes('user rejected') || msg.includes('denied') || msg.includes('cancelled')) return 'Transaction cancelled by user.';
  if (msg.length < 200) return msg;
  try { console.error('[P2P] transaction error:', err); } catch { /* ignore */ }
  // Show the short reason the wallet/RPC gave (revert reason, gas estimate, nonce...) instead of a blind generic text
  const short = String(err?.shortMessage || err?.reason || err?.data?.message || err?.cause?.shortMessage || err?.cause?.reason || '').replace(/\s+/g, ' ').trim();
  if (short) return `Transaction failed: ${short.slice(0, 160)}`;
  const m = msg.match(/(execution reverted[^\n]{0,140}|reverted with[^\n]{0,140}|gas required exceeds[^\n]{0,80}|nonce[^\n]{0,80}|replacement transaction[^\n]{0,80})/i);
  if (m) return `Transaction failed: ${m[1].trim()}`;
  return 'Transaction failed. Check your balance and try again.';
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function PolyExchangeApp({
  onSignMessage,
  onClose,
  onOpenMonerium,
  onOpenBridge,
  onOpenStripeMerchant,   // optional: the same handler App.jsx already passes to NexusHubModal (opens your Stripe Hub)
  artPreset,              // optional, from the Art Shares card: { mode:'buy'|'sell', chainId:'5042', symbol:'ART001', offerId?, token? }  opens this screen already set up for one art token
}) {
  const { showToast } = useToast();
  const link = artPreset ? (artPreset.offerId ? { id: String(artPreset.offerId), token: String(artPreset.token || '') } : null) : P2P_LINK;   // a seller's share link, or the one the Art card passes

  const [exchangeMode, setExchangeMode] = useState(() => {
    if (artPreset) return artPreset.mode === 'sell' ? 'merchant' : 'p2p_market';   // opened from the Art Shares card
    if (link) return 'p2p_market';   // opened from a seller's share link
    if (P2P_TAB) return P2P_TAB;         // opened from a ?p2p=merchant / ?p2p=market link or QR code
    const saved = localStorage.getItem('timax_exchange_mode');
    return (saved && saved !== 'bridge') ? saved : 'buy';
  });
  useEffect(() => { localStorage.setItem('timax_exchange_mode', exchangeMode); }, [exchangeMode]);

  const { chainId: activeEvmChainId, evmAddress, smartSwitchChain, triggerMobileWallet } = useWalletContext();
  const { primaryWallet } = useDynamicContext();
  const { waitForTx } = useWalletActions();
  const { universalSendTransaction, universalSignMessage, universalSignTypedData } = useUniversalSigner();

  const robustSendTx = useCallback(async (txParams, targetChainId) => {
    const chainIdToUse = targetChainId || activeEvmChainId || 1;
    return universalSendTransaction({ ...txParams, chainId: chainIdToUse });
  }, [universalSendTransaction, activeEvmChainId]);

  // Network switcher passed to FxExchangeModal's onSwitchNetwork prop —
  // same fallback chain (smartSwitchChain -> connector.switchNetwork ->
  // window.ethereum) this file used to run inline inside the deleted
  // handleSwitchToPolygon, just generalized to any target chain.
  const robustSwitchEVMChainForFx = useCallback(async (targetChainId) => {
    const targetIdNum = Number(targetChainId);
    const hexChainId = `0x${targetIdNum.toString(16)}`;
    if (triggerMobileWallet) triggerMobileWallet();

    if (typeof smartSwitchChain === 'function') {
      try { await smartSwitchChain(targetIdNum); return true; }
      catch (e) { if (e?.message?.toLowerCase().includes('user rejected')) throw e; }
    }

    if (primaryWallet?.connector?.switchNetwork) {
      try { await primaryWallet.connector.switchNetwork({ networkChainId: targetIdNum }); return true; }
      catch (e) { if (e?.message?.toLowerCase().includes('user rejected')) throw e; }
    }

    let provider = window.ethereum;
    try {
      if (typeof primaryWallet?.connector?.getProvider === 'function') {
        const p = await primaryWallet.connector.getProvider();
        if (p) provider = p;
      }
    } catch {}

    if (provider?.request) {
      try {
        await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hexChainId }] });
        return true;
      } catch (switchError) {
        if (switchError.code === 4902 || switchError?.message?.includes('Unrecognized chain') || switchError?.message?.includes('not added')) {
          if (targetIdNum === 137) {
            await provider.request({
              method: 'wallet_addEthereumChain',
              params: [{
                chainId: '0x89', chainName: 'Polygon',
                rpcUrls: ['https://polygon-rpc.com'],
                nativeCurrency: { name: 'POL', symbol: 'POL', decimals: 18 },
                blockExplorerUrls: ['https://polygonscan.com'],
              }],
            });
            return true;
          }
          if (targetIdNum === 5042) {   // Circle Arc: gas is paid in USDC (native, 18 dp). No explorer URL: none is verified.
            await provider.request({
              method: 'wallet_addEthereumChain',
              params: [{ chainId: '0x13b2', chainName: 'Arc', rpcUrls: ['https://rpc.mainnet.arc.io'], nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 } }],
            });
            return true;
          }
        }
        throw switchError;
      }
    }
    throw new Error('Could not switch network automatically. Please switch manually in your wallet.');
  }, [smartSwitchChain, primaryWallet, triggerMobileWallet]);

  // ── Mt Pelerin ────────────────────────────────────────────────────────────
  const iframeRef = useRef(null);
  const [validationCode, setValidationCode] = useState(null);
  const [validationHash, setValidationHash] = useState(null);
  const [isSigning,  setIsSigning]  = useState(false);
  const [signError,  setSignError]  = useState('');
  useEffect(() => { setValidationCode(null); setValidationHash(null); setSignError(''); }, [evmAddress]);

  // ── Merchant ──────────────────────────────────────────────────────────────
  const [isMerchantVerified, setIsMerchantVerified] = useState(false);   // decided by the backend (Stripe account + bank, or verified Monerium)
  const [traderStatus, setTraderStatus] = useState({ stripe: {}, monerium: {}, canSell: [] });
  const [merchantRail, setMerchantRail] = useState('');
  const form = useSellForm();   // the seller's offer form (price, limits, conditions, terms): the same on every chain
  const [showMerchantGuide,  setShowMerchantGuide]  = useState(false);
  const [lockedLiquidity,    setLockedLiquidity]    = useState(0);
  const [vaultLiquidity,     setVaultLiquidity]     = useState(0);
  const [escrowDepositAmount, setEscrowDepositAmount] = useState('');
  const [escrowDepositToken,  setEscrowDepositToken]  = useState(artPreset?.mode === 'sell' && artPreset?.symbol ? artPreset.symbol : 'USDC');
  const [vaultDepositAmount,  setVaultDepositAmount]  = useState('');
  const [sellCurrency,        setSellCurrency]        = useState('eur');     // the currency the seller wants to be paid in
  const [isEscrowExecuting,     setIsEscrowExecuting]    = useState(false);
  const [escrowStatusMessage, setEscrowStatusMessage] = useState('');

  // ── P2P ───────────────────────────────────────────────────────────────────
  const [p2pChain,         setP2pChain]         = useState(() => CHAINS.find(c => c.id === String(artPreset?.chainId || '137')) || CHAINS[0]);
  // Which P2P chains the backend has switched on (public, needs no sign-in). Until it answers (or on an older backend) only Polygon shows.
  const [p2pEnabledChains, setP2pEnabledChains] = useState(['137']);
  const [fxPreset, setFxPreset] = useState(null);   // trade handed to the FX Exchange by the Arbitrage tab ({ network, fromCurrency, toCurrency, amount, nonce })
  // one-click arbitrage run: App.js leaves the next swap here and opens this screen
  useEffect(() => {
    const apply = () => { const p = window.__timaxArbFxPreset; if (!p) return; window.__timaxArbFxPreset = null; setFxPreset({ ...p, nonce: Date.now() }); setExchangeMode('fx'); };
    apply();
    window.addEventListener('timax:arb-fx-preset', apply);
    return () => window.removeEventListener('timax:arb-fx-preset', apply);
  }, []);
  const [p2pAll, setP2pAll] = useState(false);   // true = the P2P Market tab lists the offers of every chain together
  const [p2pStellar, setP2pStellar] = useState(false);   // true = the P2P tabs show Stellar instead of Polygon / Arc
  const [p2pPartialChains, setP2pPartialChains] = useState([]);
  const [p2pChainRails, setP2pChainRails] = useState({});   // chainId -> rails the backend allows (public config: known before any sign-in)
  const [p2pOnchainPay, setP2pOnchainPay] = useState({});   // chainId -> symbol of the token a buyer pays on the on-chain rail (from the backend: a new chain needs no app change)
  const onchainPaySym = (id) => p2pOnchainPay[String(id)] || P2P_ONCHAIN_PAY[String(id)] || 'EURC';
  const [stripeBankCurrencies, setStripeBankCurrencies] = useState(null);   // currencies Stripe can take by BANK payment (cards are off); null until the backend answers
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`${P2P_API_BASE}/api/p2p/escrow/config`);
        const d = await readJson(r);
        if (alive && r.ok && d.success && Array.isArray(d.chains)) { setP2pEnabledChains(['137', ...d.chains.filter(c => c.contractAddress).map(c => String(c.chainId))]); setP2pPartialChains(d.chains.filter(c => c.partialFills).map(c => String(c.chainId))); setP2pChainRails(Object.fromEntries(d.chains.map(c => [String(c.chainId), c.rails || []]))); setP2pOnchainPay(Object.fromEntries(d.chains.map(c => { const t = (c.onchainFiatTokens || []).find(x => x.currency === 'eur') || (c.onchainFiatTokens || [])[0]; return t ? [String(c.chainId), t.symbol] : null; }).filter(Boolean))); if (Array.isArray(d.stripeBankCurrencies)) setStripeBankCurrencies(d.stripeBankCurrencies.map(c => String(c).toLowerCase())); }
      } catch { /* older backend: Polygon only */ }
    })();
    return () => { alive = false; };
  }, []);
  // Market rates for P2P prices (Stripe FX via the backend, the same numbers the backend enforces): offers must be within ±maxDev % of them.
  // No fallback here: a currency without a real rate is simply not offered.
  const [p2pRates, setP2pRates] = useState(null);   // { maxDev, currencies, rates:{ eur:{ usdPerUnit, minCharge, source } } }
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch(`${P2P_API_BASE}/api/p2p/escrow/rates`);
        const d = await readJson(r);
        if (alive) setP2pRates(r.ok && d.success && d.rates ? { maxDev:Number(d.maxDeviationPct) || 3, currencies:d.currencies || Object.keys(d.rates), rates:d.rates } : null);
      } catch { if (alive) setP2pRates(null); }
    };
    load();
    const t = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  const [artPrices, setArtPrices] = useState({});   // { ART001: { usd, eur }, ... }: appraisal per art share, from the backend
  const [, setArtTick] = useState(0);
  useEffect(() => { if (!artLotsLoaded) loadArtLots().then((a) => { if (a) setArtTick((t) => t + 1); }); }, []);
  useEffect(() => {
    if (exchangeMode !== 'p2p_market' && exchangeMode !== 'merchant') return undefined;
    let alive = true;
    const load = async () => {
      try {
        if (!artLotsLoaded) await loadArtLots();
        const next = {};
        for (const [sym, addr] of Object.entries(ART_ADDR)) {
          try {
            const r = await fetch(`${P2P_API_BASE}/api/p2p/escrow/art-check?chainId=5042&token=${addr}`);
            const d = await readJson(r);
            if (r.ok && d.success && d.configured && Number(d.price_usd) > 0 && !d.stale_usd) next[sym] = { usd:Number(d.price_usd), eur:Number(d.price_eur) || 0 };
          } catch { /* this lot has no price now */ }
        }
        if (alive) { setArtPrices(next); setArtTick((t) => t + 1); }
      } catch { if (alive) setArtPrices({}); }
    };
    load();
    const t = setInterval(load, 120_000);
    return () => { alive = false; clearInterval(t); };
  }, [exchangeMode]);
  const maxDev = p2pRates?.maxDev || 3;
  const rateOf = (cur) => Number(p2pRates?.rates?.[String(cur || '').toLowerCase()]?.usdPerUnit) || 0;           // USD per 1 unit of the currency
  const artPerShare = (cur, sym) => { const c = String(cur || '').toLowerCase(); const artPrice = artPrices[sym]; if (!artPrice) return 0; if (artPrice[c] > 0) return artPrice[c]; const r = rateOf(c); return artPrice.usd > 0 && r > 0 ? artPrice.usd / r : 0; };   // price of 1 share in `cur`
  const marketFor = (usd, cur, sym) => {   // USDC/USDT are 1 USD; an art share is worth its appraisal
    if (sym && ART_SYMS.includes(sym)) { const p = artPerShare(cur, sym); return p > 0 && Number(usd) > 0 ? Number(usd) * p : 0; }
    const r = rateOf(cur); return r > 0 && Number(usd) > 0 ? Number(usd) / r : 0;
  };
  const inBand = (fiat, market) => market > 0 && fiat > 0 && Math.abs(fiat - market) <= market * maxDev / 100 + 0.005;   // + half a cent: prices are in cents
  const vsMarket = (o) => {   // "+0.40% vs market" for an offer
    const m = marketFor(o.amount, o.fiatCurrency, sellSymOf(o, p2pChain.id)); const f = Number(o.fiatAmount);
    if (!(m > 0) || !(f > 0)) return '';
    const d = (f / m - 1) * 100;
    return `${d >= 0 ? '+' : ''}${d.toFixed(2)}% vs market`;
  };
  // Escrow V4 (partial fills) is switched on per chain by the backend once the V4 contract is configured.
  const [p2pActionType,     setP2pActionType]    = useState('buy');
  const [p2pOffers,         setP2pOffers]        = useState([]);
  const [marketCur,          setMarketCur]        = useState('ALL');   // market currency filter: every currency is listed, not just EUR

  const [isLoadingOffers,   setIsLoadingOffers]  = useState(true);
  const [offersError,       setOffersError]      = useState(null);
  const [offersReload,      setOffersReload]     = useState(0);
  const [ordersReload,      setOrdersReload]     = useState(0);
  const [orderActionId,     setOrderActionId]    = useState('');
  const [selectedOffer,     setSelectedOffer]    = useState(null);
  const [buyerEmail, setBuyerEmail] = useState(() => { try { return localStorage.getItem('timax_p2p_email') || ''; } catch { return ''; } });
  const buyerEmailOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(buyerEmail).trim());
  const [p2pAmountInput,    setP2pAmountInput]   = useState('');
  const [p2pOrder,          setP2pOrder]         = useState(null);
  const [clientBankDetails, setClientBankDetails] = useState('');
  const [showP2PGuide,      setShowP2PGuide]     = useState(false);
  // P2P API: same bridge backend and the SAME sign-in session as the Stripe Hub. Signing goes through your
  // universalSignMessage (Dynamic / embedded wallets); the onSignMessage prop is only a fallback.
  const signForP2P = useCallback(async (message) => {
    try { return await universalSignMessage(message, evmAddress); }
    catch (e) { if (typeof onSignMessage === 'function') return onSignMessage(message, evmAddress); throw e; }   // same order as NexusHubModal: universal first, then App's handleUniversalSign(message, address)
  }, [universalSignMessage, evmAddress, onSignMessage]);
  const { p2pFetch, p2pHasSession, p2pLogin } = useP2PFetch({ evmAddress, signMessage: signForP2P });

  // ── History state ─────────────────────────────────────────────────────────
  const [showHistory, setShowHistory] = useState(false);
  const [txHistory, setTxHistory]     = useState([]);

  // FX Exchange is now the shared <FxExchangeModal>, mounted below — no
  // local state needed here. Deleted the parallel implementation that used
  // to live in this file (see git history) to avoid maintaining two copies
  // of the same currency-quote/execute/network-switch logic.

  useEffect(() => {
    if (showHistory) {
      try { setTxHistory(JSON.parse(localStorage.getItem('timax_tx_history') || '[]')); } catch {}
    }
  }, [showHistory]);


  // Which rails may this wallet TRADE on? Decided by the backend: Stripe from your wallet<->connected-account mapping (and a bank
  // account), Monerium through monerium-backend. Either one unlocks selling. Never prompts for a signature by itself.
  // The P2P session is shared with the Stripe Hub sign-in, so a merchant who only uses Monerium has none until they sign once.
  // Nothing signs by itself: the background checks (focus / timer / page open) never ask for a signature; `interactive: true`
  // (only the "Sign in to check" / "check status" buttons) signs in once to read the trader status.
  const refreshMerchantVerification = useCallback(async (opts) => {
    const interactive = opts && opts.interactive === true;
    if (!evmAddress) return false;
    if (!p2pHasSession() && !interactive) return false;
    try {
      const res = await p2pFetch(`/api/p2p/escrow/trader-status?chainId=${p2pChain.id}`);   // what may this wallet trade on the selected chain?
      const d = await readJson(res);
      if (!res.ok || !d.success) throw new Error(d.error || `HTTP ${res.status}`);
      setTraderStatus({ stripe: d.stripe || {}, monerium: d.monerium || {}, canSell: d.canSell || [] });
      const ok = (d.canSell || []).length > 0;
      setIsMerchantVerified(ok);
      return ok;
    } catch { setIsMerchantVerified(false); return false; }
  }, [evmAddress, p2pFetch, p2pHasSession, p2pChain.id]);

  useEffect(() => { refreshMerchantVerification(); }, [refreshMerchantVerification]);


  // Re-check on focus and every few seconds while the merchant / market tab is open, so it unlocks by itself after onboarding.
  useEffect(() => {
    if (exchangeMode !== 'merchant' && exchangeMode !== 'p2p_market') return undefined;
    const id = setInterval(refreshMerchantVerification, isMerchantVerified ? 60000 : 4000);
    window.addEventListener('focus', refreshMerchantVerification);
    return () => { clearInterval(id); window.removeEventListener('focus', refreshMerchantVerification); };
  }, [exchangeMode, refreshMerchantVerification, isMerchantVerified]);
  const onchainOpen = (p2pChainRails[String(p2pChain.id)] || []).includes('onchain');   // crypto-for-crypto needs no Stripe / Monerium account, so the tab opens without a sign-in
  const merchantOpen = isMerchantVerified || onchainOpen;
  const canSellRails = [...new Set([...traderStatus.canSell, ...(onchainOpen ? ['onchain'] : [])])].filter(r => !P2P_TOKEN_RAILS[escrowDepositToken] || P2P_TOKEN_RAILS[escrowDepositToken].includes(r)).sort((a, b) => P2P_RAIL_ORDER.indexOf(a) - P2P_RAIL_ORDER.indexOf(b));
  const activeRail = canSellRails.includes(merchantRail) ? merchantRail : (canSellRails[0] || '');

  // Idle (unlocked) USDC in the trader's wallet - what can still be locked in escrow or put into the vault.
  const [idleUsdc, setIdleUsdc] = useState(null);
  useEffect(() => {
    const tok = FX_TOKENS[p2pChain.id]?.find(t => t.symbol === escrowDepositToken);
    if (!evmAddress || !tok || exchangeMode !== 'merchant' || !merchantOpen) { setIdleUsdc(null); return undefined; }
    let alive = true;
    const load = async () => {
      try {
        const client = createPublicClient({ transport: http(P2P_READ_RPCS[p2pChain.id] || P2P_READ_RPC) });
        const raw = await client.readContract({ address: tok.address, abi: erc20Abi, functionName: 'balanceOf', args: [evmAddress] });
        if (alive) setIdleUsdc(Number(formatUnits(raw, tok.decimals)));
      } catch { if (alive) setIdleUsdc(null); }
    };
    load();
    const id = setInterval(load, 30000);
    return () => { alive = false; clearInterval(id); };
  }, [evmAddress, p2pChain.id, exchangeMode, merchantOpen, lockedLiquidity, escrowDepositToken]);

  // A buyer's open trade updates by itself (payment secured -> released) and is restored after a reload.
  const dismissedOrdersRef = useRef(new Set());
  const activeBuyId = p2pOrder?.type === 'buy' && p2pOrder?.stage !== 'topup' ? (p2pOrder.orderId || p2pOrder.id || '') : '';
  const activeBuyStatus = p2pOrder?.status || '';
  useEffect(() => {
    if (!activeBuyId || !evmAddress || ['RELEASED', 'REFUNDED', 'CANCELLED'].includes(activeBuyStatus)) return undefined;
    let alive = true;
    const poll = async () => {
      try {
        const r = await p2pFetch(`/api/p2p/escrow/${activeBuyId}`); const d = await readJson(r);
        if (alive && r.ok && d.success) setP2pOrder(o => (o ? ({...o, status:d.order?.status || o.status, chainState:d.chainState, stripePaymentProcessing:!!d.order?.stripePaymentProcessing}) : o));
      } catch { /* keep the last known state */ }
    };
    const id = setInterval(poll, 10000);
    return () => { alive = false; clearInterval(id); };
  }, [activeBuyId, activeBuyStatus, evmAddress, p2pFetch]);
  // The buyer's OPEN trade (reserved, not paid, not expired): shown as a banner and restored on reload. One open trade per buyer.
  const [openBuyOrder, setOpenBuyOrder] = useState(null);
  const [myBuyTrades, setMyBuyTrades] = useState([]);
  const orderFromRow = (o) => ({ ...o, type:'buy', orderId:o.orderId || o.id, cryptoAmount:(Number(o.amount) * (1 - PLATFORM_FEE_PERCENT)).toFixed(2), checkoutUrl:o.stripeCheckoutUrl, rail:o.fiatRail, stage:(['monerium', 'onchain'].includes(o.fiatRail) ? (o.status === 'ACCEPTED' ? 'needs_deposit' : 'escrowed') : undefined), fiatCurrency:String(o.fiatCurrency || 'EUR').toUpperCase() });
  useEffect(() => {
    if (!evmAddress || p2pOrder || exchangeMode !== 'p2p_market' || !p2pHasSession()) return undefined;
    let alive = true;
    (async () => {
      try {
        const r = await p2pFetch('/api/p2p/escrow/mine'); const d = await readJson(r);
        const live = (d.orders || []).filter(x => x.role === 'buyer' && x.kind !== 'offer' && ['ACCEPTING', 'ACCEPTED', 'PAYMENT_CREATED', 'PAYMENT_INITIATED', 'PAYMENT_DETECTED', 'FIAT_VERIFIED', 'FIAT_VERIFIED_PENDING_ONCHAIN', 'RELEASE_REQUESTED', 'REQUESTED', 'APPROVED'].includes(x.status) && !x.requestExpired);
        if (alive) setMyBuyTrades(live.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))));
        const rows = (d.orders || []).filter(x => x.role === 'buyer' && x.kind !== 'offer' && ['ACCEPTING', 'ACCEPTED', 'PAYMENT_CREATED', 'PAYMENT_INITIATED', 'PAYMENT_DETECTED', 'FIAT_VERIFIED', 'FIAT_VERIFIED_PENDING_ONCHAIN', 'RELEASE_REQUESTED', 'DISPUTED'].includes(x.status) && !x.expired && !isTooLateForBank(x) && !(x.status === 'ACCEPTING' && Date.now() - Date.parse(x.createdAt || 0) > 20 * 60000));
        rows.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
        const o = rows[0] || null;
        if (!alive) return;
        setOpenBuyOrder(o);
        if (o && !dismissedOrdersRef.current.has(o.orderId || o.id)) setP2pOrder(orderFromRow(o));
      } catch { /* not critical */ }
    })();
    return () => { alive = false; };
  }, [evmAddress, exchangeMode, p2pOrder, p2pFetch, p2pHasSession, offersReload]);

  // While a request waits for the seller, look again every 15 s so the "Lock & pay" button appears as soon as it is approved.
  const hasWaitingRequest = myBuyTrades.some(t => t.status === 'REQUESTED');
  useEffect(() => {
    if (!hasWaitingRequest || exchangeMode !== 'p2p_market') return undefined;
    const id = setInterval(() => setOffersReload(n => n + 1), 15000);
    return () => clearInterval(id);
  }, [hasWaitingRequest, exchangeMode]);

  // SEPA: poll the order while the buyer's bank transfer is on its way, so the screen turns to "Completed" by itself.
  const sepaOrderId = p2pOrder?.rail === 'sepa' ? (p2pOrder.orderId || p2pOrder.id) : null;
  const sepaStatus = p2pOrder?.rail === 'sepa' ? p2pOrder.status : null;
  useEffect(() => {
    if (!sepaOrderId || ['RELEASED', 'REFUNDED', 'CANCELLED', 'DISPUTED'].includes(sepaStatus)) return undefined;
    let alive = true;
    const tick = async () => {
      try {
        const r = await p2pFetch(`/api/p2p/escrow/${sepaOrderId}`); const d = await readJson(r);
        if (alive && r.ok && d.success && d.order?.status) setP2pOrder(o => (o && (o.orderId || o.id) === sepaOrderId ? { ...o, status:d.order.status, needsAttention:!!d.order.needsAttention } : o));
      } catch { /* next tick */ }
    };
    const id = setInterval(tick, 10000);
    return () => { alive = false; clearInterval(id); };
  }, [sepaOrderId, sepaStatus, p2pFetch]);

  // Gas check before the buyer starts: the offer's chain native balance of the buyer's wallet (null = unknown, never blocks).
  const [buyerGas, setBuyerGas] = useState(null);
  const gasChainId = selectedOffer ? String(selectedOffer.chainId || p2pChain.id) : null;
  useEffect(() => {
    if (!evmAddress || !gasChainId || !P2P_GAS[gasChainId]) { setBuyerGas(null); return undefined; }
    let alive = true;
    const load = async () => {
      try {
        const bal = await createPublicClient({ transport: http(P2P_READ_RPCS[gasChainId] || P2P_READ_RPC) }).getBalance({ address: evmAddress });
        if (alive) setBuyerGas(Number(formatUnits(bal, 18)));
      } catch { if (alive) setBuyerGas(null); }
    };
    load();
    const id = setInterval(load, 15000);
    return () => { alive = false; clearInterval(id); };
  }, [evmAddress, gasChainId]);

  // Opened from a seller's share link: load that offer (private ones included) and go straight to its detail page.
  const linkDone = useRef(false);
  useEffect(() => {
    if (!link || linkDone.current || exchangeMode !== 'p2p_market' || !evmAddress) return;
    linkDone.current = true;
    (async () => {
      try {
        const res = await p2pFetch(`/api/p2p/escrow/offer-by-link?${new URLSearchParams({ offerId:link.id, token:link.token }).toString()}`, { auth:'optional' });
        const d = await readJson(res);
        if (!res.ok || !d.success) throw new Error(d.error || 'This offer link is not available any more.');
        const o = d.offer;
        const tok = (FX_TOKENS[String(o.chainId)] || []).find(t => t.address.toLowerCase() === String(o.tokenAddress || '').toLowerCase());
        const cryptoAmount = Number(o.amount || 0), fiatAmount = Number(o.fiatAmount || 0);
        const rate = cryptoAmount > 0 && fiatAmount > 0 ? fiatAmount / cryptoAmount : 0;
        setSelectedOffer({ ...o, tokenSymbol: tok?.symbol || 'USDC', linkToken:link.token, id:o.id || o.orderId, merchantAddress:o.sellerAddress, merchantName:`${String(o.sellerAddress || '').slice(0,6)}…${String(o.sellerAddress || '').slice(-4)}`, verified:true, term:o.fiatRail === 'sepa' ? 'SEPA bank transfer' : o.fiatRail === 'monerium' ? 'Monerium' : o.fiatRail === 'onchain' ? `On-chain ${o.fiatTokenSymbol || 'EURC'}` : 'Stripe', iban:o.sellerMoneriumIban, fiatCurrency:String(o.fiatCurrency || 'EUR').toUpperCase(), partial:!!o.partial, availableUSDC:(o.partial ? Number(o.remaining || 0) : cryptoAmount), minFiat:(o.partial ? Math.ceil(Number(o.minFill || 0) * rate * 100) / 100 : fiatAmount), maxFiat:(o.partial ? Math.floor(Math.min(Number(o.remaining || 0), Number(o.maxFill || o.remaining || 0)) * rate * 100) / 100 : fiatAmount), buyRate:rate ? (1/rate).toFixed(6) : '0', sellRate:rate ? (1/rate).toFixed(6) : '0', rate });
      } catch (e) { showToast?.(e.message || 'Could not open this offer link.', 'error'); }
    })();
  }, [exchangeMode, evmAddress, p2pFetch]);

  // Funds visible on the P2P market, and the part this wallet has locked itself.
  const marketCurrencies = [...new Set(p2pOffers.map(o => String(o.fiatCurrency || 'EUR').toUpperCase()))].sort();
  const marketCurFilter = marketCur === 'ALL' || marketCurrencies.includes(marketCur) ? marketCur : 'ALL';
  const shownOffers = marketCurFilter === 'ALL' ? p2pOffers : p2pOffers.filter(o => String(o.fiatCurrency || 'EUR').toUpperCase() === marketCurFilter);
  const totalAvailable = p2pOffers.filter(o => !ART_SYMS.includes(o.tokenSymbol)).reduce((sum, o) => sum + Number(o.amount || 0), 0);   // dollar totals count stablecoins only
  const artTotals = (list) => { const m = {}; list.filter(o => ART_SYMS.includes(o.tokenSymbol)).forEach(o => { m[o.tokenSymbol] = (m[o.tokenSymbol] || 0) + Number(o.amount || 0); }); return Object.entries(m).filter(([, v]) => v > 0).map(([k, v]) => `${v.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${k}`).join(' · '); };
  const artAvailable = artTotals(p2pOffers);
  const myArtLocked = artTotals(p2pOffers.filter(o => String(o.sellerAddress || '').toLowerCase() === String(evmAddress || '').toLowerCase()));
  const myLockedFromOffers = p2pOffers
    .filter(o => String(o.sellerAddress || '').toLowerCase() === String(evmAddress || '').toLowerCase() && !ART_SYMS.includes(o.tokenSymbol))
    .reduce((sum, o) => sum + Number(o.amount || 0), 0);


  useEffect(() => {
    if (exchangeMode !== 'p2p_market' && exchangeMode !== 'merchant') return undefined;   // FX / Buy / Sell / IBAN tabs never touch the P2P backend
    let mounted = true;
    const fetchOffers = async () => {
      if (!evmAddress) { setP2pOffers([]); setIsLoadingOffers(false); return; }
      setIsLoadingOffers(true); setOffersError(null);
      try {
        const syms = artPreset?.symbol ? [artPreset.symbol] : (P2P_SELL_TOKENS[p2pChain.id] || ['USDC']);   // from the Art card: only that token's offers
        const rows = [];
        for (const sym of syms) {
          const token = FX_TOKENS[p2pChain.id]?.find(t => t.symbol === sym);
          if (!token) continue;
          const qs = new URLSearchParams({ tokenAddress:token.address, chainId:p2pChain.id });
          const res = await p2pFetch(`/api/p2p/escrow/offers?${qs.toString()}`, { auth:'optional' });   // public list: browsing never asks for a signature
          const data = await readJson(res);
          if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);
          (data.offers || []).forEach(o => rows.push({ ...o, tokenSymbol:sym }));
        }
        if (!mounted) return;
        const offers = rows.map(o => {
          const cryptoAmount = Number(o.amount || 0);
          const fiatAmount = Number(o.fiatAmount || 0);
          const rate = cryptoAmount > 0 && fiatAmount > 0 ? fiatAmount / cryptoAmount : 0;
          return { ...o, id:o.id || o.orderId, merchantAddress:o.sellerAddress, merchantName:o.merchantName || `${String(o.sellerAddress || '').slice(0,6)}…${String(o.sellerAddress || '').slice(-4)}`, verified:true, term:o.fiatRail === 'sepa' ? 'SEPA bank transfer' : o.fiatRail === 'monerium' ? 'Monerium' : o.fiatRail === 'onchain' ? `On-chain ${o.fiatTokenSymbol || 'EURC'}` : 'Stripe', iban:o.sellerMoneriumIban, fiatCurrency:String(o.fiatCurrency || 'EUR').toUpperCase(), partial:!!o.partial, availableUSDC:(o.partial ? Number(o.remaining || 0) : cryptoAmount), minFiat:(o.partial ? Math.ceil(Number(o.minFill || 0) * rate * 100) / 100 : Number(o.minFiat || fiatAmount)), maxFiat:(o.partial ? Math.floor(Math.min(Number(o.remaining || 0), Number(o.maxFill || o.remaining || 0)) * rate * 100) / 100 : Number(o.maxFiat || fiatAmount)), buyRate:rate ? (1/rate).toFixed(6) : '0', sellRate:rate ? (1/rate).toFixed(6) : '0', rate, moneriumReference:o.moneriumReference };
        });
        setP2pOffers(offers);
      } catch (e) {
        if (mounted) { setOffersError(e.message || 'Could not load live offers. Please retry.'); setP2pOffers([]); }
      } finally { if (mounted) setIsLoadingOffers(false); }
    };
    fetchOffers();
    const id = setInterval(fetchOffers, 20_000);
    return () => { mounted = false; clearInterval(id); };
  }, [evmAddress, p2pChain.id, p2pChain.name, p2pFetch, offersReload, exchangeMode]);

  // ─── Merchant handlers ─────────────────────────────────────────────────────

  // Publishes a funded offer: the backend re-reads the order on-chain and opens it. Right after the lock tx a node can still answer with the old
  // state, so retry a few times before giving up. The order itself stays safe on-chain either way (and can be re-verified from the orderbook).
  const confirmSellerLock = async (orderId, txHash) => {
    let lastErr = 'Escrow funding could not be verified.';
    for (let i = 0; i < 6; i++) {
      try {
        const r = await p2pFetch('/api/p2p/escrow/seller-locked', { method:'POST', body:JSON.stringify({ orderId, txHash }) });
        const d = await readJson(r);
        if (r.ok && d.success) return d;
        lastErr = d.error || lastErr;
        if (/mismatch|only the seller|not found|not awaiting/i.test(lastErr) && !/already/i.test(lastErr)) break;   // permanent: do not hammer
      } catch (e) { lastErr = e.message || lastErr; }
      await new Promise(res => setTimeout(res, 2000 + i * 1500));
    }
    const fe = new Error(lastErr + ' - funds are safe in escrow; tap Verify lock in the orderbook to retry, or Cancel & withdraw.'); fe.userFacing = true; throw fe;
  };

  // Currencies this seller can be paid in on the chosen rail (Stripe: only the currencies buyers can pay by bank, narrowed to the seller's bank accounts when Stripe says which; Monerium and EURC are EUR only).
  const sellCurrencies = (() => {
    const priced = (p2pRates?.currencies || []).filter(c => rateOf(c) > 0);
    if (activeRail === 'sepa' || activeRail === 'monerium' || activeRail === 'onchain') return priced.filter(c => c === 'eur');
    const payable = stripeBankCurrencies ? priced.filter(c => stripeBankCurrencies.includes(c)) : priced;   // bank payments only: no bank method, no offer
    const banks = (traderStatus.stripe?.banks || []).flatMap(b => b.currencies || []).map(c => String(c).toLowerCase());
    return banks.length ? payable.filter(c => banks.includes(c)) : payable;
  })();
  const sellCur = sellCurrencies.includes(sellCurrency) ? sellCurrency : (sellCurrencies[0] || 'eur');
  const partialOn = p2pPartialChains.includes(String(p2pChain.id)) && activeRail !== 'onchain';   // on-chain EURC swaps stay whole-order until V4 is live on Arc
  // What the seller is asking for, versus the market rate of the chosen currency (USDC/USDT count as 1 USD).
  const sellQuote = computeSellQuote({
    amount: escrowDepositAmount, market: marketFor(Number(escrowDepositAmount), sellCur, escrowDepositToken), priceMode: form.v.priceMode, premium: form.v.premium, fixedFiat: form.v.fixedFiat, fiatDp: 2,
    floorFiat: (activeRail === 'stripe' ? Number(p2pRates?.rates?.[sellCur]?.minCharge) : 0) || 0, partial: partialOn,
    minFill: form.v.minFill, maxFill: form.v.maxFill, maxDev, bandSlack: 0.005 });

  const handleProvideLiquidity = async () => {
    if (!evmAddress || !escrowDepositAmount || Number(escrowDepositAmount) <= 0) return;
    setIsEscrowExecuting(true);
    try {
      const tokenConf = FX_TOKENS[p2pChain.id]?.find(t => t.symbol === escrowDepositToken);
      if (!tokenConf) throw new Error(`${escrowDepositToken} not found on ${p2pChain.name}`);
      if (!(P2P_SELL_TOKENS[p2pChain.id] || ['USDC']).includes(escrowDepositToken)) throw new Error(`${escrowDepositToken} offers are not enabled on ${p2pChain.name}.`);
      if (!activeRail) throw new Error(P2P_TOKEN_RAILS[escrowDepositToken] ? `${escrowDepositToken} offers are paid in EURe through Monerium. Connect and verify a Monerium account first.` : 'Connect Stripe (with a bank account) or a verified Monerium account first.');
      const counterSym = onchainPaySym(p2pChain.id);
      const counterToken = FX_TOKENS[p2pChain.id]?.find(t => t.symbol === counterSym);
      if (activeRail === 'onchain' && !counterToken) throw new Error(`${counterSym} is not configured on ${p2pChain.name}`);
      const fiatCurrency = sellCur.toUpperCase();
      if (!(rateOf(sellCur) > 0)) throw new Error(`The market rate for ${sellCur.toUpperCase()} is unavailable right now. Try again in a minute.`);
      const fiatAmount = sellQuote.fiat;   // market rate ± spread, or the fixed price the seller typed (2 decimals)
      if (!Number.isFinite(fiatAmount) || fiatAmount <= 0) throw new Error('Enter your price.');
      if (!sellQuote.ok) throw new Error(`Your price must be within ±${maxDev}% of the market rate (${sellQuote.market.toFixed(2)} ${sellCur.toUpperCase()} for ${escrowDepositAmount} ${escrowDepositToken}).`);
      if (!sellQuote.minOk) throw new Error(`Per buyer: the minimum must be at least ${sellQuote.minNeeded.toFixed(2)} (a bank payment needs a minimum size), and the maximum must be between the minimum and ${escrowDepositAmount} ${escrowDepositToken}.`);

      setEscrowStatusMessage('Preparing Timax P2P escrow order…');
      const initRes = await p2pFetch('/api/p2p/escrow/init', {
        method:'POST', body:JSON.stringify({
          chainId:Number(p2pChain.id), tokenAddress:tokenConf.address, tokenDecimals:tokenConf.decimals, amount:String(escrowDepositAmount),
          fiatCurrency, fiatAmount, fiatRail:activeRail, paymentRail:activeRail, ...sellFormPayload(form.v),
          ...(partialOn ? { partial:true, minFill:String(Number(sellQuote.minFillNum.toFixed(6))), maxFill:String(Number(sellQuote.maxFillNum.toFixed(6))), tokenSymbol:escrowDepositToken } : {}),
          ...((activeRail === 'monerium' || activeRail === 'sepa') ? { sellerMoneriumProfileId: traderStatus.monerium?.profileId || 'n/a' } : {}),
          ...(activeRail === 'onchain' ? { fiatTokenAddress: counterToken.address } : {}),   // Arc: the buyer pays in EURC, held in the same escrow contract
          expirySeconds: partialOn ? 86400 : 7200
        })
      });
      const init = await readJson(initRes);
      if (!initRes.ok || !init.success) throw new Error(init.error || 'Could not initialize P2P escrow.');

      setEscrowStatusMessage(`Approving ${escrowDepositAmount} ${escrowDepositToken}…`);
      const appHash = await robustSendTx({ from:evmAddress, to:init.approvalTransaction.to, data:init.approvalTransaction.data }, Number(init.approvalTransaction.chainId));
      await waitForTx(appHash);
      setEscrowStatusMessage(`Locking ${escrowDepositToken} in Timax P2P escrow…`);
      const txHash = await robustSendTx({ from:evmAddress, to:init.transaction.to, data:init.transaction.data }, Number(init.transaction.chainId));
      await waitForTx(txHash);
      await confirmSellerLock(init.orderId, txHash);
      if (!ART_SYMS.includes(escrowDepositToken)) setLockedLiquidity(p => p + Number(escrowDepositAmount));
      setOffersReload(n => n + 1); setOrdersReload(n => n + 1);
      setEscrowDepositAmount('');
      showToast?.(partialOn ? `${escrowDepositToken} locked - buyers can take any part from ${sellQuote.minFillNum.toFixed(2)}.` : `${escrowDepositToken} locked in Timax P2P escrow and offer is live.`, 'success');
    } catch (e) { showToast?.(cleanWeb3Error(e), 'error'); }
    finally { setIsEscrowExecuting(false); setEscrowStatusMessage(''); }
  };

  const handleVaultDeposit = async () => {
    if (!evmAddress || !vaultDepositAmount || Number(vaultDepositAmount) <= 0) return;
    setIsEscrowExecuting(true);
    try {
      const usdcToken = FX_TOKENS[p2pChain.id]?.find(t => t.symbol === 'USDC');
      if (!usdcToken) throw new Error('USDC not on this chain');
      const amtWei = toWeiStr(vaultDepositAmount, usdcToken.decimals || 6);
      setEscrowStatusMessage('Approving USDC for Vault…');
      const appData = encodeFunctionData({ abi:erc20Abi, functionName:'approve', args:[UNISWAP_V3_EURE_USDC_VAULT, BigInt(amtWei)] });
      const appHash = await robustSendTx({ from:evmAddress, to:usdcToken.address, data:appData }, Number(p2pChain.id));
      await waitForTx(appHash);
      setEscrowStatusMessage('Depositing into Vault LP…');
      const depData = encodeFunctionData({ abi:VAULT_ABI, functionName:'deposit', args:[BigInt(amtWei), BigInt(0)] });
      const txHash  = await robustSendTx({ from:evmAddress, to:UNISWAP_V3_EURE_USDC_VAULT, data:depData }, Number(p2pChain.id));
      await waitForTx(txHash);
      setVaultLiquidity(p => p + Number(vaultDepositAmount)); setVaultDepositAmount('');
      showToast?.(`${vaultDepositAmount} USDC zapped into Vault LP`, 'success');
    } catch (e) { showToast?.(cleanWeb3Error(e), 'error'); }
    finally { setIsEscrowExecuting(false); setEscrowStatusMessage(''); }
  };

  const handleClientSellLock = async netOut => {
    if (!evmAddress || !clientBankDetails || clientBankDetails.length < 10) return;
    setIsEscrowExecuting(true);
    try {
      const usdcToken = FX_TOKENS[p2pChain.id]?.find(t => t.symbol === 'USDC');
      if (!usdcToken) throw new Error(`USDC is not configured on ${p2pChain.name}`);
      const moneriumProfileId = localStorage.getItem('timax_monerium_profile_id') || '';
      if (!moneriumProfileId) throw new Error('Connect your Monerium trader account first.');
      const fiatCurrency = selectedOffer.fiatCurrency;
      const fiatAmount = Number(netOut);
      const initRes = await p2pFetch('/api/p2p/escrow/init', { method:'POST', body:JSON.stringify({
        tokenAddress:usdcToken.address, tokenDecimals:usdcToken.decimals, amount:String(p2pAmountInput), fiatCurrency, fiatAmount, fiatRail:'monerium', paymentRail:'monerium', buyerAddress:selectedOffer.merchantAddress, buyerMoneriumProfileId:selectedOffer.sellerMoneriumProfileId || selectedOffer.moneriumProfileId || '', expirySeconds:1800
      }) });
      const init = await readJson(initRes);
      if (!initRes.ok || !init.success) throw new Error(init.error || 'Could not initialize P2P sell escrow.');
      setEscrowStatusMessage('Approving USDC…');
      const appData = encodeFunctionData({ abi:erc20Abi, functionName:'approve', args:[init.approvalTransaction.to, BigInt(toWeiStr(p2pAmountInput, usdcToken.decimals))] });
      const appHash = await robustSendTx({ from:evmAddress, to:usdcToken.address, data:appData }, Number(init.approvalTransaction.chainId));
      await waitForTx(appHash);
      setEscrowStatusMessage('Locking USDC in Timax P2P escrow…');
      const txHash = await robustSendTx({ from:evmAddress, to:init.transaction.to, data:init.transaction.data }, Number(init.transaction.chainId));
      await waitForTx(txHash);
      await confirmSellerLock(init.orderId, txHash);
      setP2pOrder({ ...selectedOffer, ...init.order, type:'sell', inputAmount:p2pAmountInput, outputAmount:netOut.toFixed(2), clientBankDetails, referenceId:init.orderId, iban:selectedOffer.sellerMoneriumIban || selectedOffer.iban, status:'OPEN' });
      showToast?.('USDC locked in Timax P2P escrow. Awaiting buyer payment.', 'success');
    } catch (e) { showToast?.(cleanWeb3Error(e), 'error'); }
    finally { setIsEscrowExecuting(false); setEscrowStatusMessage(''); }
  };

  const handleClientReleaseToMerchant = async () => {
    if (!p2pOrder) return;
    setIsEscrowExecuting(true);
    try {
      const prep = await p2pFetch('/api/p2p/escrow/confirm-seller', { method:'POST', body:JSON.stringify({orderId:p2pOrder.orderId || p2pOrder.id || p2pOrder.referenceId}) });
      const data = await readJson(prep);
      if (!prep.ok || !data.success) throw new Error(data.error || 'Could not prepare seller confirmation.');
      const txHash = await robustSendTx({ from:evmAddress, to:data.transaction.to, data:data.transaction.data }, Number(data.transaction.chainId));
      await waitForTx(txHash);
      const confirm = await p2pFetch('/api/p2p/escrow/seller-confirmed', { method:'POST', body:JSON.stringify({orderId:p2pOrder.orderId || p2pOrder.id || p2pOrder.referenceId,txHash}) });
      const result = await readJson(confirm);
      if (!confirm.ok || !result.success) throw new Error(result.error || 'Seller confirmation failed.');
      setP2pOrder(null); setSelectedOffer(null); setP2pAmountInput(''); setClientBankDetails('');
      showToast?.('Fiat confirmed. Timax relayer submitted the escrow release.', 'success');
    } catch (e) { showToast?.(cleanWeb3Error(e), 'error'); }
    finally { setIsEscrowExecuting(false); setEscrowStatusMessage(''); }
  };

  // Seller/participant actions from the order book. Wallet signs; the backend verifies on-chain state.
  const handleOrderAction = async (kind, orderId) => {
    if (!orderId || orderActionId) return;
    setOrderActionId(orderId);
    try {
      if (kind === 'verify') {
        await confirmSellerLock(orderId, '');
        showToast?.('Lock verified - your offer is live.', 'success');
        setOrdersReload(n => n + 1); setOffersReload(n => n + 1);
        return;
      }
      const path = kind === 'confirm' ? '/api/p2p/escrow/confirm-seller' : kind === 'cancel' ? '/api/p2p/escrow/cancel' : '/api/p2p/escrow/open-dispute';
      const prepRes = await p2pFetch(path, { method:'POST', body:JSON.stringify({ orderId }) });
      const prep = await readJson(prepRes);
      if (!prepRes.ok || !prep.success) throw new Error(prep.error || 'Could not prepare the transaction.');
      if (prep.discarded) { showToast?.('Removed. This offer was never locked on-chain, so no funds moved.', 'success'); setOrdersReload(n => n + 1); setOffersReload(n => n + 1); return; }
      const txHash = await robustSendTx({ from:evmAddress, to:prep.transaction.to, data:prep.transaction.data }, Number(prep.transaction.chainId));
      await waitForTx(txHash);
      if (kind === 'confirm') {
        const r = await readJson(await p2pFetch('/api/p2p/escrow/seller-confirmed', { method:'POST', body:JSON.stringify({ orderId, txHash }) }));
        if (!r.success) throw new Error(r.error || 'Seller confirmation failed.');
        showToast?.('Receipt confirmed. Timax is releasing the funds to the buyer.', 'success');
      } else if (kind === 'dispute') {
        const r = await readJson(await p2pFetch('/api/p2p/escrow/dispute-opened', { method:'POST', body:JSON.stringify({ orderId, txHash }) }));
        if (!r.success) throw new Error(r.error || 'Dispute could not be verified.');
        showToast?.('Dispute opened. Timax support will review it.', 'success');
      } else {
        p2pFetch(`/api/p2p/escrow/${orderId}/cancel-tx`, { method:'POST', body:JSON.stringify({ txHash }) }).catch(() => {});
        showToast?.(prep.returnsToOffer ? 'Trade cancelled. The USDC is back in the seller\'s offer.' : 'Order cancelled. Your funds return to your wallet.', 'success');
      }
      setOrdersReload(n => n + 1); setOffersReload(n => n + 1);
    } catch (e) { showToast?.(cleanWeb3Error(e), 'error'); }
    finally { setOrderActionId(''); }
  };

  // One wallet transaction prepared by the backend (e.g. the seller's "give more time"): send, wait until mined, return the hash.
  const sendEscrowTx = async (tx) => { const h = await robustSendTx({ from:evmAddress, to:tx.to, data:tx.data }, Number(tx.chainId)); await waitForTx(h); return h; };

  const handleSignToVerify = async () => {
    if (!evmAddress) return;
    setIsSigning(true); setSignError('');
    try {
      const code = generateValidationCode();
      const msg  = `MtPelerin-${code}`;
      const sig  = typeof onSignMessage === 'function'
        ? await onSignMessage(msg)
        : await window.ethereum?.request({ method:'personal_sign', params:[msg, evmAddress] });
      if (!sig) throw new Error('No signature returned');
      setValidationCode(code);
      setValidationHash(formatSignatureForMtPelerin(sig));
    } catch (e) { setSignError(e.message || 'Signature rejected.'); }
    finally { setIsSigning(false); }
  };

  // Monerium rail, buyer side: the euros are EURe in the buyer's OWN wallet (their personal Monerium IBAN mints it there). The buyer
  // deposits it into the escrow contract, which then swaps both legs automatically. The deposit is the proof of payment, and the
  // platform never holds this money. Nothing is reserved until the buyer really holds the EURe.
  const payFiatLeg = async (orderId, legSym = 'EURe') => {
    setEscrowStatusMessage(`Preparing your ${legSym} payment…`);
    const flRes = await p2pFetch('/api/p2p/escrow/fiat-leg', { method:'POST', body:JSON.stringify({orderId}) });
    const fl = await readJson(flRes);
    if (!flRes.ok || !fl.success) throw new Error(fl.error || `Could not prepare the ${legSym} payment.`);
    if (fl.approvalTransaction) {
      setEscrowStatusMessage(`Approve ${legSym} for the escrow contract in your wallet…`);
      const ah = await robustSendTx({ from:evmAddress, to:fl.approvalTransaction.to, data:fl.approvalTransaction.data }, Number(fl.approvalTransaction.chainId));
      await waitForTx(ah);
    }
    setEscrowStatusMessage(`Depositing your ${legSym} into escrow…`);
    const dh = await robustSendTx({ from:evmAddress, to:fl.transaction.to, data:fl.transaction.data }, Number(fl.transaction.chainId));
    await waitForTx(dh);
    setEscrowStatusMessage('Confirming…');
    const depRes = await p2pFetch('/api/p2p/escrow/fiat-deposited', { method:'POST', body:JSON.stringify({orderId, txHash:dh}) });
    const dep = await readJson(depRes);
    if (!depRes.ok || !dep.success) throw new Error(dep.error || `The ${legSym} deposit could not be confirmed yet.`);
    return dep.status || 'FIAT_VERIFIED';
  };

  // ─── Buyer orders ("I want X for Y fiat"): buyers post them, sellers fill them ─────────────────────────────────────
  const [bids,        setBids]        = useState([]);   // open buy orders from other wallets
  const [myBids,      setMyBids]      = useState([]);   // this wallet's own buy orders
  const [fillable,    setFillable]    = useState([]);   // buy orders a seller has already funded: the buyer pays next
  const [bidForm,     setBidForm]     = useState({ token:'USDC', amount:'', fiat:'', rail:'monerium' });
  const [showBidForm, setShowBidForm] = useState(false);
  const [bidBusy,     setBidBusy]     = useState('');
  useEffect(() => {
    if (!evmAddress || exchangeMode !== 'p2p_market' || !p2pHasSession()) { setBids([]); setMyBids([]); setFillable([]); return undefined; }
    let alive = true;
    (async () => {
      try {
        const get = async (path) => { const r = await p2pFetch(path); const d = await readJson(r); return r.ok && d.success ? d : {}; };
        const [open, mine, orders] = await Promise.all([
          get(`/api/p2p/escrow/bids?chainId=${p2pChain.id}`), get(`/api/p2p/escrow/bids?chainId=${p2pChain.id}&mine=1`), get('/api/p2p/escrow/mine')
        ]);
        if (!alive) return;
        setBids(open.bids || []); setMyBids(mine.bids || []);
        setFillable((orders.orders || []).filter(o => o.role === 'buyer' && o.status === 'OPEN' && o.bidId && !o.expired && String(o.chainId) === String(p2pChain.id)));
      } catch { /* optional: the market stays usable without buy orders */ }
    })();
    return () => { alive = false; };
  }, [evmAddress, exchangeMode, p2pChain.id, p2pFetch, p2pHasSession, offersReload, ordersReload]);

  const handlePlaceBid = async () => {
    if (!evmAddress || bidBusy) return;
    setBidBusy('place');
    try {
      const tok = FX_TOKENS[p2pChain.id]?.find(t => t.symbol === bidForm.token);
      if (!tok) throw new Error(`${bidForm.token} is not available on ${p2pChain.name}`);
      const amount = Number(bidForm.amount);
      if (!(rateOf('eur') > 0)) throw new Error('The market rate is unavailable right now. Try again in a minute.');
      const market = Math.round(marketFor(amount, 'eur') * 100) / 100;
      const fiat = Number(bidForm.fiat) > 0 ? Math.round(Number(bidForm.fiat) * 100) / 100 : market;
      if (!(amount > 0) || !(fiat > 0)) throw new Error('Enter how much you want to buy.');
      if (!inBand(fiat, marketFor(amount, 'eur'))) throw new Error(`Your price must be within ±${maxDev}% of the market rate (${market.toFixed(2)} EUR for ${amount} ${bidForm.token}).`);
      let profileId = '';
      if (bidForm.rail === 'monerium') {
        const ts = await readJson(await p2pFetch('/api/p2p/escrow/trader-status'));
        if (ts?.monerium?.enforced && !ts.monerium.verified) throw new Error('Connect and verify your Monerium account first.');
        profileId = ts?.monerium?.profileId || '';
        if (!profileId) throw new Error('Connect your Monerium account first - your euros arrive there as EURe.');
      }
      const r = await p2pFetch('/api/p2p/escrow/bid', { method:'POST', body:JSON.stringify({
        chainId:Number(p2pChain.id), tokenAddress:tok.address, tokenDecimals:tok.decimals, amount:String(bidForm.amount), fiatCurrency:'EUR', fiatAmount:fiat,
        fiatRail:bidForm.rail, ...(profileId ? { buyerMoneriumProfileId:profileId } : {}) }) });
      const d = await readJson(r);
      if (!r.ok || !d.success) throw new Error(d.error || 'Could not place the buy order.');
      setBidForm(f => ({ ...f, amount:'', fiat:'' })); setShowBidForm(false);
      setOffersReload(n => n + 1);
      showToast?.('Buy order placed. A seller can now fill it - nothing is charged until one does.', 'success');
    } catch (e) { showToast?.(cleanWeb3Error(e), 'error'); }
    finally { setBidBusy(''); }
  };

  const handleCancelBid = async (bidId) => {
    if (bidBusy) return;
    setBidBusy(bidId);
    try {
      const d = await readJson(await p2pFetch('/api/p2p/escrow/bid/cancel', { method:'POST', body:JSON.stringify({ bidId }) }));
      if (!d.success) throw new Error(d.error || 'Could not cancel.');
      setOffersReload(n => n + 1); showToast?.('Buy order cancelled.', 'success');
    } catch (e) { showToast?.(cleanWeb3Error(e), 'error'); }
    finally { setBidBusy(''); }
  };

  // A seller fills a buyer's order: lock the crypto into a direct escrow order for that buyer. Needs a rail the seller is paid through.
  const handleFillBid = async (bid) => {
    if (!evmAddress || isEscrowExecuting) return;
    setIsEscrowExecuting(true);
    try {
      const tokenConf = (FX_TOKENS[p2pChain.id] || []).find(t => String(t.address).toLowerCase() === String(bid.tokenAddress).toLowerCase());
      if (!tokenConf) throw new Error('This token is not available in this app.');
      const ts = await readJson(await p2pFetch(`/api/p2p/escrow/trader-status?chainId=${p2pChain.id}`));
      if (!(ts?.canSell || []).includes(bid.fiatRail)) throw new Error(bid.fiatRail === 'stripe' ? 'To be paid by this buyer, connect Stripe with a bank account first.' : 'To be paid by this buyer, connect and verify Monerium first.');
      setEscrowStatusMessage('Preparing the escrow order…');
      const initRes = await p2pFetch('/api/p2p/escrow/init', { method:'POST', body:JSON.stringify({
        chainId:Number(p2pChain.id), tokenAddress:tokenConf.address, tokenDecimals:tokenConf.decimals, amount:String(bid.amount), fiatCurrency:String(bid.fiatCurrency).toUpperCase(), fiatAmount:Number(bid.fiatAmount),
        fiatRail:bid.fiatRail, paymentRail:bid.fiatRail, autoRelease:true, bidId:bid.id, expirySeconds:7200,
        ...((bid.fiatRail === 'monerium' || bid.fiatRail === 'sepa') ? { sellerMoneriumProfileId: ts?.monerium?.profileId || 'n/a' } : {}) }) });
      const init = await readJson(initRes);
      if (!initRes.ok || !init.success) throw new Error(init.error || 'Could not prepare the order.');
      setEscrowStatusMessage(`Approving ${bid.amount} ${tokenConf.symbol}…`);
      await waitForTx(await robustSendTx({ from:evmAddress, to:init.approvalTransaction.to, data:init.approvalTransaction.data }, Number(init.approvalTransaction.chainId)));
      setEscrowStatusMessage(`Locking ${tokenConf.symbol} in Timax P2P escrow…`);
      const txHash = await robustSendTx({ from:evmAddress, to:init.transaction.to, data:init.transaction.data }, Number(init.transaction.chainId));
      await waitForTx(txHash);
      await confirmSellerLock(init.orderId, txHash);
      setOffersReload(n => n + 1); setOrdersReload(n => n + 1);
      showToast?.('Order filled - the buyer has been notified and pays next. You are paid as soon as both sides are in escrow.', 'success');
    } catch (e) { showToast?.(cleanWeb3Error(e), 'error'); }
    finally { setIsEscrowExecuting(false); setEscrowStatusMessage(''); }
  };

  const handlePayFilled = async (o) => {
    if (isEscrowExecuting) return;
    setIsEscrowExecuting(true);
    try {
      const id = o.orderId || o.id;
      await buyOffer({ ...o, id, orderId:id, merchantAddress:o.sellerAddress, fiatCurrency:String(o.fiatCurrency || 'EUR').toUpperCase() }, String(o.fiatAmount), (Number(o.amount) * (1 - PLATFORM_FEE_PERCENT)).toFixed(2));
      setOffersReload(n => n + 1);
    } catch (e) { showToast?.(cleanWeb3Error(e), 'error'); }
    finally { setIsEscrowExecuting(false); setEscrowStatusMessage(''); }
  };

  const shortAddr = (a) => `${String(a || '').slice(0, 6)}…${String(a || '').slice(-4)}`;
  const railWord = (r) => r === 'stripe' ? 'Stripe (bank payment)' : r === 'sepa' ? 'SEPA (any bank)' : r === 'monerium' ? 'Monerium (EURe)' : r;

  const renderBuyOrderPanel = () => {
    const amountNum = Number(bidForm.amount);
    const market = amountNum > 0 && rateOf('eur') > 0 ? marketFor(amountNum, 'eur').toFixed(2) : '';
    const bidFiat = Number(bidForm.fiat) > 0 ? Number(bidForm.fiat) : Number(market);
    const bidOk = !!market && inBand(bidFiat, marketFor(amountNum, 'eur'));
    const myOpen = myBids.filter(b => b.status === 'BID_OPEN');
    return (
      <div className="bg-[#1c1d22] border border-slate-800 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div><p className="text-xs font-bold text-white">Buy order</p><p className="text-[10px] text-slate-500">Say what you want to buy and pay fiat. A seller fills it.</p></div>
          <button onClick={()=>setShowBidForm(v=>!v)} className="text-[10px] font-bold text-white px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500">{showBidForm ? 'Close' : 'Place order'}</button>
        </div>
        {showBidForm && (
          <div className="space-y-2">
            <div className="flex gap-2">
              <select value={bidForm.token} onChange={e=>setBidForm(f=>({...f,token:e.target.value}))} className="bg-[#0a0f1a] border border-slate-700 rounded-lg py-2 px-2 text-xs text-white outline-none">
                {(P2P_SELL_TOKENS[p2pChain.id] || ['USDC']).map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <input type="number" value={bidForm.amount} onChange={e=>setBidForm(f=>({...f,amount:e.target.value}))} placeholder={`Amount of ${bidForm.token} to buy`} className="flex-1 bg-[#0a0f1a] border border-slate-700 rounded-lg py-2 px-3 text-sm text-white outline-none focus:border-blue-500"/>
            </div>
            <div className="relative"><input type="number" value={bidForm.fiat} onChange={e=>setBidForm(f=>({...f,fiat:e.target.value}))} placeholder={market ? `EUR you pay (market ≈ ${market})` : 'EUR you pay'} className="w-full bg-[#0a0f1a] border border-slate-700 rounded-lg py-2 px-3 pr-12 text-sm text-white outline-none focus:border-blue-500"/><span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-slate-500">EUR</span></div>
            <p className={`text-[10px] ${rateOf('eur') > 0 ? (market && !bidOk ? 'text-red-400' : 'text-slate-500') : 'text-amber-400'}`}>{rateOf('eur') > 0 ? `Market: 1 EUR = ${rateOf('eur').toFixed(4)} USD${market ? ` · ${bidFiat > 0 ? ((bidFiat / Number(market) - 1) * 100).toFixed(2) : '0.00'}% vs market · allowed ±${maxDev}%` : ''}` : 'Market rate unavailable right now.'}</p>
            <div className="flex gap-2">{['sepa', 'monerium', 'stripe'].map(r => <button key={r} onClick={()=>setBidForm(f=>({...f,rail:r}))} className={`flex-1 py-1.5 rounded-lg text-[10px] font-bold border ${bidForm.rail===r?'bg-blue-600 border-blue-500 text-white':'bg-[#0a0f1a] border-slate-700 text-slate-300'}`}>{railWord(r)}</button>)}</div>
            <p className="text-[10px] text-slate-500">{bidForm.rail === 'stripe' ? 'You pay on a Stripe page when a seller has locked the crypto. Nothing is charged before that.' : bidForm.rail === 'sepa' ? 'You pay from any bank account by SEPA transfer to the seller\'s IBAN, with a reference we show you. No account needed. Nothing is reserved before a seller fills the order.' : 'You pay from your Monerium account: SEPA to your own Monerium IBAN becomes EURe in your wallet, then it is held in escrow. Nothing is reserved before a seller fills the order.'}</p>
            <button disabled={!!bidBusy || !(amountNum > 0) || !bidOk} onClick={handlePlaceBid} className="w-full py-3 rounded-xl font-bold bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm flex items-center justify-center gap-2">{bidBusy==='place' ? <Loader2 size={14} className="animate-spin"/> : null} Place buy order</button>
          </div>
        )}
        {fillable.map(o => (
          <div key={o.orderId || o.id} className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 space-y-2">
            <p className="text-xs font-bold text-emerald-300">A seller filled your order</p>
            <p className="text-[11px] text-slate-300">{o.amount} {sellSymOf(o, p2pChain.id)} for {o.fiatAmount} {String(o.fiatCurrency).toUpperCase()} via {railWord(o.fiatRail)}. The crypto is locked in escrow - pay to receive it.</p>
            <button disabled={isEscrowExecuting} onClick={()=>handlePayFilled(o)} className="w-full py-2 rounded-lg text-[11px] font-bold bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white">{isEscrowExecuting ? (escrowStatusMessage || '…') : 'Pay now'}</button>
          </div>
        ))}
        {myOpen.map(b => (
          <div key={b.id} className="flex items-center justify-between rounded-lg border border-slate-800 bg-[#0a0f1a] p-3">
            <div className="min-w-0"><p className="text-xs font-bold text-white truncate">{b.amount} {sellSymOf(b, p2pChain.id)} for {b.fiatAmount} {String(b.fiatCurrency).toUpperCase()}</p><p className="text-[10px] text-slate-500">{railWord(b.fiatRail)} · waiting for a seller{b.reserved ? ' (a seller is locking now)' : ''}</p></div>
            <button disabled={!!bidBusy} onClick={()=>handleCancelBid(b.id)} className="shrink-0 ml-2 text-[10px] font-bold px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white">{bidBusy===b.id?'…':'Cancel'}</button>
          </div>
        ))}
      </div>
    );
  };

  const renderSellToBuyersPanel = () => {
    const others = bids.filter(b => String(b.buyerAddress).toLowerCase() !== String(evmAddress || '').toLowerCase());
    return (
      <div className="space-y-3">
        <div className="bg-[#1c1d22] border border-slate-800 rounded-xl px-4 py-3"><p className="text-xs font-bold text-white">Buy orders from buyers</p><p className="text-[10px] text-slate-500">Fill one: you lock the crypto in escrow and are paid in fiat ({`Stripe payout or Monerium`}) when the buyer's payment is secured.</p></div>
        {isEscrowExecuting && <div className="flex justify-center"><span className="text-xs text-blue-400 flex items-center gap-2"><Loader2 size={14} className="animate-spin"/> {escrowStatusMessage}</span></div>}
        {others.length === 0 && <div className="flex flex-col items-center justify-center py-10 text-center"><Store className="w-9 h-9 text-slate-600 mb-2"/><p className="text-sm font-bold text-white">No buy orders yet</p><p className="text-xs text-slate-400">Buyers' orders appear here.</p></div>}
        {others.map(b => (
          <div key={b.id} className="bg-[#1c1d22] border border-slate-800 rounded-xl p-4">
            <div className="flex justify-between items-start mb-3">
              <div><p className="text-sm font-bold text-white">{b.amount} {sellSymOf(b, p2pChain.id)}</p><p className="text-[10px] text-slate-500">Buyer {shortAddr(b.buyerAddress)}</p></div>
              <div className="text-right"><p className="text-sm font-bold text-emerald-400">{b.fiatAmount} {String(b.fiatCurrency).toUpperCase()}</p><p className="text-[10px] text-slate-500">{railWord(b.fiatRail)}</p></div>
            </div>
            <button disabled={isEscrowExecuting || b.reserved} onClick={()=>handleFillBid(b)} className="w-full py-2 rounded-lg text-[11px] font-bold bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white flex items-center justify-center gap-1"><Lock size={12}/> {b.reserved ? 'A seller is locking this order' : `Lock ${sellSymOf(b, p2pChain.id)} & fill order`}</button>
          </div>
        ))}
      </div>
    );
  };

  const buyStep = useRef('');
  const BUY_STEP_TEXT = { send:'Sending the transaction on the network', wait:'Waiting for the network to confirm the transaction', verify:'Confirming your order with Timax', stripe:'Creating the Stripe payment page', sepa:'Preparing the bank transfer details', reserve:'Reserving your part of the offer' };
  // Wrapper: tells the buyer WHICH step failed and the real reason, instead of a blind "check your balance"
  const buyOffer = async (...args) => {
    buyStep.current = '';
    try { return await buyOfferInner(...args); }
    catch (e) {
      const step = buyStep.current;
      const raw = String(e?.shortMessage || e?.reason || e?.message || '');
      if (!step || e?.userFacing || /user rejected|denied|cancel/i.test(raw)) throw e;
      try { console.error('[P2P] step failed:', step, e); } catch { /* ignore */ }
      const ne = new Error(`${BUY_STEP_TEXT[step] || step} failed: ${raw.replace(/\s+/g, ' ').slice(0, 220)}`); ne.userFacing = true; throw ne;
    }
  };
  const buyOfferInner = async (offer, fiatInput, cryptoNet, approvedRow = null) => {
    const rail = offer.fiatRail;
    const offerId = offer.orderId || offer.id;
    const partial = !!offer.partial;
    // Partial offer: the buyer takes a part. Crypto = what they pay / the offer's price, 6 decimals; fiat is re-priced pro rata.
    const takeCrypto = approvedRow ? Number(approvedRow.amount) : (partial ? (Math.round(Number(fiatInput) / Number(offer.rate) * 1e6) / 1e6) : 0);
    const fiatDue = partial ? Math.round(takeCrypto * Number(offer.rate) * 100) / 100 : Number(offer.fiatAmount);
    if (partial && !(takeCrypto > 0)) throw new Error('Enter how much you want to pay.');
    {   // network-fee check: opening the trade is the buyer's only on-chain transaction
      const gk = String(offer.chainId || p2pChain.id); const gm = P2P_GAS[gk]; let gb = null;
      if (gm && evmAddress) { try { gb = Number(formatUnits(await createPublicClient({ transport: http(P2P_READ_RPCS[gk] || P2P_READ_RPC) }).getBalance({ address: evmAddress }), 18)); } catch { gb = null; } }
      if (gm && gb !== null && gb < gm.min) throw new Error(`You need a little ${gm.sym} on ${gm.chain} in your wallet to pay the network fee for opening this trade (about ${gm.min} ${gm.sym}; you have ${gb.toFixed(4)}). Add some ${gm.sym}, then try again. You have not paid anything yet.`);
    }
    if (rail === 'monerium') {
      const tsRes = await p2pFetch('/api/p2p/escrow/trader-status'); const ts = await readJson(tsRes);
      if (ts?.monerium?.enforced && !ts.monerium.verified) throw new Error('Connect and verify your Monerium account first.');
      const mine = ts?.monerium?.ibans || [];
      const iban = (mine.find(i => !i.chain || i.chain === 'polygon') || mine[0] || {}).iban || '';
      const eure = FX_TOKENS['137']?.find(t => t.symbol === 'EURe');
      if (!eure) throw new Error('EURe is not available on this network.');
      const need = BigInt(Math.round(fiatDue * 100)) * BigInt('10000000000000000');   // cents -> 18 decimals
      let have = BigInt(0);
      try { have = await createPublicClient({ transport: http(P2P_READ_RPC) }).readContract({ address:eure.address, abi:erc20Abi, functionName:'balanceOf', args:[evmAddress] }); } catch { have = BigInt(0); }
      if (have < need) {
        setP2pOrder({ ...offer, type:'buy', rail:'monerium', stage:'topup', status:'TOPUP', orderId:offerId, fiatAmount:fiatInput, cryptoAmount:cryptoNet, iban, eureBalance:Number(formatUnits(have, 18)) });
        return;
      }
    }
    if (rail === 'sepa' && !approvedRow && typeof window !== 'undefined' && !window.confirm('This trade is paid by SEPA bank transfer and must arrive within the trade time.\n\nOnly continue if your bank app offers SEPA INSTANT (money arrives in seconds). A normal transfer can take a day and will be too late.\n\nDoes your bank support SEPA Instant?')) {
      throw new Error('Cancelled. Pick the Stripe bank payment, or use a bank that supports SEPA Instant.');
    }
    // On-chain rail (Arc): the buyer pays in a second ERC-20 (EURC) from their own wallet. Nothing is reserved until they hold it.
    let legToken = null;
    if (rail === 'onchain') {
      const offerChain = String(offer.chainId || p2pChain.id);
      legToken = (FX_TOKENS[offerChain] || []).find(t => t.address.toLowerCase() === String(offer.fiatToken || '').toLowerCase());
      if (!legToken) throw new Error('The payment token of this offer is not available in this app.');
      const needUnits = BigInt(toWeiStr(fiatDue.toFixed(2), legToken.decimals));
      let haveUnits = null;
      try { haveUnits = await createPublicClient({ transport: http(P2P_READ_RPCS[offerChain] || P2P_READ_RPC) }).readContract({ address:legToken.address, abi:erc20Abi, functionName:'balanceOf', args:[evmAddress] }); } catch { haveUnits = null; }   // RPC hiccup: the backend re-checks on-chain before the payment step
      if (haveUnits !== null && haveUnits < needUnits) throw new Error(`You need ${fiatDue.toFixed(2)} ${legToken.symbol} on ${p2pChain.name} in your wallet to take this offer (you hold ${Number(formatUnits(haveUnits, legToken.decimals)).toFixed(2)}).`);
    }
    buyStep.current = 'reserve';
    if (!approvedRow) {   // step 1: ask the seller. Nothing is locked or paid yet; the buyer can cancel the request freely.
      const rq = await p2pFetch('/api/p2p/escrow/offer/request', { method:'POST', body:JSON.stringify({ offerId, ...(partial ? { amount:String(takeCrypto) } : {}), ...(offer.linkToken ? { shareToken:offer.linkToken } : {}), ...(rail === 'stripe' ? { email:String(buyerEmail).trim() } : {}) }) });
      const rd = await readJson(rq);
      if (!rq.ok || !rd.success) throw new Error(rd.error || 'Could not send your request.');
      buyStep.current = '';
      setSelectedOffer(null);
      showToast?.('Request sent. The seller must approve it before anything is locked. You get an alert when they answer.', 'success');
      setOffersReload(n => n + 1);
      return;
    }
    const reqId = approvedRow.orderId || approvedRow.id;
    const acceptRes = partial
      ? await p2pFetch('/api/p2p/escrow/offer/fill', { method:'POST', body:JSON.stringify({ offerId, requestId:reqId, amount:String(takeCrypto), ...(offer.linkToken ? { shareToken:offer.linkToken } : {}) }) })
      : await p2pFetch('/api/p2p/escrow/accept', { method:'POST', body:JSON.stringify({orderId:offerId, requestId:reqId, ...(offer.linkToken ? { shareToken:offer.linkToken } : {})}) });
    const accept = await readJson(acceptRes);
    if (!acceptRes.ok || !accept.success) throw new Error(accept.error || (partial ? 'Could not reserve your part of this offer.' : 'Could not accept P2P offer.'));
    setEscrowStatusMessage('Accepting P2P offer on-chain…');
    buyStep.current = 'send';
    const txHash = await robustSendTx({ from:evmAddress, to:accept.transaction.to, data:accept.transaction.data }, Number(accept.transaction.chainId));
    buyStep.current = 'wait';
    await waitForTx(txHash);
    buyStep.current = 'verify';
    const acceptedRes = await p2pFetch('/api/p2p/escrow/buyer-accepted', { method:'POST', body:JSON.stringify({orderId:accept.orderId,txHash}) });
    const accepted = await readJson(acceptedRes);
    if (!acceptedRes.ok || !accepted.success) throw new Error(accepted.error || 'Buyer acceptance could not be verified.');
    if (offer.autoReply) showToast?.(`Seller says: ${offer.autoReply}`, 'info');
    const base = { ...offer, type:'buy', fiatAmount:(partial ? fiatDue : fiatInput), cryptoAmount:cryptoNet, orderId:accept.orderId };
    if (rail === 'stripe') {
      setEscrowStatusMessage('Preparing your Stripe payment page…');
      buyStep.current = 'stripe';
      const coRes = await p2pFetch('/api/p2p/escrow/checkout', { method:'POST', body:JSON.stringify({orderId:accept.orderId}) });
      const co = await readJson(coRes);
      if (!coRes.ok || !co.success) {
        setP2pOrder({ ...base, rail:'stripe', status:'ACCEPTED' });   // the trade IS open: keep the buyer on it, with the retry button, instead of a dead end
        throw new Error(co.error || 'Could not create the Stripe payment page.');
      }
      try { window.open(co.checkoutUrl, '_blank', 'noopener'); } catch { /* popup blocked: the button stays on the next screen */ }
      setP2pOrder({ ...base, rail:'stripe', checkoutUrl:co.checkoutUrl, status:'PAYMENT_INITIATED', paymentInitiatedTxHash:co.txHash });
      return;
    }
    if (rail === 'sepa') {
      setEscrowStatusMessage('Preparing your bank transfer details…');
      buyStep.current = 'sepa';
      const sRes = await p2pFetch('/api/p2p/escrow/sepa-start', { method:'POST', body:JSON.stringify({orderId:accept.orderId}) });
      const sp = await readJson(sRes);
      if (!sRes.ok || !sp.success) {
        setP2pOrder({ ...base, rail:'sepa', status:'ACCEPTED' });
        throw new Error(sp.error || 'Could not prepare the bank transfer details.');
      }
      setP2pOrder({ ...base, rail:'sepa', status:'PAYMENT_INITIATED', paymentInitiatedTxHash:sp.txHash, sellerMoneriumIban:sp.iban, moneriumReference:sp.reference, fiatAmount:sp.amount, fiatCurrency:'EUR' });
      return;
    }
    buyStep.current = '';
    // reserved: if the deposit is interrupted (rejected in the wallet, network) the screen offers to continue
    const legSym = rail === 'onchain' ? legToken.symbol : 'EURe';
    setP2pOrder({ ...base, rail:(rail === 'onchain' ? 'onchain' : 'monerium'), fiatTokenSymbol:(rail === 'onchain' ? legToken.symbol : base.fiatTokenSymbol), stage:'needs_deposit', status:'ACCEPTED' });
    const status = await payFiatLeg(accept.orderId, legSym);
    setP2pOrder(o => (o ? ({ ...o, stage:'escrowed', status }) : o));
  };

  // Step 2, after the seller approved: lock the trade on-chain and go to the payment.
  const lockApproved = async (row) => {
    const baseId = row.offerId || row.requestForOrder;
    const known = (p2pOffers || []).find(o => String(o.orderId || o.id) === String(baseId));
    const offer = known || { ...orderFromRow(row), id:baseId, orderId:baseId, partial:!!row.offerId, rate:Number(row.fiatAmount) / Number(row.amount), merchantAddress:row.sellerAddress, fiatCurrency:String(row.fiatCurrency || 'EUR').toUpperCase() };
    setIsEscrowExecuting(true);
    try { await buyOffer(offer, String(row.fiatAmount), (Number(row.amount) * (1 - PLATFORM_FEE_PERCENT)).toFixed(2), row); }
    catch (e) { showToast?.(cleanWeb3Error(e), 'error'); }
    finally { setIsEscrowExecuting(false); setEscrowStatusMessage(''); setOffersReload(n => n + 1); }
  };
  const cancelRequest = async (row) => {
    try {
      const r = await p2pFetch('/api/p2p/escrow/request/cancel', { method:'POST', body:JSON.stringify({ orderId:row.orderId || row.id }) }); const d = await readJson(r);
      if (!r.ok || !d.success) throw new Error(d.error || 'Could not cancel the request.');
      showToast?.('Request cancelled. Nothing was locked.', 'success'); setOffersReload(n => n + 1);
    } catch (e) { showToast?.(e.message || 'Could not cancel the request.', 'error'); }
  };

  const handleStripeOnboarding = async () => {
    if (!evmAddress) { showToast?.('Connect wallet first', 'error'); return; }
    if (typeof onOpenStripeMerchant === 'function') { onOpenStripeMerchant(); return; }   // App.jsx closes Global Exchange, opens the Stripe Hub and returns here afterwards
    showToast?.('Open the Business Treasury Hub, connect Stripe and add a bank account, then return here.', 'info');
  };

  const handleMoneriumOnboarding = async () => {
    if (!evmAddress) { showToast?.('Connect wallet first', 'error'); return; }
    // Check status FIRST. Already-verified traders go straight to funding; only unverified traders are sent
    // to Monerium to open/verify an account. Verification is never marked locally.
    const already = await refreshMerchantVerification();
    if (already) { showToast?.('Monerium trader verified. Trader funding is unlocked.', 'success'); setExchangeMode('merchant'); return; }
    onOpenMonerium?.();
  };

  // ─── Render History Modal ──────────────────────────────────────────────────
  const renderHistory = () => (
    <div className="absolute inset-0 z-[60] bg-[#131418] flex flex-col animate-in slide-in-from-bottom-4">
      <div className="flex-none flex items-center justify-between px-4 py-3 bg-[#1a1b1f] border-b border-slate-800">
        <h3 className="font-bold text-white flex items-center gap-2"><History className="w-5 h-5 text-blue-500"/> Transaction History</h3>
        <button onClick={() => setShowHistory(false)} className="p-2 hover:bg-slate-800 rounded-full text-slate-400 hover:text-white"><X className="w-5 h-5"/></button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
        {txHistory.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-slate-500">
            <History size={48} className="mb-4 opacity-50"/>
            <p>No transactions yet</p>
          </div>
        ) : (
          txHistory.map((tx, i) => (
            <div key={i} className="bg-[#1c1d22] border border-slate-800 rounded-xl p-3 text-sm">
              <div className="flex justify-between items-start mb-2">
                <div>
                  <p className="text-white font-bold">{tx.type} via {tx.provider}</p>
                  <p className="text-[10px] text-slate-400">{new Date(tx.timestamp).toLocaleString()}</p>
                </div>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${tx.status==='PENDING' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'}`}>
                  {tx.status}
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-300 mb-3 bg-[#0a0f1a] p-2 rounded-lg border border-slate-800/50">
                <span className="truncate flex-1">{tx.from}</span>
                <ArrowRight size={12} className="text-slate-500 shrink-0"/>
                <span className="truncate flex-1 text-right">{tx.to}</span>
              </div>
              {tx.hash && (
                <div className="flex justify-between items-center text-[10px]">
                  <span className="text-slate-500 font-mono">TX: {tx.hash.slice(0,10)}...{tx.hash.slice(-8)}</span>
                  <div className="flex items-center gap-2">
                    <button onClick={() => { navigator.clipboard.writeText(tx.hash); showToast?.('Tx Hash copied!', 'info'); }} className="flex items-center gap-1 text-blue-400 hover:text-blue-300 bg-blue-500/10 px-2 py-1 rounded">
                      <Copy size={10}/> Copy Hash
                    </button>
                    {tx.explorer && (
                      <a href={tx.explorer} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-slate-400 hover:text-white bg-slate-800 px-2 py-1 rounded">
                        <ExternalLink size={10}/> Explorer
                      </a>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );

  // ─── Render ────────────────────────────────────────────────────────────────

  const renderMtPelerinIframe = () => {
    if (!evmAddress) return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
        <Wallet className="w-12 h-12 mb-4 text-slate-600" />
        <h3 className="text-lg font-bold text-white mb-2">Wallet Required</h3>
        <p className="text-sm text-slate-400">Connect your EVM wallet to access the Fiat Gateway.</p>
      </div>
    );
    if (!validationHash) return (
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
        <ShieldCheck size={48} className="text-blue-500 mb-4" />
        <h3 className="text-lg font-bold text-white mb-2">Verify Your Wallet</h3>
        <p className="text-[13px] text-slate-400 mb-6 max-w-sm leading-relaxed">Mt Pelerin requires a gas-free signature to confirm ownership of this address.</p>
        <button onClick={handleSignToVerify} disabled={isSigning} className="w-full max-w-[280px] py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold flex items-center justify-center gap-2 disabled:opacity-50">
          {isSigning ? <Loader2 size={18} className="animate-spin" /> : 'Sign to Continue'}
        </button>
        {signError && <div className="mt-4 flex items-center gap-1.5 text-[11px] text-red-400 bg-red-500/10 px-3 py-2 rounded-lg border border-red-500/20"><AlertCircle size={12} /> {signError}</div>}
      </div>
    );
    const widgetUrl = buildWidgetUrl({ tab:exchangeMode==='buy'?'buy':'sell', enabledTabs:[exchangeMode], walletAddress:evmAddress, validationCode, validationHash, fiatCurrency:'USD', cryptoCurrency:'USDC', network:'polygon', enabledNetworks:Object.keys(NETWORKS) });
    return <div className="flex-1 relative"><iframe ref={iframeRef} src={widgetUrl} title="Mt Pelerin Fiat Gateway" className="w-full h-full border-0 absolute inset-0 z-10" allow="ethereum; web3; clipboard-write; payment; microphone; camera; publickey-credentials-get *" /></div>;
  };

  const renderMoneriumIban = () => (
    <div className="flex-1 overflow-y-auto p-6 flex flex-col items-center justify-center text-center space-y-6">
      <div className="w-20 h-20 bg-blue-500/10 border border-blue-500/30 rounded-full flex items-center justify-center"><Landmark className="w-10 h-10 text-blue-400" /></div>
      <div>
        <h3 className="text-xl font-bold text-white mb-2">Personal Web3 IBAN</h3>
        <p className="text-sm text-slate-400 max-w-xs mx-auto">Link a European IBAN to your Polygon wallet. SEPA transfers auto-mint as EURe; burn EURe to send EUR to any bank.</p>
      </div>
      <div className="bg-[#1c1d22] border border-slate-800 p-4 rounded-xl w-full text-left space-y-3">
        {[{icon:ShieldCheck,color:'text-emerald-500',t:'Zero Fees',s:'Free SEPA transfers in and out.'},{icon:Wallet,color:'text-purple-500',t:'Self-Custodial',s:'Funds go directly to your wallet.'}].map(({icon:Icon,color,t,s})=>(
          <div key={t} className="flex items-center gap-3"><Icon className={`w-5 h-5 ${color}`}/><div><p className="text-sm font-bold text-slate-200">{t}</p><p className="text-[10px] text-slate-500">{s}</p></div></div>
        ))}
      </div>
      <button onClick={()=>{onClose?.();onOpenMonerium?.()}} className="w-full py-4 rounded-xl font-bold bg-blue-600 hover:bg-blue-500 text-white flex items-center justify-center gap-2">Open Monerium Banking <ArrowRight size={18}/></button>
    </div>
  );

  // USDC on every enabled EVM P2P chain (Stellar is added by the all-chains screen itself)
  const allChainSources = CHAINS.filter(c => P2P_CHAIN_IDS.includes(c.id) && p2pEnabledChains.includes(c.id)).map(c => ({ chainId:c.id, chainName:c.name, tokenAddress:(FX_TOKENS[c.id] || []).find(t => t.symbol === 'USDC')?.address })).filter(s => s.tokenAddress);
  const pickFromAllChains = (o) => {
    setP2pAll(false); setP2pActionType('buy');
    if (o.chainKey === 'stellar') setP2pStellar(true); else { setP2pStellar(false); setP2pChain(CHAINS.find(c => c.id === o.chainKey) || CHAINS[0]); }
  };

  const allChainSelect = (
    <select value="all" onChange={e => { if (e.target.value==='all') return; setP2pAll(false); if (e.target.value==='stellar') setP2pStellar(true); else { setP2pStellar(false); setP2pChain(CHAINS.find(c=>c.id===e.target.value)); } }} className="bg-[#0a0f1a] border border-slate-700 rounded px-2 py-1 text-[10px] text-white outline-none">
      <option value="all">All chains</option>{CHAINS.filter(c => P2P_CHAIN_IDS.includes(c.id) && p2pEnabledChains.includes(c.id)).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}<option value="stellar">Stellar</option>
    </select>
  );

  const stellarChainSelect = (
    <select value="stellar" onChange={e => { if (e.target.value==='all') { setP2pAll(true); return; } if (e.target.value!=='stellar') { setP2pStellar(false); setP2pChain(CHAINS.find(c=>c.id===e.target.value)); } }} className="bg-[#0a0f1a] border border-slate-700 rounded px-2 py-1 text-[10px] text-white outline-none">{exchangeMode==='p2p_market' && <option value="all">All chains</option>}
      {CHAINS.filter(c => P2P_CHAIN_IDS.includes(c.id) && p2pEnabledChains.includes(c.id)).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}<option value="stellar">Stellar</option>
    </select>
  );

  // "How it works" for the Stellar tabs (StellarP2P renders its own screens, so the guide lives here)
  const renderStellarGuide = (view) => {
    const isMerchant = view === 'merchant';
    const open = isMerchant ? showMerchantGuide : showP2PGuide;
    const toggle = () => (isMerchant ? setShowMerchantGuide(!showMerchantGuide) : setShowP2PGuide(!showP2PGuide));
    const steps = isMerchant
      ? [{t:'1. Choose',c:'text-blue-400',b:'Sell USDC or EURC for the other stablecoin, or for bank money through Stripe or your own Monerium IBAN.'},{t:'2. Escrow',c:'text-blue-400',b:'You lock USDC or EURC in the Soroban escrow contract from your own wallet.'},{t:'3. Earn',c:'text-emerald-400',b:'The buyer pays, the oracle confirms and the contract settles. You receive the payment plus your spread.'},{t:'4. Refunds',c:'text-purple-400',b:'Unfilled or expired trades are refunded to your wallet.'}]
      : [{t:'1. Choose Offer',c:'text-blue-400',b:'Pick an offer with the best rate. The price guard rejects rates far from the market.'},{t:'2. Escrow Lock',c:'text-blue-400',b:'The seller\'s crypto is locked in a Soroban smart contract.'},{t:'3. Pay',c:'text-blue-400',b:'Pay with a Stripe bank payment, by SEPA to the seller\'s Monerium IBAN, or on-chain.'},{t:'4. Auto-Release',c:'text-emerald-400',b:'Once payment is confirmed, the contract releases the crypto to you. You sign every step in your own wallet.'}];
    return (
      <div className="px-4 pt-4 space-y-3">
        <div className="flex items-center gap-2">
          <h3 className="text-white font-bold text-sm">{isMerchant ? 'Merchant Dashboard' : 'P2P Market'} <span className="text-slate-500 font-normal text-[10px]">Stellar</span></h3>
          <button onClick={toggle} className="text-[9px] px-2 py-0.5 rounded border border-slate-700 text-slate-400 hover:text-white hover:bg-slate-800">{open?'Hide':'How it works'}</button>
        </div>
        {open && (
          <div className="bg-[#1c1d22] border border-blue-500/30 rounded-xl p-4">
            <p className="text-[10px] text-blue-400 font-bold uppercase tracking-wider mb-3">{isMerchant ? 'How to be a Merchant' : 'How P2P Works'}</p>
            <div className="grid grid-cols-2 gap-2">
              {steps.map(({t,c,b})=>(
                <div key={t} className="bg-[#0a0f1a] border border-slate-800 p-3 rounded-lg">
                  <span className={`text-[10px] font-bold uppercase flex items-center gap-1 mb-1 ${c}`}>{t}</span>
                  <span className="text-[10px] text-slate-500 leading-tight">{b}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderP2POfferList = () => (
    <div className="flex-1 overflow-y-auto p-4 custom-scrollbar space-y-4">
      <div className="flex justify-between items-center px-1 mb-2">
        <div className="flex items-center gap-2">
          <h3 className="text-white font-bold text-sm">P2P Market</h3>
          <button onClick={()=>setShowP2PGuide(!showP2PGuide)} className="text-[9px] px-2 py-0.5 rounded border border-slate-700 text-slate-400 hover:text-white hover:bg-slate-800">{showP2PGuide?'Hide':'How it works'}</button>
        </div>
        <div className="flex items-center gap-2">
           <select value={p2pAll?'all':(p2pStellar?'stellar':p2pChain.id)} onChange={e => { if (e.target.value==='all') { setP2pAll(true); return; } setP2pAll(false); if (e.target.value==='stellar') setP2pStellar(true); else { setP2pStellar(false); setP2pChain(CHAINS.find(c=>c.id===e.target.value)); } }} className="bg-[#0a0f1a] border border-slate-700 rounded px-2 py-1 text-[10px] text-white outline-none"><option value="all">All chains</option>
              {CHAINS.filter(c => P2P_CHAIN_IDS.includes(c.id) && p2pEnabledChains.includes(c.id)).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}<option value="stellar">Stellar</option>
           </select>
           <div className="bg-[#1c1d22] p-1 rounded-lg border border-slate-700 flex gap-1">
             {[{id:'buy',label:'Buy Crypto',color:'bg-blue-600'},{id:'sell',label:'Sell Crypto',color:'bg-emerald-600'}].map(tab=>(
               <button key={tab.id} onClick={()=>setP2pActionType(tab.id)} className={`px-3 py-1 text-[10px] font-bold rounded-md transition-all ${p2pActionType===tab.id?`${tab.color} text-white`:'text-slate-400 hover:text-white'}`}>{tab.label}</button>
             ))}
           </div>
        </div>
      </div>

      {showP2PGuide && (
        <div className="bg-[#1c1d22] border border-blue-500/30 rounded-xl p-4">
          <p className="text-[10px] text-blue-400 font-bold uppercase tracking-wider mb-3">How P2P Works</p>
          <div className="grid grid-cols-2 gap-2">
            {[{icon:Users,color:'text-blue-400',t:'1. Choose Offer',b:'Pick a verified merchant with the best rate.'},{icon:Lock,color:'text-blue-400',t:'2. Escrow Lock',b:'Crypto locks in a smart contract — zero counterparty risk.'},{icon:Banknote,color:'text-blue-400',t:'3. Pay into Escrow',b:'On a Stripe page, or with EURe from your own Monerium IBAN - held in escrow too.'},{icon:ShieldCheck,color:'text-emerald-400',t:'4. Auto-Release',b:'Both sides are held, so the swap runs automatically.'}].map(({icon:Icon,color,t,b})=>(
              <div key={t} className="bg-[#0a0f1a] border border-slate-800 p-3 rounded-lg">
                <span className={`text-[10px] font-bold uppercase flex items-center gap-1 mb-1 ${color}`}><Icon size={11}/> {t}</span>
                <span className="text-[10px] text-slate-500 leading-tight">{b}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {p2pActionType==='buy' && openBuyOrder && !p2pOrder && (
        <div className="mb-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3">
          <p className="text-[11px] font-bold text-amber-300">You have an open trade</p>
          <p className="mt-1 text-[11px] text-amber-200/80">{Number(openBuyOrder.amount).toFixed(2)} USDC for {openBuyOrder.fiatAmount} {String(openBuyOrder.fiatCurrency || 'EUR').toUpperCase()} - {P2P_STATUS_TEXT[openBuyOrder.status] || openBuyOrder.status}{openBuyOrder.expiresAt ? ` Open until ${new Date(Number(openBuyOrder.expiresAt) * 1000).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' })}.` : ''} You can open a new trade after you pay this one or it expires.</p>
          <button onClick={() => { dismissedOrdersRef.current.delete(openBuyOrder.orderId || openBuyOrder.id); setP2pOrder(orderFromRow(openBuyOrder)); }} className="mt-2 w-full rounded-lg bg-amber-500 py-2 text-xs font-bold text-black hover:bg-amber-400">Open my trade and pay</button>
        </div>
      )}

      {p2pActionType==='buy' && !p2pOrder && myBuyTrades.length > 0 && (
        <div className="mb-3 rounded-xl border border-slate-700 bg-[#1c1d22] p-3">
          <p className="text-[11px] font-bold text-white">Your trades</p>
          {myBuyTrades.map(t => {
            const isReq = ['REQUESTED', 'APPROVED'].includes(t.status);
            const left = isReq ? null : bankSecLeft(t); const late = !isReq && isTooLateForBank(t); const gone = !isReq && (t.expired || (left !== null && left <= 0));
            const reqUntil = isReq && t.requestExpiresAt ? new Date(Number(t.requestExpiresAt)).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' }) : '';
            const mins = left !== null ? Math.max(0, Math.floor(left / 60)) : null;
            const note = (t.escrowV5 && gone) ? 'Expired - the USDC goes back into the seller\'s offer (automatically)' : isReq ? (t.status === 'APPROVED' ? `Approved by the seller - lock and pay before ${reqUntil}` : `Waiting for the seller to approve (until ${reqUntil}). Nothing is locked yet.`) : gone ? 'Expired - the USDC goes back to the seller\'s wallet' : late ? `Too late to pay by bank - expires in ${mins} min` : (['ACCEPTED', 'PAYMENT_CREATED', 'ACCEPTING'].includes(t.status) ? `Pay within ${mins} min` : (P2P_STATUS_TEXT[t.status] || t.status));
            const canOpen = !isReq && !gone && !late;
            return (
              <div key={t.orderId || t.id} className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-black/20 px-2 py-2">
                <div className="min-w-0">
                  <p className="text-[11px] font-bold text-slate-200">{Number(t.amount).toFixed(2)} USDC - {t.fiatAmount} {String(t.fiatCurrency || 'EUR').toUpperCase()}</p>
                  <p className={`text-[10px] ${gone || late ? 'text-red-300' : 'text-slate-400'}`}>{note}</p>
                </div>
                {canOpen && <button onClick={() => { dismissedOrdersRef.current.delete(t.orderId || t.id); setP2pOrder(orderFromRow(t)); }} className="shrink-0 rounded-lg bg-amber-500 px-3 py-1.5 text-[11px] font-bold text-black hover:bg-amber-400">Open</button>}
                {t.status === 'APPROVED' && <button disabled={isEscrowExecuting} onClick={() => lockApproved(t)} className="shrink-0 rounded-lg bg-emerald-500 px-3 py-1.5 text-[11px] font-bold text-black hover:bg-emerald-400 disabled:opacity-50">Lock &amp; pay</button>}
                {isReq && <button onClick={() => cancelRequest(t)} className="shrink-0 rounded-lg bg-slate-700 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-slate-600">Cancel request</button>}
                {!gone && t.escrowV5 && ['ACCEPTED', 'PAYMENT_CREATED'].includes(t.status) && <button disabled={!!orderActionId} onClick={() => handleOrderAction('cancel', t.orderId || t.id)} className="shrink-0 rounded-lg bg-slate-700 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-slate-600 disabled:opacity-50">Cancel trade</button>}
                {gone && ['ACCEPTED', 'PAYMENT_CREATED', 'PAYMENT_INITIATED'].includes(t.status) && <button disabled={!!orderActionId} onClick={() => handleOrderAction('cancel', t.orderId || t.id)} className="shrink-0 rounded-lg bg-slate-700 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-slate-600 disabled:opacity-50">Cancel expired trade</button>}
              </div>
            );
          })}
        </div>
      )}

      {p2pActionType==='buy' ? renderBuyOrderPanel() : renderSellToBuyersPanel()}

      {p2pActionType==='buy' && !isLoadingOffers && !offersError && (<div className="flex items-center justify-between bg-[#1c1d22] border border-slate-800 rounded-xl px-4 py-3"><div><p className="text-[10px] text-slate-500 uppercase font-bold">Funds available</p><p className="text-lg font-bold text-white">{totalAvailable.toLocaleString(undefined,{maximumFractionDigits:2})} {(P2P_SELL_TOKENS[p2pChain.id] || ['USDC']).filter(t => !ART_SYMS.includes(t)).join(' / ')}{artAvailable ? ' · ' + artAvailable : ''}</p></div><span className="text-[10px] font-bold text-slate-400">{p2pOffers.length} offer{p2pOffers.length===1?'':'s'}</span></div>)}
      {p2pActionType==='buy' && isLoadingOffers && <div className="flex flex-col items-center justify-center py-12 space-y-3"><Loader2 className="w-8 h-8 text-blue-500 animate-spin"/><p className="text-sm text-slate-400">Loading live P2P market…</p></div>}
      {p2pActionType==='buy' && !isLoadingOffers && offersError && (
        <div className="flex flex-col items-center justify-center py-12 space-y-3 text-center">
          <AlertTriangle className="w-10 h-10 text-amber-500 mb-2"/><p className="text-sm font-bold text-white">Market Unavailable</p>
          <p className="text-xs text-slate-400 max-w-xs">{offersError}</p>
          <button onClick={()=>{setOffersError(null);setIsLoadingOffers(true);setOffersReload(n=>n+1);}} className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 mt-2"><RefreshCcw size={12}/> Retry</button>
        </div>
      )}
      {p2pActionType==='buy' && !isLoadingOffers && !offersError && p2pOffers.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 space-y-3 text-center">
          <Store className="w-10 h-10 text-slate-600 mb-2"/><p className="text-sm font-bold text-white">No Active Offers</p>
          <p className="text-xs text-slate-400">No funds available yet - no verified trader has locked funds in escrow.</p>
        </div>
      )}
      {p2pActionType==='buy' && !isLoadingOffers && !offersError && marketCurrencies.length > 1 && (
        <div className="flex flex-wrap gap-1">{['ALL', ...marketCurrencies].map(c => (
          <button key={c} onClick={()=>setMarketCur(c)} className={`px-3 py-1 rounded-lg text-[11px] font-bold border ${marketCurFilter===c ? 'bg-blue-600 border-blue-500 text-white' : 'bg-[#1c1d22] border-slate-800 text-slate-400 hover:text-white'}`}>{c === 'ALL' ? 'All currencies' : c}</button>
        ))}</div>
      )}
      {p2pActionType==='buy' && !isLoadingOffers && !offersError && shownOffers.map(offer=>(
        <div key={offer.id||offer.merchantAddress} className="bg-[#1c1d22] border border-slate-800 rounded-xl p-4 hover:border-blue-500/50 transition-colors cursor-pointer" onClick={()=>{ if (openBuyOrder) { showToast?.('You already have an open trade. Pay it, or wait until it expires, before opening another.', 'error'); return; } setSelectedOffer(offer); }}>
          <div className="flex justify-between items-start mb-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center border border-slate-700"><Users size={14} className="text-slate-300"/></div>
              <div><h4 className="text-sm font-bold text-white flex items-center gap-1">{offer.merchantName} {offer.verified&&<CheckCircle2 size={12} className="text-blue-400"/>}</h4><p className="text-[10px] text-emerald-400">{repLine(offer.sellerRep)}</p></div>
            </div>
            <div className="text-right">
              <p className="text-xs font-bold text-white">1 {offer.fiatCurrency} = {p2pActionType==='buy'?offer.buyRate:offer.sellRate} {sellSymOf(offer, p2pChain.id)}</p>
              {vsMarket(offer) && <p className={`text-[10px] font-bold mt-0.5 ${Math.abs(parseFloat(vsMarket(offer))) > maxDev + 0.05 ? 'text-amber-400' : 'text-emerald-400'}`}>{vsMarket(offer)}</p>}
              <p className="text-[10px] text-slate-500 mt-0.5">Avail: {p2pActionType==='buy'?`${Number(offer.availableUSDC).toLocaleString()} ${sellSymOf(offer, p2pChain.id)}`:`${Number(offer.availableFiat).toLocaleString()} ${offer.fiatCurrency}`}</p>
            </div>
          </div>
          <div className="flex items-center justify-between pt-3 border-t border-slate-800/50">
            <div className="flex gap-2">
              <span className="text-[10px] text-slate-400 bg-slate-800/50 px-2 py-1 rounded flex items-center gap-1"><Banknote size={10}/> {offer.minFiat}–{offer.maxFiat} {offer.fiatCurrency}</span>
              <span className="text-[10px] text-slate-400 bg-slate-800/50 px-2 py-1 rounded flex items-center gap-1"><Clock size={10}/> {offer.term}</span>
            </div>
            <button className={`text-[10px] font-bold text-white px-3 py-1.5 rounded-lg ${p2pActionType==='buy'?'bg-blue-600 hover:bg-blue-500':'bg-emerald-600 hover:bg-emerald-500'}`}>{p2pActionType==='buy'?`Buy ${sellSymOf(offer, p2pChain.id)}`:`Sell ${sellSymOf(offer, p2pChain.id)}`}</button>
          </div>
        </div>
      ))}
    </div>
  );

  const renderP2POfferDetail = () => {
    const isBuying = p2pActionType === 'buy';
    const sellSym  = sellSymOf(selectedOffer, p2pChain.id);
    const rate     = isBuying ? selectedOffer.buyRate : selectedOffer.sellRate;
    const inputVal = parseFloat(p2pAmountInput) || 0;
    const grossOut = isBuying ? inputVal * parseFloat(rate) : inputVal / parseFloat(rate);
    const fee      = grossOut * PLATFORM_FEE_PERCENT;
    const netOut   = grossOut - fee;
    return (
      <div className="flex-1 overflow-y-auto p-4 custom-scrollbar flex flex-col">
        <button onClick={()=>{setSelectedOffer(null);setP2pAmountInput('');setClientBankDetails('');}} className="flex items-center gap-1 text-[11px] font-bold text-slate-400 hover:text-white mb-4 w-fit"><ChevronLeft size={14}/> Back to Market</button>
        <div className="bg-[#1c1d22] border border-slate-800 rounded-xl p-4 mb-4">
          <div className="flex items-center gap-2 mb-4 pb-3 border-b border-slate-800/50"><div className="w-6 h-6 rounded-full bg-blue-500/20 flex items-center justify-center border border-blue-500/30"><Store size={12} className="text-blue-400"/></div><h3 className="text-sm font-bold text-white">{selectedOffer.merchantName}</h3></div>
          <div className="grid grid-cols-2 gap-4">
            <div><p className="text-[10px] text-slate-500 uppercase mb-1">Rate</p><p className="text-sm font-bold text-white">1 {selectedOffer.fiatCurrency} = {rate} {sellSym}</p>{vsMarket(selectedOffer) && <p className="text-[10px] text-slate-400 mt-0.5">{vsMarket(selectedOffer)}</p>}</div>
            <div><p className="text-[10px] text-slate-500 uppercase mb-1">Payment</p><p className="text-sm font-bold text-white">{selectedOffer.term}</p></div>
          </div>
          <p className="text-[10px] text-emerald-400 mt-3">{repLine(selectedOffer.sellerRep)}</p>
          {selectedOffer.payWindowMinutes && <p className="mt-3 text-[10px] text-slate-400">After the seller approves your request you have <b className="text-slate-200">{selectedOffer.payWindowMinutes >= 60 ? `${selectedOffer.payWindowMinutes / 60} h` : `${selectedOffer.payWindowMinutes} min`}</b> to pay. Until you pay you can cancel the trade and nothing is charged.</p>}
          {selectedOffer.terms && <div className="mt-3 rounded-lg bg-[#0a0f1a] border border-slate-800 p-3"><p className="text-[10px] text-slate-500 uppercase mb-1">Seller's terms</p><p className="text-[11px] text-slate-300 whitespace-pre-wrap break-words">{selectedOffer.terms}</p></div>}
          {condLine(selectedOffer.conditions) && <p className="text-[10px] text-amber-300 mt-2">Seller requires: {condLine(selectedOffer.conditions)}</p>}
        </div>
        <div className="space-y-4 mb-6">
          <div className="bg-[#0a0f1a] border border-slate-700 rounded-xl p-3 focus-within:border-blue-500 transition-colors">
            <div className="flex justify-between items-center mb-1"><label className="text-[10px] font-bold text-slate-500 uppercase">I want to {isBuying?'pay':'sell'}</label><span className="text-[9px] text-slate-500">{selectedOffer.partial ? `You can pay ${Number(selectedOffer.minFiat).toFixed(2)} – ${Number(selectedOffer.maxFiat).toFixed(2)} ${selectedOffer.fiatCurrency}` : `Full offer: ${Number(selectedOffer.fiatAmount || selectedOffer.maxFiat || 0).toFixed(2)} ${selectedOffer.fiatCurrency}`}</span></div>
            <div className="flex items-center justify-between"><input type="number" value={p2pAmountInput} onChange={e=>setP2pAmountInput(e.target.value)} disabled={isEscrowExecuting} placeholder="0.00" className="bg-transparent text-2xl font-bold text-white outline-none w-full"/><span className="text-sm font-bold text-slate-300">{isBuying?selectedOffer.fiatCurrency:sellSym}</span></div>
          </div>
          <div className="flex justify-center -my-2 z-10 relative"><div className="bg-[#131418] border border-slate-700 p-1.5 rounded-full"><ArrowDown size={14} className={isBuying?'text-blue-500':'text-emerald-500'}/></div></div>
          <div className="bg-[#0a0f1a] border border-slate-700 rounded-xl p-3 opacity-80">
            <label className="text-[10px] font-bold text-slate-500 uppercase mb-1 block">You receive (net)</label>
            <div className="flex items-center justify-between mb-2"><span className="text-2xl font-bold text-emerald-400">{netOut>0?netOut.toFixed(2):'0.00'}</span><span className="text-sm font-bold text-slate-300">{isBuying?sellSym:selectedOffer.fiatCurrency}</span></div>
            {inputVal > 0 && <div className="pt-2 mt-2 border-t border-slate-800/50 space-y-1"><div className="flex justify-between text-[10px] text-slate-400"><span>Gross from merchant</span><span>{grossOut.toFixed(2)} {isBuying?sellSym:selectedOffer.fiatCurrency}</span></div><div className="flex justify-between text-[10px] text-slate-500 font-bold"><span>Platform fee ({(PLATFORM_FEE_PERCENT*100).toFixed(2)}%)</span><span>- {fee.toFixed(2)} {isBuying?sellSym:selectedOffer.fiatCurrency}</span></div></div>}
          </div>
          {!isBuying && (
            <div className="bg-[#1c1d22] border border-slate-800 rounded-xl p-4">
              <label className="text-[10px] font-bold text-slate-500 uppercase mb-2 block">Receiving Bank IBAN</label>
              <input type="text" value={clientBankDetails} onChange={e=>setClientBankDetails(e.target.value)} disabled={isEscrowExecuting} placeholder="e.g., DE89 3704 0044 0532 0130 00" className="w-full bg-[#0a0f1a] border border-slate-700 p-3 rounded-lg text-sm font-mono text-white outline-none focus:border-emerald-500"/>
            </div>
          )}
        </div>
        <div className="mt-auto">
          {isEscrowExecuting && <div className="flex justify-center mb-3"><span className="text-xs text-blue-400 flex items-center gap-2"><Loader2 size={14} className="animate-spin"/> {escrowStatusMessage}</span></div>}
          {isBuying && P2P_GAS[gasChainId] && (buyerGas !== null && buyerGas < P2P_GAS[gasChainId].min
            ? <div className="mb-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-[11px] text-amber-300"><b>You need {P2P_GAS[gasChainId].sym} for the network fee.</b> Opening this trade is one on-chain transaction, paid in {P2P_GAS[gasChainId].sym} on {P2P_GAS[gasChainId].chain} from your own wallet (about {P2P_GAS[gasChainId].min} {P2P_GAS[gasChainId].sym}). Your wallet holds {buyerGas.toFixed(4)}. Add some {P2P_GAS[gasChainId].sym} first, otherwise the trade can not start. You have not paid anything yet.</div>
            : <div className="mb-3 rounded-xl border border-slate-700 bg-slate-800/40 p-3 text-[10px] text-slate-400">Before you pay: opening the trade needs a small network fee in {P2P_GAS[gasChainId].sym} on {P2P_GAS[gasChainId].chain} from your wallet{buyerGas !== null ? ` (you have ${buyerGas.toFixed(4)} ${P2P_GAS[gasChainId].sym})` : ''}. The euros are paid by bank afterwards.</div>)}
          {isBuying && selectedOffer.fiatRail === 'stripe' && (
            <div className="mb-3 rounded-xl border border-sky-500/30 bg-sky-500/5 p-3">
              <label className="text-[10px] font-bold uppercase text-slate-400">Your e-mail (required)</label>
              <input type="email" value={buyerEmail} onChange={e => { const v = e.target.value.slice(0, 120); setBuyerEmail(v); try { localStorage.setItem('timax_p2p_email', v.trim()); } catch { /* ignore */ } }} placeholder="you@example.com" autoComplete="email" className={`mt-1 w-full rounded-lg border bg-[#0a0f1a] px-3 py-2 text-xs text-white outline-none ${buyerEmail && !buyerEmailOk ? 'border-red-500/60' : 'border-slate-700 focus:border-sky-500'}`} />
              <p className="mt-1 text-[10px] text-slate-400">Stripe sends the bank-transfer details to this address and uses it to return your money if the trade does not complete. The seller does not see it.</p>
            </div>
          )}
          {!isBuying && <div className="mb-3 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-[10px] text-amber-300">Sell-side P2P offers are not enabled in V2 yet. V2 liquidity is seller-funded escrow; Timax will enable funded buyer offers separately rather than showing a non-executable counterparty.</div>}
          {isBuying
            ? <button disabled={!inputVal||(selectedOffer.fiatRail === 'stripe' && !buyerEmailOk)||(P2P_GAS[gasChainId] && buyerGas !== null && buyerGas < P2P_GAS[gasChainId].min)||(selectedOffer.partial ? ((inputVal + 0.005 < Number(selectedOffer.minFiat) && Math.abs(inputVal - Number(selectedOffer.maxFiat)) > 0.01) || inputVal > Number(selectedOffer.maxFiat) + 0.005) : Math.abs(inputVal-Number(selectedOffer.fiatAmount || selectedOffer.maxFiat || 0))>0.01)} onClick={async ()=>{
              setIsEscrowExecuting(true);
              try {
                await buyOffer(selectedOffer, p2pAmountInput, netOut.toFixed(2));
              } catch (e) { showToast?.(cleanWeb3Error(e), 'error'); }
              finally { setIsEscrowExecuting(false); setEscrowStatusMessage(''); }
            }} className="w-full py-4 rounded-xl font-bold bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white">Send request to seller</button>
            : <button disabled={true} onClick={()=>handleClientSellLock(netOut)} className="w-full py-4 rounded-xl font-bold bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white flex items-center justify-center gap-2"><Lock size={16}/> Lock {sellSym} & Open Sell Trade</button>}
        </div>
      </div>
    );
  };

  const renderP2PActiveOrder = () => {
    const isBuying = p2pOrder.type === 'buy';
    const sellSym  = sellSymOf(p2pOrder, p2pChain.id);
    const tooLate = isBuying && isTooLateForBank(p2pOrder);
    const secLeft = isBuying ? bankSecLeft(p2pOrder) : null;
    const expAt = p2pOrder.expiresAt ? new Date(Number(p2pOrder.expiresAt) * 1000).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' }) : '';
    return (
      <div className="flex-1 overflow-y-auto p-4 custom-scrollbar flex flex-col">
        <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-4 mb-4 text-center"><h2 className="text-lg font-bold text-blue-400 mb-1">P2P Trade</h2><p className="text-[11px] text-blue-200/70">{isBuying?`${p2pOrder.cryptoAmount} ${sellSym} is locked in escrow by the merchant, and your payment is held in escrow too. The swap runs automatically - nothing is released until both are in place.`:`You locked ${p2pOrder.inputAmount} ${sellSym} in escrow.`}</p></div>
        <TradeAlerts account={evmAddress} signMessage={signForP2P} />
        {isBuying && ['ACCEPTED', 'PAYMENT_CREATED'].includes(p2pOrder.status) && (p2pOrder.escrowV5 || myBuyTrades.some(t => (t.orderId || t.id) === (p2pOrder.orderId || p2pOrder.id) && t.escrowV5)) && <button disabled={!!orderActionId} onClick={async () => { await handleOrderAction('cancel', p2pOrder.orderId || p2pOrder.id); setP2pOrder(null); }} className="mb-3 w-full rounded-xl border border-slate-600 bg-slate-800 py-2.5 text-xs font-bold text-slate-200 hover:bg-slate-700 disabled:opacity-50">Cancel this trade (nothing is paid, the USDC goes back into the seller's offer)</button>}
        {(p2pOrder.orderId || p2pOrder.id) && p2pOrder.type === 'buy' && <div className="mb-3 space-y-2"><TradeHistory orderId={p2pOrder.orderId || p2pOrder.id} p2pFetch={p2pFetch} hasSession={p2pHasSession} reloadKey={p2pOrder.status} /><TradeChat orderId={p2pOrder.orderId || p2pOrder.id} p2pFetch={p2pFetch} hasSession={p2pHasSession} showToast={showToast} /></div>}
        {tooLate && <div className="rounded-xl p-3 mb-4 text-[11px] border bg-red-500/10 border-red-500/30 text-red-300"><b>Too late to pay this trade by bank.</b> A bank payment needs at least 31 minutes before the trade expires{expAt ? ` (it expires at ${expAt})` : ''}. You have not paid anything. When it expires the seller's USDC goes back to the seller. Close this screen and open a new trade, then pay it within a few minutes.</div>}
        {isBuying && !tooLate && secLeft !== null && secLeft >= MIN_BANK_PAY_SEC && ['ACCEPTED', 'PAYMENT_CREATED'].includes(p2pOrder.status) && ['stripe', 'sepa'].includes(p2pOrder.rail) && <div className="rounded-xl p-3 mb-4 text-[11px] border bg-amber-500/10 border-amber-500/30 text-amber-200">Start your payment within <b>{Math.max(1, Math.floor((secLeft - MIN_BANK_PAY_SEC) / 60))} minutes</b>. After that a bank payment can no longer be started for this trade{expAt ? ` (it expires at ${expAt})` : ''}.</div>}
        {isBuying && ['stripe', 'sepa'].includes(p2pOrder.rail) && <TradeTime role="buyer" orderId={p2pOrder.orderId || p2pOrder.id} p2pFetch={p2pFetch} hasSession={p2pHasSession} showToast={showToast} sendTx={sendEscrowTx} onSync={(o) => setP2pOrder(p => (p ? { ...p, expiresAt:o.expiresAt, checkoutUrl:o.stripeCheckoutUrl || null } : p))} />}
        {isBuying && p2pOrder.status && <div className={`rounded-xl p-3 mb-4 text-[11px] font-bold border ${p2pOrder.status==='RELEASED'?'bg-emerald-500/10 border-emerald-500/30 text-emerald-300':p2pOrder.status==='DISPUTED'?'bg-red-500/10 border-red-500/30 text-red-300':'bg-slate-800/60 border-slate-700 text-slate-300'}`}>{P2P_STATUS_TEXT[p2pOrder.status] || p2pOrder.status}</div>}
        <div className="bg-[#1c1d22] border border-slate-800 rounded-xl p-4 space-y-4">
          {isBuying && p2pOrder.rail === 'stripe' ? (
            <>
              <div><p className="text-[10px] font-bold text-slate-500 uppercase mb-1">Amount to pay</p><div className="bg-[#0a0f1a] p-3 rounded-lg border border-slate-700"><span className="text-sm font-bold text-white">{p2pOrder.fiatAmount} {p2pOrder.fiatCurrency}</span></div></div>
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 space-y-1">
                <p className="text-[11px] font-bold text-amber-300">Choose an instant method on the Stripe page</p>
                <p className="text-[10px] text-amber-100/80">iDEAL, Bancontact, EPS and pay by bank confirm in seconds. <b>Bank transfer is not instant</b>: it can take 1-3 business days even if your bank sends it at once, and it will not arrive in time for this trade. If it arrives late, you are refunded automatically.</p>
              </div>
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 space-y-1">
                <p className="text-[11px] font-bold text-emerald-300 flex items-center gap-1"><ShieldCheck size={12}/> Your payment is protected</p>
                <p className="text-[11px] text-slate-300">Pay on the Stripe page. Timax holds your payment in escrow: it is <b>not paid to the seller</b> until the {sellSym} is in your wallet, and it is refunded automatically if the trade cannot complete.</p>
                {p2pOrder.stripePaymentProcessing && <p className="text-[11px] text-amber-300">Your bank payment is processing. Nothing is released and the seller cannot cancel while it clears.</p>}
              </div>
              {p2pOrder.checkoutUrl
                ? <button onClick={()=>{ try { window.open(p2pOrder.checkoutUrl, '_blank', 'noopener'); } catch { /* ignore */ } }} className="w-full py-3 rounded-xl font-bold bg-indigo-600 hover:bg-indigo-500 text-white flex items-center justify-center gap-2"><Banknote size={16}/> Pay {p2pOrder.fiatAmount} {p2pOrder.fiatCurrency} with Stripe</button>
                : <button disabled={isEscrowExecuting || tooLate} onClick={async ()=>{ setIsEscrowExecuting(true); try { const r = await p2pFetch('/api/p2p/escrow/checkout', { method:'POST', body:JSON.stringify({orderId:p2pOrder.orderId || p2pOrder.id}) }); const d = await readJson(r); if (!r.ok || !d.success) throw new Error(d.error || 'Could not create the Stripe payment page.'); setP2pOrder(o => ({...o, checkoutUrl:d.checkoutUrl})); try { window.open(d.checkoutUrl, '_blank', 'noopener'); } catch { /* ignore */ } } catch (e) { showToast?.(cleanWeb3Error(e), 'error'); } finally { setIsEscrowExecuting(false); } }} className="w-full py-3 rounded-xl font-bold bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white">Get a payment page</button>}
            </>
          ) : isBuying && p2pOrder.rail === 'sepa' && p2pOrder.status === 'ACCEPTED' ? (
            <>
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 space-y-2">
                <p className="text-[11px] font-bold text-amber-300">Bank details are not ready yet. Do not pay yet.</p>
                <p className="text-[11px] text-slate-300">The trade is reserved, but it has not been started for the bank transfer. Tap the button. The IBAN and the reference appear only when it is ready, so a payment is never made into a trade that cannot receive it.</p>
                <button disabled={isEscrowExecuting} onClick={async () => { setIsEscrowExecuting(true); try { const r = await p2pFetch('/api/p2p/escrow/sepa-start', { method:'POST', body:JSON.stringify({ orderId:p2pOrder.orderId || p2pOrder.id }) }); const d = await readJson(r); if (!r.ok || !d.success) throw new Error(d.error || 'Could not prepare the bank details.'); setP2pOrder(o => ({ ...o, status:'PAYMENT_INITIATED', paymentInitiatedTxHash:d.txHash, sellerMoneriumIban:d.iban, moneriumReference:d.reference, fiatAmount:d.amount, fiatCurrency:'EUR' })); } catch (e) { showToast?.(cleanWeb3Error(e), 'error'); } finally { setIsEscrowExecuting(false); } }} className="w-full py-2.5 rounded-lg font-bold bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white">{isEscrowExecuting ? '…' : 'Get my bank details'}</button>
              </div>
            </>
          ) : isBuying && p2pOrder.rail === 'sepa' ? (
            <>
              <div><p className="text-[10px] font-bold text-slate-500 uppercase mb-1">Send exactly</p><div className="flex justify-between items-center bg-[#0a0f1a] p-3 rounded-lg border border-slate-700"><span className="text-sm font-bold text-white">{Number(p2pOrder.fiatAmount).toFixed(2)} EUR</span><button onClick={()=>navigator.clipboard.writeText(Number(p2pOrder.fiatAmount).toFixed(2))} className="text-slate-400 hover:text-white"><Copy size={14}/></button></div></div>
              <div><p className="text-[10px] font-bold text-slate-500 uppercase mb-1">To this IBAN (the seller's)</p><div className="flex justify-between items-center bg-[#0a0f1a] p-3 rounded-lg border border-slate-700"><span className="text-sm font-bold text-emerald-400 font-mono tracking-wider break-all">{p2pOrder.sellerMoneriumIban || '…'}</span>{p2pOrder.sellerMoneriumIban && <button onClick={()=>navigator.clipboard.writeText(p2pOrder.sellerMoneriumIban)} className="text-slate-400 hover:text-white ml-2"><Copy size={14}/></button>}</div></div>
              <div><p className="text-[10px] font-bold text-slate-500 uppercase mb-1">Payment reference (required)</p><div className="flex justify-between items-center bg-[#0a0f1a] p-3 rounded-lg border border-amber-500/40"><span className="text-sm font-bold text-amber-300 font-mono tracking-wider">{p2pOrder.moneriumReference || '…'}</span>{p2pOrder.moneriumReference && <button onClick={()=>navigator.clipboard.writeText(p2pOrder.moneriumReference)} className="text-slate-400 hover:text-white"><Copy size={14}/></button>}</div></div>
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 space-y-1">
                <p className="text-[11px] font-bold text-emerald-300 flex items-center gap-1"><ShieldCheck size={12}/> Pay from any bank account</p>
                <p className="text-[11px] text-slate-300">Make a SEPA transfer in your bank app with <b>this exact amount</b> and <b>this reference</b>. The euros go straight to the seller; Timax holds nothing. Your {sellSym} is released to your wallet automatically as soon as the payment is confirmed. A different amount or a missing reference can not be matched.</p>
                <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 space-y-1">
                  <p className="text-[11px] font-bold text-amber-300">Pay with SEPA Instant only{expAt ? ` - before ${expAt}` : ''}</p>
                  <p className="text-[10px] text-amber-100/80">A normal SEPA transfer can take up to one business day and may arrive after this trade has expired. Then it can not be matched automatically and the seller has to refund you by hand.</p>
                  <p className="text-[10px] text-amber-100/80">In your bank app, choose <b>Instant</b> (it says the money arrives in seconds). If your app does not offer Instant, or shows "1-2 business days", do not pay: let this trade expire and use the Stripe bank payment instead. Not sure if your bank supports it? <a href="https://www.europeanpaymentscouncil.eu/what-we-do/be-involved/register-participants" target="_blank" rel="noopener noreferrer" className="underline text-amber-200">Check the EPC bank list</a>. UK and Swiss banks usually can not send SEPA Instant.</p>
                </div>
                {p2pOrder.status === 'PAYMENT_DETECTED' && <p className="text-[11px] text-amber-300">Your transfer was detected and is being confirmed. The seller can not cancel while it clears.</p>}
                {p2pOrder.needsAttention && <p className="text-[11px] text-red-300">We could not match your payment automatically. Contact Timax support with the reference above.</p>}
              </div>
            </>
          ) : isBuying && (p2pOrder.rail === 'monerium' || p2pOrder.rail === 'onchain') ? (
            <>
              {p2pOrder.stage === 'topup' && (<>
                <div><p className="text-[10px] font-bold text-slate-500 uppercase mb-1">EURe needed in your wallet</p><div className="bg-[#0a0f1a] p-3 rounded-lg border border-slate-700"><span className="text-sm font-bold text-white">{p2pOrder.fiatAmount} EUR</span><span className="text-[10px] text-slate-500 ml-2">you hold {Number(p2pOrder.eureBalance || 0).toFixed(2)} EURe</span></div></div>
                <p className="text-[11px] text-blue-200/80">Your euros stay in your own wallet as EURe. Send the amount by SEPA to <b>your own Monerium IBAN</b>: Monerium mints it to your wallet, usually within minutes. Then continue. Nothing is reserved until you hold the EURe.</p>
                <div><p className="text-[10px] font-bold text-slate-500 uppercase mb-1">Your Monerium IBAN</p><div className="flex justify-between items-center bg-[#0a0f1a] p-3 rounded-lg border border-slate-700"><span className="text-sm font-bold text-emerald-400 font-mono tracking-wider">{p2pOrder.iban || 'Open Monerium to see your IBAN'}</span>{p2pOrder.iban && <button onClick={()=>navigator.clipboard.writeText(p2pOrder.iban)} className="text-slate-400 hover:text-white"><Copy size={14}/></button>}</div></div>
              </>)}
              {p2pOrder.stage === 'needs_deposit' && <p className="text-[11px] text-amber-300">Offer reserved. Deposit your {legSymOf(p2pOrder)} into escrow to complete the trade - the swap then runs automatically.</p>}
              {p2pOrder.stage === 'escrowed' && <p className="text-[11px] text-blue-200/80">Your {legSymOf(p2pOrder)} and the merchant's {sellSym} are both held by the escrow contract. The swap runs automatically - nothing is released to either side until both are in place.</p>}
            </>
          ) : (
            <>
              <div className="text-center py-4"><Loader2 size={32} className="mx-auto text-emerald-500 animate-spin mb-3"/><p className="text-sm font-bold text-white mb-1">Awaiting Merchant Payment</p></div>
              <div className="bg-[#0a0f1a] p-3 rounded-lg border border-slate-700"><p className="text-[10px] font-bold text-slate-500 uppercase mb-1">Your Receiving IBAN</p><p className="text-xs font-mono text-white">{p2pOrder.clientBankDetails}</p></div>
            </>
          )}
        </div>
        <div className="mt-auto pt-6 space-y-2">
          {isEscrowExecuting && <div className="flex justify-center mb-2"><span className="text-xs text-emerald-400 flex items-center gap-2"><Loader2 size={14} className="animate-spin"/> {escrowStatusMessage}</span></div>}
          {isBuying && (p2pOrder.rail === 'monerium' || p2pOrder.rail === 'onchain') && ['topup', 'needs_deposit'].includes(p2pOrder.stage) && <button disabled={isEscrowExecuting} onClick={async ()=>{
              setIsEscrowExecuting(true);
              try {
                if (p2pOrder.stage === 'topup') await buyOffer(p2pOrder, p2pOrder.fiatAmount, p2pOrder.cryptoAmount);
                else { const st = await payFiatLeg(p2pOrder.orderId, legSymOf(p2pOrder)); setP2pOrder(o => (o ? ({...o, stage:'escrowed', status:st}) : o)); showToast?.(`Your ${legSymOf(p2pOrder)} is in escrow - the swap runs automatically.`, 'success'); }
              } catch (e) { showToast?.(cleanWeb3Error(e), 'error'); }
              finally { setIsEscrowExecuting(false); setEscrowStatusMessage(''); }
            }} className="w-full py-4 rounded-xl font-bold bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white mb-2">{p2pOrder.stage === 'topup' ? 'I have topped up - continue' : `Escrow my ${legSymOf(p2pOrder)}`}</button>}
          {isBuying && p2pOrder.rail === 'monerium' && <button disabled={isEscrowExecuting} onClick={()=>onOpenMonerium?.()} className="w-full py-3 rounded-xl font-bold bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white flex items-center justify-center gap-2 mb-2"><Landmark size={16}/> Open Monerium Banking</button>}
          {isBuying && ['topup', 'needs_deposit'].includes(p2pOrder.stage)
            ? null
            : isBuying
            ? <button disabled={isEscrowExecuting} onClick={async ()=>{
                setIsEscrowExecuting(true); setEscrowStatusMessage('Checking Timax payment status…');
                try {
                  const r = await p2pFetch(`/api/p2p/escrow/${p2pOrder.orderId || p2pOrder.id}`);
                  const d = await readJson(r);
                  if (!r.ok || !d.success) throw new Error(d.error || 'Could not load P2P status.');
                  setP2pOrder(o => ({...o, chainState:d.chainState, stripePaymentProcessing:!!d.order?.stripePaymentProcessing, status:d.order?.status || d.chainState?.statusLabel || o.status}));   // status only: the record's own `type` must not replace the trade's
                  const st = d.order?.status || d.chainState?.statusLabel;
                  if (st === 'RELEASED') showToast?.('Completed - the funds are in your wallet.', 'success');
                  else if (st === 'FIAT_VERIFIED') showToast?.('Payment secured in escrow. The funds are released to you automatically.', 'success');
                  else showToast?.('Payment is still being verified by Timax.', 'info');
                } catch (e) { showToast?.(cleanWeb3Error(e), 'error'); }
                finally { setIsEscrowExecuting(false); setEscrowStatusMessage(''); }
              }} className="w-full py-4 rounded-xl font-bold bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white">Check Payment Status</button>
            : <button disabled={isEscrowExecuting} onClick={handleClientReleaseToMerchant} className="w-full py-4 rounded-xl font-bold bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white flex items-center justify-center gap-2"><CheckCircle2 size={18}/> Confirm Fiat Received</button>}
          <button disabled={isEscrowExecuting} onClick={()=>{ if (p2pOrder?.orderId) dismissedOrdersRef.current.add(p2pOrder.orderId); setP2pOrder(null);setSelectedOffer(null);setP2pAmountInput('');setClientBankDetails('');}} className="w-full py-3 text-xs font-bold text-slate-500 hover:text-slate-300">Close</button>
        </div>
      </div>
    );
  };

  const renderMerchantMode = () => (
    <div className="flex-1 overflow-y-auto p-4 custom-scrollbar flex flex-col gap-4">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-bold text-slate-200">Merchant Dashboard</h4>
          <button onClick={()=>setShowMerchantGuide(!showMerchantGuide)} className="text-[9px] px-2 py-0.5 rounded border border-slate-700 text-slate-400 hover:text-white hover:bg-slate-800">{showMerchantGuide?'Hide':'How it works'}</button>
        </div>
        {isMerchantVerified && (traderStatus.stripe?.verified || traderStatus.monerium?.verified) && <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded text-[10px] font-bold flex items-center gap-1"><CheckCircle2 size={10}/> Verified</span>}
      </div>

      {showMerchantGuide && (
        <div className="bg-[#1c1d22] border border-blue-500/30 rounded-xl p-4 animate-in fade-in">
          <p className="text-[10px] text-blue-400 font-bold uppercase tracking-wider mb-3">How to be a Merchant</p>
          <div className="grid grid-cols-2 gap-2">
            {[{n:'1. Choose',c:'text-blue-400',b:'Selling for crypto (USDC for EURe or EURC) needs no account. To be paid in bank money, connect a Stripe account with a bank account, or a verified Monerium account.'},{n:'2. Escrow',c:'text-blue-400',b:'Deposit USDC or USDT into the smart contract escrow.'},{n:'3. Earn',c:'text-emerald-400',b:'Buyers pay into escrow; the swap runs automatically and you are paid plus your spread.'},{n:'4. LP Yield',c:'text-purple-400',b:'Deposit idle USDC into Vaults to earn additional APY.'}].map(({n,c,b})=>(
              <div key={n} className="bg-[#0a0f1a] border border-slate-800 p-3 rounded-lg">
                <span className={`text-[10px] font-bold uppercase flex items-center gap-1 mb-1 ${c}`}>{n}</span>
                <span className="text-[10px] text-slate-500 leading-tight">{b}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {!merchantOpen && (
        <div className="bg-blue-900/20 border border-blue-500/50 rounded-xl p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2"><span className="text-[10px] text-slate-400">Chain</span><select value={p2pStellar?'stellar':p2pChain.id} onChange={e => { if (e.target.value==='stellar') setP2pStellar(true); else { setP2pStellar(false); setP2pChain(CHAINS.find(c=>c.id===e.target.value)); } }} className="bg-[#0a0f1a] border border-slate-700 rounded px-2 py-0.5 text-[10px] text-white outline-none">
                {CHAINS.filter(c => P2P_CHAIN_IDS.includes(c.id) && p2pEnabledChains.includes(c.id)).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}<option value="stellar">Stellar</option>
            </select></div>
          <div><h4 className="text-sm font-bold text-blue-400 flex items-center gap-1.5"><ShieldCheck size={16}/> {p2pHasSession() ? 'Connect a verified account to trade' : 'Sign in to open your Merchant tab'}</h4><p className="text-[11px] text-blue-200/70 mt-1">{p2pHasSession() ? 'Selling for crypto (for example USDC for EURe or EURC) needs no account, but it is not switched on for this chain. To sell here, connect a Stripe account with a bank account, or a verified Monerium account; this tab unlocks automatically when it is done. You can also pick another chain above.' : 'Sign in once with your wallet. Selling for crypto needs no Stripe or Monerium account; they are only needed to be paid in bank money.'}</p></div>
          {!p2pHasSession() && <div className="bg-slate-900/60 border border-slate-700 rounded-lg p-3 flex items-center justify-between gap-3"><p className="text-[11px] text-slate-300">Sign in once with your wallet so Timax can check what you can sell here. Nothing is sent or spent.</p><button onClick={async()=>{const ok=await refreshMerchantVerification({interactive:true});showToast?.(ok?'Verified - trader funding unlocked.':'Signed in. Finish any step below, then check again.',ok?'success':'info');}} className="shrink-0 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold py-2 px-4 rounded-lg">Sign in to check</button></div>}
          {p2pHasSession() && [
            { k:'stripe', title:'Stripe connected account', ok:traderStatus.stripe?.verified === true, why:({not_connected:'No Stripe connected account for this wallet yet.',onboarding_incomplete:'Finish your Stripe onboarding.',action_required:'Stripe needs more information from you.',verification_pending:'Stripe is still verifying your account - payouts are not enabled yet.',restricted:'Stripe has restricted this account. Check your Stripe dashboard.',transfers_not_active:'Transfers are not active on your Stripe account yet.',bank_lookup_failed:'Could not read your bank account from Stripe. Try again in a moment.',no_bank_account:'Add a bank account to your Stripe account.',stripe_unavailable:'Stripe could not be reached. Try again in a moment.'})[traderStatus.stripe?.reason] || 'Connect Stripe and a bank account to sell for bank payments.', done:`Ready · ${(traderStatus.stripe?.banks || []).map(b => `${b.bankName || 'Bank'} ••••${b.last4}`).join(', ') || 'bank connected'}`, btn:'Open Stripe (Business Treasury Hub)', go:handleStripeOnboarding },
            { k:'monerium', title:'Monerium (SEPA)', ok:traderStatus.monerium?.verified === true, why:traderStatus.monerium?.enforced === false ? 'Monerium checks are not enabled on the server yet.' : (({no_monerium_session:'Connect your Monerium account first.',monerium_session_expired:'Your Monerium session expired. Reconnect Monerium.',profile_not_approved:'Your Monerium profile is not approved yet. Finish verification.',upstream_error:'Monerium could not be reached. Try again in a moment.'})[traderStatus.monerium?.reason] || 'Open a Monerium account and finish verification to sell for SEPA payments.'), done:'Verified · you are paid in EURe in this wallet (redeem to your bank any time)', btn:'Open Monerium account / Verify', go:handleMoneriumOnboarding },
          ].map(c => (
            <div key={c.k} className={`rounded-lg p-3 border ${c.ok ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-slate-700 bg-[#0a0f1a]'}`}>
              <div className="flex items-center justify-between mb-1"><span className="text-xs font-bold text-white">{c.title}</span>{c.ok && <span className="text-[10px] font-bold text-emerald-400 flex items-center gap-1"><CheckCircle2 size={10}/> Ready</span>}</div>
              <p className={`text-[11px] ${c.ok ? 'text-slate-300' : 'text-amber-300'}`}>{c.ok ? c.done : c.why}</p>
              {!c.ok && <button onClick={c.go} disabled={isEscrowExecuting} className="w-full mt-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold py-2 px-5 rounded-lg flex items-center justify-center gap-2">{isEscrowExecuting?<Loader2 size={14} className="animate-spin"/>:<Landmark size={14}/>} {c.btn}</button>}
            </div>
          ))}
          {p2pHasSession() && <button onClick={async()=>{const ok=await refreshMerchantVerification({interactive:true});showToast?.(ok?'Verified - trader funding unlocked.':'Not verified yet. Finish onboarding, then check again.',ok?'success':'info');}} className="text-[11px] text-blue-300 hover:text-blue-200 underline self-start">I have completed verification - check status</button>}
        </div>
      )}

      {merchantOpen && (<>
        <div className="bg-[#1c1d22] border border-slate-800 rounded-xl p-4 space-y-3">
          <h4 className="text-xs font-bold text-white flex items-center gap-1.5"><ShieldCheck size={14} className="text-emerald-400"/> Connected accounts</h4>
          {!p2pHasSession() && <div className="flex items-center justify-between gap-3 rounded-lg p-3 border border-slate-700 bg-[#0a0f1a]"><p className="text-[10px] text-slate-400">You can lock USDC for crypto payment right now. You will be asked to sign in with your wallet when you place the order. Sign in now only to see your orders, or to check Stripe and Monerium for bank payments.</p><button onClick={async()=>{const ok=await refreshMerchantVerification({interactive:true});showToast?.(ok?'Signed in.':'Signed in. No bank account connected yet.','success');}} className="shrink-0 px-3 py-1.5 rounded-lg text-[10px] font-bold bg-blue-600 hover:bg-blue-500 text-white">Sign in</button></div>}
          {p2pHasSession() && !traderStatus.stripe?.verified && (
            <div className="rounded-lg p-3 border border-slate-700 bg-[#0a0f1a]">
              <div className="flex items-center justify-between mb-1"><span className="text-xs font-bold text-white">Stripe (bank payments)</span><span className="text-[10px] font-bold text-slate-400">Optional</span></div>
              <p className="text-[10px] text-slate-400 mb-2">Not needed to sell for crypto. Connect it to be paid in bank money.</p>
              <button onClick={handleStripeOnboarding} disabled={isEscrowExecuting} className="px-3 py-1.5 rounded-lg text-[10px] font-bold bg-blue-600 hover:bg-blue-500 text-white">Open Stripe (Business Treasury Hub)</button>
            </div>
          )}
          {p2pHasSession() && traderStatus.stripe?.verified && (
            <div className="rounded-lg p-3 border border-emerald-500/30 bg-emerald-500/5">
              <div className="flex items-center justify-between mb-1"><span className="text-xs font-bold text-white">Stripe</span><span className="text-[10px] font-bold text-emerald-400 flex items-center gap-1"><CheckCircle2 size={10}/> Verified · {STRIPE_STATUS_LABEL[traderStatus.stripe.status] || 'Ready'}</span></div>
              <p className="text-[10px] text-slate-400 mb-2">Account {traderStatus.stripe.accountId}{traderStatus.stripe.country ? ` · ${traderStatus.stripe.country}` : ''} · payouts {traderStatus.stripe.payoutsEnabled ? 'enabled' : 'pending'}</p>
              {(traderStatus.stripe.banks || []).map(b => (
                <div key={b.id || b.last4} className="flex items-center justify-between gap-2 text-[11px] text-slate-300 py-0.5">
                  <span className="flex items-center gap-1.5"><Landmark size={11} className="text-slate-500"/>{b.bankName || 'Bank account'} ••••{b.last4}</span>
                  <span className="text-slate-500 text-right">{[b.country, (b.currencies && b.currencies.length ? b.currencies : [b.currency]).filter(Boolean).map(c => String(c).toUpperCase()).join('/')].filter(Boolean).join(' · ')}{b.transfersEligible === false ? ' · not payout-ready' : ''}</span>
                </div>
              ))}
            </div>
          )}
          {traderStatus.monerium?.verified && (
            <div className="rounded-lg p-3 border border-emerald-500/30 bg-emerald-500/5">
              <div className="flex items-center justify-between mb-1"><span className="text-xs font-bold text-white">Monerium</span><span className="text-[10px] font-bold text-emerald-400 flex items-center gap-1"><CheckCircle2 size={10}/> Verified</span></div>
              <p className="text-[10px] text-slate-400 mb-1">You are paid in EURe in this wallet (redeem to your bank any time in Monerium).</p>
              {(traderStatus.monerium.ibans || []).map(i => <div key={i.iban} className="flex items-center justify-between text-[11px] text-slate-300 py-0.5"><span className="font-mono">{i.iban}</span>{i.chain && <span className="text-slate-500">{i.chain}</span>}</div>)}
            </div>
          )}
          {p2pHasSession() && !traderStatus.monerium?.verified && (() => {
            let hasSession = false; try { hasSession = !!(localStorage.getItem('monerium_session_id') && (localStorage.getItem('monerium_refresh_token') || localStorage.getItem('monerium_access_token'))); } catch {}
            const why = traderStatus.monerium?.enforced === false ? 'The server is not checking Monerium (MONERIUM_BACKEND_URL missing on the P2P service).' : (!hasSession ? 'This browser has no Monerium session. Open Monerium Banking from the IBAN tab and finish connecting, then re-check.' : (({no_monerium_session:'The server received no Monerium session. Reconnect Monerium.',monerium_session_expired:'Your Monerium session expired. Reconnect Monerium.',profile_not_approved:'Your Monerium profile is not approved yet.',upstream_error:'Monerium could not be reached. Try again in a moment.'})[traderStatus.monerium?.reason] || 'Monerium is not verified for this wallet yet.'));
            return (
              <div className="rounded-lg p-3 border border-amber-500/30 bg-amber-500/5">
                <div className="flex items-center justify-between mb-1"><span className="text-xs font-bold text-white">Monerium</span><span className="text-[10px] font-bold text-amber-400">Not available yet</span></div>
                <p className="text-[10px] text-slate-400 mb-2">{why}{traderStatus.monerium?.reason ? ` (${traderStatus.monerium.reason})` : ''}</p>
                <div className="flex gap-2"><button onClick={() => { refreshMerchantVerification(); showToast?.('Checking Monerium…', 'info'); }} className="px-3 py-1.5 rounded-lg text-[10px] font-bold bg-slate-700 hover:bg-slate-600 text-white">Re-check</button><button onClick={() => { onClose?.(); onOpenMonerium?.(); }} className="px-3 py-1.5 rounded-lg text-[10px] font-bold bg-blue-600 hover:bg-blue-500 text-white">Open Monerium</button></div>
              </div>
            );
          })()}
        </div>
      <div className={`bg-[#1c1d22] border border-slate-800 p-4 rounded-xl transition-opacity ${!merchantOpen?'opacity-50 grayscale-[50%]':''}`}>
        <div className="flex justify-between items-center mb-2">
          <p className="text-[10px] font-bold text-slate-500 uppercase flex items-center gap-1"><Store size={12}/> Trader Funding · Escrow Liquidity</p>
          <div className="flex items-center gap-2">
            <select value={p2pStellar?'stellar':p2pChain.id} onChange={e => { if (e.target.value==='stellar') setP2pStellar(true); else { setP2pStellar(false); setP2pChain(CHAINS.find(c=>c.id===e.target.value)); } }} className="bg-[#0a0f1a] border border-slate-700 rounded px-2 py-0.5 text-[10px] text-white outline-none">
                {CHAINS.filter(c => P2P_CHAIN_IDS.includes(c.id) && p2pEnabledChains.includes(c.id)).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}<option value="stellar">Stellar</option>
            </select>
            <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20 flex items-center gap-1"><Activity size={10}/> Active</span>
          </div>
        </div>
        <p className="text-2xl font-bold text-white">${Math.max(lockedLiquidity, myLockedFromOffers).toLocaleString()}</p>
        {myArtLocked && <p className="text-sm font-semibold text-emerald-300">Art shares locked: {myArtLocked}</p>}
        <p className="text-[10px] text-slate-500 mb-4">Locked in escrow · Idle in wallet: {idleUsdc===null?'…':idleUsdc.toLocaleString(undefined,{maximumFractionDigits:2})} {escrowDepositToken}</p>
        <div className="mb-3 space-y-2">
          <RailPicker rails={canSellRails.map(r => ({ id:r, label:P2P_RAIL_LABEL[r] || r }))} rail={activeRail} onRail={setMerchantRail} busy={isEscrowExecuting} />
          <p className="text-[10px] text-slate-400">{activeRail==='onchain' ? `Buyers pay in ${onchainPaySym(p2pChain.id)} from their own wallet on ${p2pChain.name}. It is held in the escrow contract together with your ${escrowDepositToken}, and the swap runs atomically in one transaction. Nothing held by Timax.` : activeRail==='sepa' ? `Buyers pay from ANY bank account by SEPA transfer straight to your own Monerium IBAN, with a reference that Timax shows them. Monerium mints the euros as EURe in this wallet, and your ${escrowDepositToken} is released to the buyer automatically once Monerium confirms it. Timax never holds the euros, and buyers need no account.` : activeRail==='stripe' ? `Buyers pay by bank payment (for example iDEAL or Bancontact) on a Stripe page, so it can not be charged back. The platform holds the money in escrow. When your ${escrowDepositToken} and their payment are both held, the swap runs automatically and Stripe pays out to ${(traderStatus.stripe?.banks || []).map(b => `${b.bankName || 'your bank'} ••••${b.last4}`).join(', ') || 'your bank'}.` : 'Buyers pay in EURe from their own Monerium account, and it is held in the escrow contract together with your ' + escrowDepositToken + '. When both are in place the swap runs automatically and you receive the euros as EURe in this wallet (redeem to your bank any time in Monerium).'}</p>
          <ReleaseCheckbox form={form} busy={isEscrowExecuting} />
        </div>
        {!ART_SYMS.includes(escrowDepositToken) && <MarketCheck asset={escrowDepositToken} fiat={sellCur} amount={escrowDepositAmount} premium={form.v.priceMode === 'spread' ? form.v.premium : null} />}
        {merchantOpen ? (
          <SellForm form={form} busy={isEscrowExecuting}
            tokens={(FX_TOKENS[p2pChain.id] || []).filter(t => (P2P_SELL_TOKENS[p2pChain.id] || ['USDC']).includes(t.symbol)).map(t => ({ value:t.symbol, label:t.symbol }))}
            token={escrowDepositToken} onToken={setEscrowDepositToken} amount={escrowDepositAmount} onAmount={setEscrowDepositAmount} symbol={escrowDepositToken}
            currencies={sellCurrencies.length ? sellCurrencies : ['eur']} currency={sellCur} onCurrency={setSellCurrency}
            marketText={ART_SYMS.includes(escrowDepositToken) ? (artPerShare(sellCur, escrowDepositToken) > 0 ? `Appraisal: 1 ${escrowDepositToken} = ${artPerShare(sellCur, escrowDepositToken).toFixed(4)} ${sellCur.toUpperCase()}. Only verified wallets can buy it.` : 'Appraisal unavailable') : (rateOf(sellCur) > 0 ? `Market: 1 ${sellCur.toUpperCase()} = ${rateOf(sellCur).toFixed(4)} USD` : 'Market rate unavailable')} marketOk={ART_SYMS.includes(escrowDepositToken) ? artPerShare(sellCur, escrowDepositToken) > 0 : rateOf(sellCur) > 0}
            quote={sellQuote} fiatDp={2} maxDev={maxDev} floorFiat={sellQuote.minNeeded > 0 ? Number(p2pRates?.rates?.[sellCur]?.minCharge || 0) : 0} partial={partialOn}
            tradeTimeNote="Trade time: how long a buyer has to pay after you approve (you cannot cancel a running trade before this time is up)" />
        ) : (
          <div className="flex gap-2 mb-2">
            <select disabled className="bg-[#0a0f1a] border border-slate-700 rounded-lg py-2 px-2 text-xs text-white outline-none opacity-50"><option>{escrowDepositToken}</option></select>
            <input type="number" placeholder="0.00" disabled className="flex-1 bg-[#0a0f1a] border border-slate-700 rounded-lg py-2.5 px-3 text-sm text-white outline-none opacity-50"/>
          </div>
        )}
        <button onClick={()=>merchantOpen?handleProvideLiquidity():handleMoneriumOnboarding()} disabled={isEscrowExecuting||(merchantOpen&&(!escrowDepositAmount||!sellQuote.ok||!sellQuote.minOk))} className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white py-3 rounded-lg text-xs font-bold flex items-center justify-center gap-1 mt-2">
          {merchantOpen?<><PlusCircle size={14}/> Lock {escrowDepositToken} in Escrow</>:<><Lock size={14}/> Verify to Provide Liquidity</>}
        </button>
      </div>

      <div className={`bg-[#1c1d22] border border-slate-800 p-4 rounded-xl transition-opacity ${!merchantOpen?'opacity-50 grayscale-[50%]':''}`}>
        <div className="flex justify-between items-center mb-2"><p className="text-[10px] font-bold text-slate-500 uppercase flex items-center gap-1"><ShieldCheck size={12}/> Invest Idle Funds · Vault LP (EURe/USDC)</p><span className="text-[10px] font-bold text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded border border-blue-500/20">22.4% APY</span></div>
        {p2pChain.id === '137' ? (
          <>
            <p className="text-2xl font-bold text-white mb-4">${vaultLiquidity.toLocaleString()}</p>
            <div className="flex gap-2">
              <div className="relative flex-1"><input type="number" placeholder="0.00" value={vaultDepositAmount} onChange={e=>setVaultDepositAmount(e.target.value)} disabled={!merchantOpen||isEscrowExecuting} className="w-full bg-[#0a0f1a] border border-slate-700 rounded-lg py-2.5 pl-3 pr-10 text-sm text-white outline-none focus:border-blue-500 disabled:opacity-50"/><span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-slate-500">USDC</span></div>
              <button onClick={()=>merchantOpen?handleVaultDeposit():handleMoneriumOnboarding()} disabled={isEscrowExecuting||(merchantOpen&&!vaultDepositAmount)} className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-4 rounded-lg text-xs font-bold flex items-center gap-1 shrink-0">{isMerchantVerified?<><ShieldCheck size={14}/> Provide LP</>:<><Lock size={14}/> Verify</>}</button>
            </div>
          </>
        ) : (
          <p className="text-xs text-slate-500 mt-2">Vault LP currently only available on Polygon.</p>
        )}
      </div>

      {isEscrowExecuting && <div className="flex items-center gap-2 text-[11px] text-slate-400 bg-[#1a1b1f] p-3 rounded-lg border border-slate-800"><Loader2 size={12} className="animate-spin text-blue-500"/> {escrowStatusMessage}</div>}

      <div className={`bg-[#1c1d22] border border-slate-800 p-4 rounded-xl transition-opacity ${!merchantOpen?'opacity-50 grayscale-[50%]':''}`}>
        <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3 flex items-center justify-between">Active P2P Orderbook <span className="bg-slate-800 text-slate-400 px-2 py-0.5 rounded text-[9px]">Live</span></h4>
        {merchantOpen && evmAddress && p2pHasSession() ? <><TradeAlerts account={evmAddress} signMessage={signForP2P} /><MerchantOrderbook signMessage={signForP2P} evmAddress={evmAddress} p2pFetch={p2pFetch} hasSession={p2pHasSession} reloadKey={ordersReload} busyId={orderActionId} onAction={handleOrderAction} sendTx={sendEscrowTx} showToast={showToast}/></> : (
          <div className="flex flex-col items-center justify-center py-8 text-center bg-[#0a0f1a] border border-slate-800 border-dashed rounded-lg"><Clock size={20} className="text-slate-500 mb-3"/><p className="text-sm font-bold text-slate-300 mb-1">No Active Trades</p></div>
        )}
      </div>

      {merchantOpen && evmAddress && p2pHasSession() && <MerchantApiKeys p2pFetch={p2pFetch} hasSession={p2pHasSession} showToast={showToast}/>}

      </>)}
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4" onClick={onClose}>
      <div className="relative w-full max-w-[440px] bg-[#131418] rounded-2xl border border-slate-800 shadow-2xl overflow-hidden flex flex-col max-h-[90vh] h-[800px]" onClick={e=>e.stopPropagation()}>
        <div className="flex-none flex items-center justify-between px-4 py-3 bg-[#1a1b1f] border-b border-slate-800 z-10">
          <div className="flex items-center gap-2"><Globe className="w-5 h-5 text-blue-500"/><span className="font-bold text-white">Global Exchange</span>
            <div className="hidden sm:flex items-center gap-1 bg-blue-500/10 border border-blue-500/20 px-1.5 py-0.5 rounded ml-2"><ShieldCheck className="w-3 h-3 text-blue-400"/><span className="text-[9px] font-medium text-blue-400 uppercase tracking-tight">FINMA · LI.FI · CCTP V2</span></div>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => setShowHistory(true)} className="p-2 hover:bg-slate-800 rounded-full text-slate-400 hover:text-white" title="Transaction History"><History className="w-4 h-4"/></button>
            <button onClick={onClose} className="p-2 hover:bg-slate-800 rounded-full text-slate-400 hover:text-white"><X className="w-5 h-5"/></button>
          </div>
        </div>
        <div className="flex-none bg-[#1a1b1f] border-b border-slate-800/50">
          <div className="flex gap-1.5 p-3 overflow-x-auto custom-scrollbar whitespace-nowrap">
            {[{id:'buy',label:'Buy'},{id:'sell',label:'Sell'},{id:'fx',label:'FX Exchange'},{id:'arbitrage',label:'Arbitrage'},{id:'gateway',label:'One Balance'},{id:'p2p_market',label:'P2P Market'},{id:'iban',label:'IBAN'},{id:'bridge',label:'Swap & Bridge'},{id:'merchant',label:'P2P Merchant'}].map(tab=>(
              <button key={tab.id} onClick={()=>{
                if (tab.id === 'bridge') {
                  onOpenBridge?.();
                } else {
                  setExchangeMode(tab.id);
                }
              }} className={`px-4 py-2 text-xs font-bold rounded-lg transition-all ${exchangeMode===tab.id?'bg-blue-600 text-white shadow-md':'bg-[#2c2d33] text-slate-400 hover:text-white border border-transparent hover:border-slate-700'}`}>{tab.label}</button>
            ))}
          </div>
        </div>
        {(exchangeMode==='buy'||exchangeMode==='sell') && renderMtPelerinIframe()}
        {exchangeMode==='p2p_market' && (p2pAll ? <AllChainsMarket sources={allChainSources} p2pFetch={p2pFetch} onPick={pickFromAllChains} chainSelect={allChainSelect} reloadKey={offersReload}/> : p2pStellar ? <div className="flex-1 flex flex-col min-h-0 overflow-y-auto custom-scrollbar">{renderStellarGuide('market')}<StellarP2P view="market" showToast={showToast} chainSelect={stellarChainSelect} p2pLogin={p2pLogin} onOpenMonerium={onOpenMonerium}/></div> : (p2pOrder?renderP2PActiveOrder():(selectedOffer?renderP2POfferDetail():renderP2POfferList())))}
        {exchangeMode==='merchant' && (p2pStellar ? <div className="flex-1 flex flex-col min-h-0 overflow-y-auto custom-scrollbar">{renderStellarGuide('merchant')}<MarketCheck standalone /><StellarP2P view="merchant" showToast={showToast} chainSelect={stellarChainSelect} p2pLogin={p2pLogin} onOpenMonerium={onOpenMonerium}/></div> : renderMerchantMode())}
        {exchangeMode==='iban'     && renderMoneriumIban()}
        {exchangeMode==='gateway' && (
          <GatewayTab
            apiBase={process.env.REACT_APP_API_BASE}
            evmAddress={evmAddress}
            sendTx={robustSendTx}
            waitForTx={waitForTx}
            signTypedData={(payload) => universalSignTypedData(payload)}
            switchChain={robustSwitchEVMChainForFx}
            showToast={showToast}
          />
        )}
        {exchangeMode==='arbitrage' && (
          <ArbitrageTab
            apiBase={process.env.REACT_APP_API_BASE}
            onOpenMonerium={onOpenMonerium}
            onOpenFx={(p) => { setFxPreset(p ? { ...p, nonce: Date.now() } : null); setExchangeMode('fx'); }}   /* swap steps run in the FX Exchange module, pre-filled */
            onOpenBridge={onOpenBridge ? (cfg) => onOpenBridge(cfg) : undefined}      /* transfer steps run in Swap & Bridge, pre-filled */
          />
        )}
        
        {/* Render History Overlay */}
        {showHistory && renderHistory()}

        {/* FX Exchange — shared modal, same component BridgeModal.jsx's $
            button opens. Deliberately NOT a separate reimplementation — see
            the deleted renderFxExchange() in git history for why. */}
        <FxExchangeModal
          isOpen={exchangeMode === 'fx'}
          preset={fxPreset}
          onClose={() => setExchangeMode('buy')}
          evmAddress={evmAddress}
          activeChainId={activeEvmChainId}
          onSwitchNetwork={(cid) => robustSwitchEVMChainForFx(cid || 137)}   /* the FX quote says which chain it runs on (Polygon, Base, Arc) */
          sendTx={(params) => robustSendTx(params, params.chainId || 137)}
          apiBase={process.env.REACT_APP_API_BASE}
          onOpenBridge={onOpenBridge ? (cfg) => onOpenBridge(cfg) : undefined}   /* Stellar tab: open Swap & Bridge pre-filled for the Base (CCTP) market route */
          onSuccess={({ txHash, fromCurrency, toCurrency, amount, chainId: fxChainId }) => {
            try {
              const existing = JSON.parse(localStorage.getItem('timax_tx_history') || '[]');
              existing.push({
                timestamp: Date.now(), type: 'FX Exchange', provider: Number(fxChainId) === 5042 ? 'Timax FX (Uniswap v4)' : 'Timax FX (0x)',
                from: `${amount} ${fromCurrency}`, to: toCurrency,
                status: 'Completed', hash: txHash,
                explorer: ({ 137:'https://polygonscan.com', 8453:'https://basescan.org' })[Number(fxChainId) || 137] ? `${({ 137:'https://polygonscan.com', 8453:'https://basescan.org' })[Number(fxChainId) || 137]}/tx/${txHash}` : '',   // Arc: no verified explorer URL on file, so none is invented
              });
              localStorage.setItem('timax_tx_history', JSON.stringify(existing));
            } catch {}
            showToast?.(`FX swap submitted: ${txHash}`, 'success');
          }}
        />
      </div>
    </div>
  );
}

const ORDER_STATUS_STYLE = {
  OPEN:'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  FIAT_VERIFIED:'bg-blue-500/10 text-blue-400 border-blue-500/20',
  RELEASED:'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  DISPUTED:'bg-red-500/10 text-red-400 border-red-500/20',
  CANCELLED:'bg-slate-800 text-slate-400 border-slate-700',
  REFUNDED:'bg-slate-800 text-slate-400 border-slate-700',
};

// Orders where this wallet is seller or buyer (all states), healed against the chain by the backend.
// API keys for merchant bots (server-side market making). The key is shown once; the bot signs with the merchant's own wallet.
function MerchantApiKeys({ p2pFetch, hasSession, showToast }) {
  const [open, setOpen]       = useState(false);
  const [keys, setKeys]       = useState([]);
  const [max, setMax]         = useState(5);
  const [label, setLabel]     = useState('');
  const [trade, setTrade]     = useState(true);
  const [fresh, setFresh]     = useState('');
  const [busy, setBusy]       = useState(false);
  const [err, setErr]         = useState('');
  const [hooks, setHooks]     = useState([]);
  const [hookUrl, setHookUrl] = useState('');
  const [hookSecret, setHookSecret] = useState('');
  const loadHooks = useCallback(async () => {
    try { const d = await readJson(await p2pFetch('/api/p2p/escrow/webhooks')); if (d.success) setHooks(d.webhooks || []); } catch { /* shown by the keys call */ }
  }, [p2pFetch]);
  const addHook = async () => {
    setBusy(true); setErr('');
    try {
      const d = await readJson(await p2pFetch('/api/p2p/escrow/webhooks', { method:'POST', body:JSON.stringify({ url: hookUrl.trim() }) }));
      if (!d.success) throw new Error(d.error || 'Could not add the webhook');
      setHookSecret(d.secret); setHookUrl(''); await loadHooks();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const delHook = async (id) => { setBusy(true); try { await p2pFetch(`/api/p2p/escrow/webhooks/${id}`, { method:'DELETE' }); await loadHooks(); } catch (e) { setErr(e.message); } finally { setBusy(false); } };
  const testHook = async (id) => {
    setBusy(true); setErr('');
    try { const d = await readJson(await p2pFetch(`/api/p2p/escrow/webhooks/${id}/test`, { method:'POST' })); showToast?.(d.delivered ? 'Test sent: your server answered OK' : `Test failed: ${d.error || `HTTP ${d.status}`}`, d.delivered ? 'success' : 'error'); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const load = useCallback(async () => {
    try {
      const d = await readJson(await p2pFetch('/api/p2p/keys'));
      if (!d.success) throw new Error(d.error || 'Could not load keys');
      setKeys(d.keys || []); if (d.maxKeys) setMax(d.maxKeys); setErr('');
    } catch (e) { setErr(e.message || 'Could not load keys'); }
  }, [p2pFetch]);
  useEffect(() => { if (open && hasSession()) { load(); loadHooks(); } }, [open, load, loadHooks, hasSession]);
  const create = async () => {
    setBusy(true); setErr('');
    try {
      const d = await readJson(await p2pFetch('/api/p2p/keys', { method:'POST', body:JSON.stringify({ label, scopes: trade ? ['read','trade'] : ['read'] }) }));
      if (!d.success) throw new Error(d.error || 'Could not create the key');
      setFresh(d.key); setLabel(''); await load();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const revoke = async (id) => {
    setBusy(true);
    try { const d = await readJson(await p2pFetch(`/api/p2p/keys/${id}`, { method:'DELETE' })); if (!d.success) throw new Error(d.error || 'Could not revoke'); await load(); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="bg-[#1c1d22] border border-slate-800 p-4 rounded-xl">
      <button onClick={()=>setOpen(o=>!o)} className="w-full flex items-center justify-between text-xs font-bold text-slate-500 uppercase tracking-wide"><span>Merchant API keys</span><span className="text-[10px] text-slate-400 normal-case">{open ? 'Hide' : 'For trading bots'}</span></button>
      {open && (
        <div className="mt-3 space-y-3">
          <p className="text-[10px] text-slate-400">Run a bot against the market with your own wallet. A key can read the market and ask for transactions to sign; it can never move your funds. Limits per key: 120 reads/min, 30 writes/min, 20,000 requests/day.</p>
          {fresh && (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 space-y-2">
              <p className="text-[10px] font-bold text-emerald-300">Copy your key now. It is shown only once.</p>
              <p className="font-mono text-[10px] text-white break-all">{fresh}</p>
              <div className="flex gap-2"><button onClick={()=>{ try { navigator.clipboard.writeText(fresh); showToast?.('API key copied', 'success'); } catch { /* clipboard blocked */ } }} className="px-3 py-1.5 rounded-lg text-[10px] font-bold bg-emerald-600 hover:bg-emerald-500 text-white flex items-center gap-1"><Copy size={10}/> Copy</button><button onClick={()=>setFresh('')} className="px-3 py-1.5 rounded-lg text-[10px] font-bold bg-slate-800 text-slate-300">I saved it</button></div>
            </div>
          )}
          {!hasSession() ? <p className="text-[10px] text-amber-300">Sign in (load your orders above) to manage keys.</p> : (
            <>
              {keys.map(k => (
                <div key={k.id} className="flex items-center justify-between gap-2 bg-[#0a0f1a] border border-slate-800 rounded-lg p-2">
                  <div className="min-w-0"><p className="text-xs font-bold text-white truncate">{k.label} <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">{k.scopes.includes('trade') ? 'trade' : 'read-only'}</span></p><p className="text-[10px] text-slate-500 font-mono truncate">…{k.id} · {k.lastUsedAt ? `used ${new Date(k.lastUsedAt).toLocaleString()}` : 'never used'}</p></div>
                  <button disabled={busy} onClick={()=>revoke(k.id)} className="px-2 py-1 rounded-lg text-[10px] font-bold border border-red-500/40 text-red-400 hover:bg-red-500/10 disabled:opacity-50">Revoke</button>
                </div>
              ))}
              {keys.length < max && (
                <div className="flex flex-wrap items-center gap-2">
                  <input value={label} onChange={e=>setLabel(e.target.value)} maxLength={40} placeholder="Label, e.g. market maker bot" className="flex-1 min-w-[140px] bg-[#131418] border border-slate-700 text-white text-xs px-2 py-1.5 rounded outline-none focus:border-blue-500"/>
                  <label className="flex items-center gap-1 text-[10px] text-slate-300"><input type="checkbox" checked={trade} onChange={e=>setTrade(e.target.checked)}/> can trade</label>
                  <button disabled={busy} onClick={create} className="px-3 py-1.5 rounded-lg text-[10px] font-bold bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white">{busy ? '…' : 'Create key'}</button>
                </div>
              )}
              <p className="text-[9px] text-slate-500">{keys.length} of {max} keys used.</p>
              <div className="pt-3 border-t border-slate-800 space-y-2">
                <p className="text-[10px] font-bold text-slate-400 uppercase">Webhooks</p>
                <p className="text-[10px] text-slate-500">Timax calls your https URL when one of your orders changes status (signed, retried). No more polling.</p>
                {hookSecret && (
                  <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 space-y-2">
                    <p className="text-[10px] font-bold text-emerald-300">Signing secret. Copy it now, it is shown only once.</p>
                    <p className="font-mono text-[10px] text-white break-all">{hookSecret}</p>
                    <div className="flex gap-2"><button onClick={()=>{ try { navigator.clipboard.writeText(hookSecret); showToast?.('Secret copied', 'success'); } catch { /* clipboard blocked */ } }} className="px-3 py-1.5 rounded-lg text-[10px] font-bold bg-emerald-600 hover:bg-emerald-500 text-white flex items-center gap-1"><Copy size={10}/> Copy</button><button onClick={()=>setHookSecret('')} className="px-3 py-1.5 rounded-lg text-[10px] font-bold bg-slate-800 text-slate-300">I saved it</button></div>
                  </div>
                )}
                {hooks.map(h => (
                  <div key={h.id} className="bg-[#0a0f1a] border border-slate-800 rounded-lg p-2 space-y-1">
                    <p className="text-[10px] font-mono text-white break-all">{h.url}</p>
                    <p className={`text-[10px] ${h.lastFailureAt && (!h.lastSuccessAt || h.lastFailureAt > h.lastSuccessAt) ? 'text-red-400' : 'text-slate-500'}`}>{h.lastFailureAt && (!h.lastSuccessAt || h.lastFailureAt > h.lastSuccessAt) ? `Last delivery failed: ${h.lastError || 'error'}` : h.lastSuccessAt ? `Last delivered ${new Date(h.lastSuccessAt).toLocaleString()}` : 'No deliveries yet'}</p>
                    <div className="flex gap-2"><button disabled={busy} onClick={()=>testHook(h.id)} className="px-2 py-1 rounded-lg text-[10px] font-bold bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white">Send test</button><button disabled={busy} onClick={()=>delHook(h.id)} className="px-2 py-1 rounded-lg text-[10px] font-bold border border-red-500/40 text-red-400 hover:bg-red-500/10 disabled:opacity-50">Delete</button></div>
                  </div>
                ))}
                {hooks.length < 3 && (
                  <div className="flex flex-wrap items-center gap-2">
                    <input value={hookUrl} onChange={e=>setHookUrl(e.target.value)} placeholder="https://your-server.com/timax-webhook" className="flex-1 min-w-[180px] bg-[#131418] border border-slate-700 text-white text-xs px-2 py-1.5 rounded outline-none focus:border-blue-500"/>
                    <button disabled={busy || !hookUrl.trim()} onClick={addHook} className="px-3 py-1.5 rounded-lg text-[10px] font-bold bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white">Add webhook</button>
                  </div>
                )}
              </div>
            </>
          )}
          {err && <p className="text-[10px] text-red-400">{err}</p>}
        </div>
      )}
    </div>
  );
}

const offerLeft = (o) => { try { const u = BigInt(String(o.remainingUnits ?? o.amountUnits ?? '0')); const d = Number(o.tokenDecimals || 6); return (Number(u) / 10 ** d).toLocaleString(undefined, { maximumFractionDigits: 6 }); } catch { return o.amount; } };

// Alerts for a trade (buyer or seller): the SAME alerts screen as Stock Earn / credit (email or Telegram, set up once per wallet).
const ALERTS_BASE = (() => { try { const u = new URL(String(UNISWAP_API_BASE || '')); return u.origin + u.pathname.replace(/\/api\/uniswap\/?$/i, '').replace(/\/$/, ''); } catch { return ''; } })();
// Every on-chain transaction of one trade, in order, with explorer links.
function TradeHistory({ orderId, p2pFetch, hasSession, reloadKey }) {
  const [open, setOpen] = useState(false);
  const [h, setH] = useState(null);
  useEffect(() => {
    if (!open || !orderId || !hasSession()) return undefined;
    let alive = true;
    (async () => { try { const r = await p2pFetch(`/api/p2p/escrow/${orderId}/history`); const d = await readJson(r); if (alive && r.ok && d.success) setH(d.history); } catch { /* not critical */ } })();
    return () => { alive = false; };
  }, [open, orderId, p2pFetch, hasSession, reloadKey]);
  const short = (x) => `${x.slice(0, 10)}...${x.slice(-6)}`;
  return (
    <div className="rounded-lg border border-slate-700 bg-black/20 p-2">
      <button onClick={() => setOpen(v => !v)} className="flex w-full items-center justify-between text-[11px] font-bold text-slate-200"><span>Transactions of this trade</span><span className="text-slate-500">{open ? 'Hide' : 'Show'}</span></button>
      {open && (
        <div className="mt-2 space-y-1">
          <button onClick={() => navigator.clipboard?.writeText(String(orderId))} title="Copy the order id" className="block w-full truncate text-left font-mono text-[9px] text-slate-500 hover:text-slate-300">Order id (tap to copy): {orderId}</button>
          {!h && <p className="text-[10px] text-slate-500">Loading...</p>}
          {h && h.items.length === 0 && <p className="text-[10px] text-slate-500">No transactions recorded yet.</p>}
          {h && h.items.map((x, i) => (
            <div key={x.hash} className="flex items-center justify-between gap-2 text-[10px]">
              <span className="min-w-0 text-slate-300">{i + 1}. {x.label}</span>
              {x.url ? <a href={x.url} target="_blank" rel="noopener noreferrer" className="shrink-0 font-mono text-blue-400 hover:underline">{short(x.hash)}</a>
                : <button onClick={() => navigator.clipboard?.writeText(x.hash)} title="Copy the transaction hash" className="shrink-0 font-mono text-blue-400 hover:underline">{short(x.hash)}</button>}
            </div>
          ))}
          {h && h.note && <p className="text-[10px] text-amber-300">{h.note}</p>}
          {h && !h.explorer && h.items.length > 0 && <p className="text-[9px] text-slate-500">Tap a hash to copy it and search it in the chain's explorer.</p>}
        </div>
      )}
    </div>
  );
}

// Per-trade chat between the buyer and the seller of one trade. No contact details are shared; the other side gets an alert (no text).
// "I have paid" + extra time (escrow V5.2). The buyer says he paid; in the last minutes he may ask the seller for more time; only the seller can give it (a wallet transaction).
function TradeTime({ orderId, role, p2pFetch, hasSession, showToast, sendTx, onSync }) {
  const [d, setD] = useState(null);          // { order, escrowV52, extWindowMinutes, extMinutes, maxExtensions }
  const [busy, setBusy] = useState('');
  const [now, setNow] = useState(Math.floor(Date.now() / 1000));
  const seen = useRef('');
  const load = useCallback(async () => {
    if (!orderId || !hasSession()) return;
    try { const r = await p2pFetch(`/api/p2p/escrow/${orderId}`); const j = await readJson(r); if (r.ok && j.success) setD(j); } catch { /* not critical */ }
  }, [orderId, p2pFetch, hasSession]);
  useEffect(() => { load(); const t = setInterval(load, 8000); const c = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 5000); return () => { clearInterval(t); clearInterval(c); }; }, [load]);
  const o = d?.order;
  useEffect(() => {
    if (!o || typeof onSync !== 'function') return;
    const sig = `${o.expiresAt}|${o.stripeCheckoutUrl || ''}`;
    if (seen.current && seen.current !== sig) onSync(o);
    seen.current = sig;
  }, [o, onSync]);
  if (!d || !d.escrowV52 || !o || !['PAYMENT_CREATED', 'PAYMENT_INITIATED', 'PAYMENT_DETECTED'].includes(o.status)) return null;
  const left = Number(o.expiresAt) - now; const ext = o.extension || {}; const used = Number(o.extensionsUsed || 0);
  const endAt = new Date(Number(o.expiresAt) * 1000).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
  const inWindow = left > 90 && left <= (d.extWindowMinutes || 15) * 60;
  const call = async (path, body, okMsg) => {
    setBusy(path);
    try { const r = await p2pFetch(`/api/p2p/escrow/${orderId}${path}`, { method:'POST', body:JSON.stringify(body || {}) }); const j = await readJson(r); if (!r.ok || !j.success) throw new Error(j.error || 'Not possible now.'); if (okMsg) showToast?.(okMsg, 'success'); await load(); return j; }
    catch (e) { showToast?.(cleanWeb3Error(e), 'error'); return null; } finally { setBusy(''); }
  };
  const approve = async () => {
    setBusy('approve');
    try {
      const r = await p2pFetch(`/api/p2p/escrow/${orderId}/extension/decide`, { method:'POST', body:JSON.stringify({ approve:true }) }); const j = await readJson(r);
      if (!r.ok || !j.success) throw new Error(j.error || 'Not possible now.');
      await sendTx(j.transaction);
      for (let i = 0; i < 6; i++) { const c = await p2pFetch(`/api/p2p/escrow/${orderId}/extension/confirm`, { method:'POST', body:'{}' }); const cj = await readJson(c); if (c.ok && cj.success) break; await new Promise(res => setTimeout(res, 2500)); }
      showToast?.('Done. The buyer has more time.', 'success'); await load();
    } catch (e) { showToast?.(cleanWeb3Error(e), 'error'); } finally { setBusy(''); }
  };
  if (role === 'buyer') {
    return (
      <div className="rounded-xl p-3 mb-4 text-[11px] border bg-slate-800/60 border-slate-700 text-slate-300 space-y-2">
        {!o.buyerMarkedPaidAt ? (<>
          <p><b className="text-white">Did you pay in your bank?</b> Tap the button after you sent the money. It tells the seller that your payment is on its way and lets you ask for more time if it is slow.</p>
          <button disabled={!!busy} onClick={() => call('/mark-paid', {}, 'The seller was told that you paid.')} className="w-full rounded-lg bg-emerald-600 py-2 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50">{busy ? '...' : 'I have paid'}</button>
        </>) : (<>
          <p><b className="text-emerald-300">You told us you paid.</b> The money is not confirmed yet. The trade ends at <b>{endAt}</b>. If the money is not confirmed by then, the trade is cancelled and your payment is returned to you.</p>
          {used > 0 && <p className="text-emerald-300">The seller gave you more time ({used}x). If you have not paid yet, tap "Get a payment page" again.</p>}
          {ext.status === 'PENDING' && <p className="text-amber-300">Waiting for the seller to answer your request for {ext.minutes} more minutes.</p>}
          {ext.status === 'DECLINED' && <p className="text-red-300">The seller declined more time.</p>}
          {ext.status !== 'PENDING' && used < (d.maxExtensions || 2) && inWindow && (<>
            <p className="font-bold text-amber-300">Your money has not arrived. Need more time? The seller must approve it.</p>
            <div className="flex gap-2">{(d.extMinutes || [30, 60, 120]).map(m => <button key={m} disabled={!!busy} onClick={() => call('/extension/request', { minutes:m }, 'Request sent to the seller.')} className="flex-1 rounded-lg bg-amber-500 py-2 text-xs font-bold text-black hover:bg-amber-400 disabled:opacity-50">+{m} min</button>)}</div>
          </>)}
        </>)}
      </div>
    );
  }
  if (!o.buyerMarkedPaidAt) return null;
  return (
    <div className="mb-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2 text-[11px] text-slate-300 space-y-2">
      <p><b className="text-amber-300">The buyer says the payment was sent.</b> It is not confirmed yet. Your USDC stays locked until {endAt}; if nothing is confirmed by then it comes back to you.</p>
      {ext.status === 'PENDING' && left > 30 && (<>
        <p className="font-bold text-white">The buyer asks for {ext.minutes} more minutes.</p>
        <div className="flex gap-2">
          <button disabled={!!busy} onClick={approve} className="flex-1 rounded-lg bg-emerald-600 py-2 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50">{busy === 'approve' ? '...' : `Approve +${ext.minutes} min`}</button>
          <button disabled={!!busy} onClick={() => call('/extension/decide', { approve:false }, 'Declined.')} className="flex-1 rounded-lg bg-slate-700 py-2 text-xs font-bold text-white hover:bg-slate-600 disabled:opacity-50">Decline</button>
        </div>
      </>)}
    </div>
  );
}

function TradeChat({ orderId, p2pFetch, hasSession, showToast, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const [msgs, setMsgs] = useState([]);
  const [closed, setClosed] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const endRef = useRef(null);
  const load = useCallback(async () => {
    try {
      const r = await p2pFetch(`/api/p2p/escrow/${orderId}/chat`); const d = await readJson(r);
      if (r.ok && d.success) { setMsgs(d.messages || []); setClosed(!!d.closed); }
    } catch { /* not critical */ }
  }, [orderId, p2pFetch]);
  useEffect(() => {
    if (!open || !orderId || !hasSession()) return undefined;
    load(); const id = setInterval(load, 8000);
    return () => clearInterval(id);
  }, [open, orderId, load, hasSession]);
  useEffect(() => { if (open) endRef.current?.scrollIntoView?.({ block:'nearest' }); }, [msgs.length, open]);
  const send = async () => {
    const t = text.trim(); if (!t || sending) return;
    setSending(true);
    try {
      const r = await p2pFetch(`/api/p2p/escrow/${orderId}/chat`, { method:'POST', headers:{ 'content-type':'application/json' }, body:JSON.stringify({ text:t }) });
      const d = await readJson(r);
      if (!r.ok || !d.success) throw new Error(d.error || `HTTP ${r.status}`);
      setMsgs(d.messages || []); setText('');
    } catch (e) { showToast?.(e.message || 'Message not sent', 'error'); }
    finally { setSending(false); }
  };
  return (
    <div className="rounded-lg border border-slate-700 bg-black/20 p-2">
      <button onClick={() => setOpen(v => !v)} className="flex w-full items-center justify-between text-[11px] font-bold text-slate-200">
        <span>Chat with the {`other side`}{msgs.length ? ` (${msgs.length})` : ''}</span><span className="text-slate-500">{open ? 'Hide' : 'Open'}</span>
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          <p className="text-[10px] text-amber-300/90">Never share seed phrases or passwords. Pay only through the payment page of this trade. The other side does not see your email or Telegram; they get an alert that you wrote.</p>
          <div className="max-h-48 space-y-1 overflow-y-auto custom-scrollbar">
            {msgs.length === 0 && <p className="text-[10px] text-slate-500">No messages yet.</p>}
            {msgs.map(m => (
              <div key={m.id} className={`flex ${m.mine ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] whitespace-pre-wrap break-words rounded-lg px-2 py-1 text-[11px] ${m.mine ? 'bg-blue-600/30 text-blue-100' : 'bg-slate-800 text-slate-200'}`}>
                  {m.text}<span className="ml-2 text-[9px] text-slate-500">{new Date(m.at).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' })}</span>
                </div>
              </div>
            ))}
            <div ref={endRef} />
          </div>
          {closed ? <p className="text-[10px] text-slate-500">This trade is closed, so the chat is closed.</p> : (
            <div className="flex gap-2">
              <input value={text} maxLength={500} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') send(); }} placeholder="Write a message" className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-[#0a0f1a] px-2 py-1.5 text-[11px] text-white outline-none focus:border-blue-500" />
              <button disabled={sending || !text.trim()} onClick={send} className="rounded-lg bg-blue-600 px-3 py-1.5 text-[11px] font-bold text-white disabled:opacity-40">Send</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TradeAlerts({ account, signMessage }) {
  const [open, setOpen] = useState(false);
  if (!ALERTS_BASE || !account) return null;
  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-slate-700 bg-slate-800/40 p-3 text-[11px] text-slate-300">
        <span>Get an email or Telegram alert when something happens in your trades.</span>
        <button onClick={() => setOpen(true)} className="shrink-0 rounded-lg bg-sky-600 px-3 py-1.5 font-bold text-white hover:bg-sky-500">Set up alerts</button>
      </div>
      {open && <AlertSettings account={account} base={ALERTS_BASE} signer={{ signMessage: ({ message }) => signMessage(message) }} onClose={() => setOpen(false)} />}
    </>
  );
}

function MerchantOrderbook({ evmAddress, p2pFetch, hasSession, reloadKey, busyId, onAction, sendTx, showToast, signMessage }) {
  const [orders, setOrders]   = useState([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded]   = useState(false);
  const [err, setErr]         = useState(null);
  const [editId, setEditId]   = useState('');
  const [form, setForm]       = useState({});
  const [saving, setSaving]   = useState('');
  const [showAllOrders, setShowAllOrders] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await p2pFetch('/api/p2p/escrow/mine');
      const data = await readJson(res);
      if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);
      setOrders((data.orders || []).filter(o => o.role === 'seller')); setErr(null); setLoaded(true);
    } catch (e) { setErr(e.message || 'Could not load orders.'); }
    finally { setLoading(false); }
  }, [p2pFetch]);
  useEffect(() => {
    if (!evmAddress || !hasSession()) return undefined;
    load();
    const id = setInterval(() => { if (hasSession()) load(); }, 30_000);
    return () => clearInterval(id);
  }, [evmAddress, load, hasSession, reloadKey]);

  // Seller settings are off-chain: no wallet transaction, the escrowed funds are not touched.
  const saveSettings = async (id, body, okMsg) => {
    setSaving(id);
    try {
      const res = await p2pFetch('/api/p2p/escrow/offer/settings', { method:'POST', body:JSON.stringify({ offerId:id, ...body }) });
      const d = await readJson(res);
      if (!res.ok || !d.success) throw new Error(d.error || 'Could not save.');
      showToast?.(okMsg || 'Saved.', 'success'); setEditId(''); await load();
    } catch (e) { showToast?.(e.message || 'Could not save.', 'error'); }
    finally { setSaving(''); }
  };
  const decide = async (id, approve) => {
    setSaving(id);
    try {
      let r = await p2pFetch('/api/p2p/escrow/request/decide', { method:'POST', body:JSON.stringify({ orderId:id, approve }) }); let d = await readJson(r);
      if (!r.ok || !d.success) throw new Error(d.error || 'Could not answer the request.');
      if (d.needSignature) {   // escrow V5: the approval is a signature the contract checks. No gas, no transaction.
        if (typeof signMessage !== 'function') throw new Error('Your wallet cannot sign here.');
        showToast?.(`Confirm in your wallet: approve ${d.summary?.amount} USDC for ${d.summary?.fiatAmount} ${String(d.summary?.fiatCurrency || '').toUpperCase()}. This is a signature, not a payment.`, 'info');
        const signature = await signMessage(d.message);
        r = await p2pFetch('/api/p2p/escrow/request/decide', { method:'POST', body:JSON.stringify({ orderId:id, approve:true, signature }) }); d = await readJson(r);
        if (!r.ok || !d.success) throw new Error(d.error || 'Could not save your approval.');
      }
      showToast?.(approve ? 'Approved. The buyer can now lock the trade and pay.' : 'Declined. Nothing was locked.', 'success'); await load();
    } catch (e) { showToast?.(e.message || 'Could not answer the request.', 'error'); }
    finally { setSaving(''); }
  };
  const copyLink = (o) => { try { navigator.clipboard.writeText(offerLinkUrl(o.id, o.shareToken)); showToast?.('Offer link copied.', 'success'); } catch { showToast?.(offerLinkUrl(o.id, o.shareToken), 'info'); } };
  const openEditor = (o) => { setEditId(o.id); setForm({ approvalMinutes:o.approvalMinutes || 30, terms:o.terms || '', autoReply:o.autoReply || '', minCompleted:o.conditions?.minCompleted || '', minAccountAgeDays:o.conditions?.minAccountAgeDays || '', maxOpenPerBuyer:o.conditions?.maxOpenPerBuyer || '', privateOffer:!!o.privateOffer }); };

  if (!loaded && !hasSession()) return <button onClick={load} disabled={loading} className="w-full py-3 rounded-lg text-xs font-bold bg-slate-800 hover:bg-slate-700 text-white flex items-center justify-center gap-2">{loading?<Loader2 size={14} className="animate-spin"/>:<RefreshCcw size={14}/>} Sign in to load my orders</button>;
  if (loading && !loaded) return <div className="flex justify-center py-6"><Loader2 size={18} className="animate-spin text-blue-500"/></div>;
  if (err && !loaded) return <div className="text-[10px] text-red-400 flex items-center gap-2 py-4 justify-center"><AlertTriangle size={12}/> {err} <button onClick={load} className="underline">Retry</button></div>;
  if (!orders.length) return <div className="flex flex-col items-center justify-center py-8 text-center bg-[#0a0f1a] border border-slate-800 border-dashed rounded-lg"><Clock size={20} className="text-slate-500 mb-3"/><p className="text-sm font-bold text-slate-300 mb-1">No Active Trades</p><p className="text-[10px] text-slate-500 max-w-[220px]">Your offers and client orders appear here.</p></div>;
  // Live trades always stay visible; finished ones (completed / cancelled / expired) show the latest 5, the rest behind a button.
  const isFinished = (st) => ['RELEASED', 'CANCELLED', 'EXPIRED', 'REFUNDED', 'RESOLVED'].includes(String(st || ''));
  const byNewest = (a, b) => String(b.createdAt || b.updatedAt || '').localeCompare(String(a.createdAt || a.updatedAt || ''));
  const liveOrders = orders.filter(o => !isFinished(o.status));
  const doneOrders = orders.filter(o => isFinished(o.status)).sort(byNewest);
  const hiddenCount = showAllOrders ? 0 : Math.max(0, doneOrders.length - 5);
  const visibleOrders = [...liveOrders, ...(showAllOrders ? doneOrders : doneOrders.slice(0, 5))];
  return (
    <div className="space-y-2">
      {visibleOrders.map(o => {
        const id = o.orderId || o.id;
        const st = o.status;
        const canConfirm = st === 'FIAT_VERIFIED' && !o.autoRelease;   // manual mode only
        const canVerify  = st === 'AWAITING_SELLER_LOCK';   // lock tx done but the offer was never published
        const canCancel  = (st === 'OPEN' || st === 'AWAITING_SELLER_LOCK' || (o.expired && ['ACCEPTED','PAYMENT_CREATED','PAYMENT_INITIATED','PAYMENT_DETECTED'].includes(st))) && !o.stripePaymentProcessing;
        const canDispute = ['PAYMENT_CREATED','PAYMENT_INITIATED','PAYMENT_DETECTED','FIAT_VERIFIED','FIAT_VERIFIED_PENDING_ONCHAIN','RELEASE_REQUESTED'].includes(st);
        const busy = !!busyId;
        const canTune = st === 'OPEN' && !o.offerId && !o.buyerAddress && !o.expired;   // a live public offer of mine
        return (
          <div key={id} className="bg-[#0a0f1a] border border-slate-800 p-3 rounded-lg space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-bold text-white truncate">{o.kind === 'offer' ? `${offerLeft(o)} of ${o.amount}` : o.amount} {sellSymOf(o)} → {o.fiatAmount} {String(o.fiatCurrency || '').toUpperCase()} <span className="ml-1 text-[9px] font-bold px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">{P2P_RAIL_SHORT[o.fiatRail] || 'SEPA'}</span></p>
                <p className="text-[10px] text-slate-500 truncate">{o.kind === 'offer' ? (st === 'OPEN' ? (o.expired ? 'Expired · not in the market. Withdraw to get your funds back.' : `Partial offer · ${o.minFill}–${o.maxFill || o.amount} per buyer`) : sellerTxt(o, st)) : (o.offerId ? `Part of an offer · ${(st === 'CANCELLED' && /never/i.test(o.note || '')) ? 'Never reserved on-chain - nothing moved, your USDC stayed in the offer' : sellerTxt(o, st)}` : sellerTxt(o, st))} · {String(id).slice(0,10)}…{o.expired && st === 'OPEN' ? ' · expired' : ''}</p>
              </div>
              <span className={`shrink-0 text-[9px] font-bold px-2 py-0.5 rounded border ${o.expired && st === 'OPEN' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' : (ORDER_STATUS_STYLE[st] || 'bg-amber-500/10 text-amber-400 border-amber-500/20')}`}>{o.expired && st === 'OPEN' ? 'EXPIRED' : String(st || '').replace(/_/g,' ')}</span>
            </div>
            {o.expired && st === 'OPEN' && (
              <div className="text-[10px] text-amber-200 bg-amber-500/5 border border-amber-500/20 rounded-lg p-2 space-y-0.5">
                <p className="font-bold">This {o.kind === 'offer' ? 'offer' : 'order'} has expired. What to do:</p>
                <p>1. Press <b>{o.kind === 'offer' ? 'Withdraw remaining' : 'Cancel & withdraw'}</b> - your {sellSymOf(o)} goes back to your wallet (you pay a small network fee).</p>
                <p>2. Lock again with a longer expiry (up to 24 hours) so buyers have time to find and fill it.</p>
              </div>
            )}
            {o.expired && ['ACCEPTED','PAYMENT_CREATED','PAYMENT_INITIATED','PAYMENT_DETECTED'].includes(st) && !o.stripePaymentProcessing && (
              <div className="text-[10px] text-amber-200 bg-amber-500/5 border border-amber-500/20 rounded-lg p-2 space-y-0.5">
                <p className="font-bold">A buyer started this trade but it ran out of time. What to do:</p>
                <p>1. First check that no payment has arrived for it (Stripe dashboard or your bank).</p>
                <p>2. No payment: press <b>Cancel &amp; withdraw</b> to get your {sellSymOf(o)} back.</p>
                <p>3. Payment received: do not cancel - open a dispute so it is settled correctly.</p>
              </div>
            )}
            {st === 'REQUESTED' && !o.requestExpired && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2 space-y-2">
                <p className="text-[10px] text-amber-200">A buyer asks for <b>{o.amount} {sellSymOf(o)}</b> for {o.fiatAmount} {String(o.fiatCurrency || '').toUpperCase()}. Nothing is locked until you approve. Answer before {o.requestExpiresAt ? new Date(Number(o.requestExpiresAt)).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' }) : 'it expires'}.</p>
                <div className="flex gap-2">
                  <button disabled={!!saving} onClick={() => decide(id, true)} className="flex-1 py-1.5 rounded-lg text-[11px] font-bold bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white">{saving === id ? '…' : 'Approve'}</button>
                  <button disabled={!!saving} onClick={() => decide(id, false)} className="flex-1 py-1.5 rounded-lg text-[11px] font-bold bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white">Decline</button>
                </div>
              </div>
            )}
            <TradeHistory orderId={id} p2pFetch={p2pFetch} hasSession={hasSession} reloadKey={st} />
            {o.kind !== 'offer' && o.buyerAddress && <TradeChat orderId={id} p2pFetch={p2pFetch} hasSession={hasSession} showToast={showToast} />}
            {(o.chargebackOpen || (st === 'DISPUTED' && o.stripeDisputeId)) && <p className="text-[10px] text-red-300">A payment dispute is open for this order. The payout is on hold until it is resolved.</p>}
            {o.stripePaymentProcessing && <p className="text-[10px] text-amber-300">The buyer's bank payment is processing and protected. You cannot cancel until it clears or fails.</p>}
            {st === 'FIAT_VERIFIED' && o.autoRelease && <p className="text-[10px] text-emerald-300">Payment secured in escrow. Releasing automatically…</p>}
            {canTune && (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  {o.paused && <span className="text-[9px] font-bold px-2 py-0.5 rounded border bg-amber-500/10 text-amber-400 border-amber-500/20">PAUSED</span>}
                  {o.privateOffer && <span className="text-[9px] font-bold px-2 py-0.5 rounded border bg-slate-800 text-slate-300 border-slate-700">PRIVATE</span>}
                  <button disabled={!!saving} onClick={()=>saveSettings(id, { paused:!o.paused }, o.paused ? 'Offer resumed.' : 'Offer paused. Buyers cannot start new trades.')} className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white">{saving===id ? '…' : (o.paused ? 'Resume' : 'Pause')}</button>
                  <button onClick={()=>copyLink(o)} className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-slate-800 hover:bg-slate-700 text-white">Copy link</button>
                  <button onClick={()=>editId===id ? setEditId('') : openEditor(o)} className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-slate-800 hover:bg-slate-700 text-white">{editId===id ? 'Close' : 'Edit terms'}</button>
                </div>
                {editId===id && (
                  <div className="space-y-2 rounded-lg border border-slate-800 p-2">
                    <div className="grid grid-cols-3 gap-2">
                      {[['Completed trades','minCompleted'],['Days on Timax','minAccountAgeDays'],['Max open trades','maxOpenPerBuyer']].map(([l,k]) => (
                        <label key={k} className="text-[9px] text-slate-500 uppercase">{l}<input type="number" min="0" step="1" value={form[k]} onChange={e=>setForm(f=>({...f,[k]:e.target.value}))} placeholder="0" className="mt-1 w-full bg-[#131418] border border-slate-700 text-white text-xs px-2 py-1 rounded outline-none focus:border-blue-500"/></label>
                      ))}
                    </div>
                    <label className="block text-[9px] text-slate-500 uppercase">Minutes a buyer has to lock and pay after you approve (10-120)<input type="number" min="10" max="120" step="5" value={form.approvalMinutes} onChange={e=>setForm(f=>({...f,approvalMinutes:e.target.value}))} className="mt-1 w-full bg-[#131418] border border-slate-700 text-white text-xs px-2 py-1.5 rounded outline-none"/></label>
                    <textarea value={form.terms} onChange={e=>setForm(f=>({...f,terms:e.target.value.slice(0,600)}))} rows={2} placeholder="Terms shown to buyers" className="w-full bg-[#131418] border border-slate-700 text-white text-xs px-2 py-1.5 rounded outline-none focus:border-blue-500"/>
                    <input value={form.autoReply} onChange={e=>setForm(f=>({...f,autoReply:e.target.value.slice(0,300)}))} placeholder="Auto-reply" className="w-full bg-[#131418] border border-slate-700 text-white text-xs px-2 py-1.5 rounded outline-none focus:border-blue-500"/>
                    <label className="flex items-center gap-2 text-[10px] text-slate-300"><input type="checkbox" checked={!!form.privateOffer} onChange={e=>setForm(f=>({...f,privateOffer:e.target.checked}))}/> Private (link only)</label>
                    <div className="flex gap-2">
                      <button disabled={!!saving} onClick={()=>saveSettings(id, { approvalMinutes:Number(form.approvalMinutes) || 30, terms:form.terms, autoReply:form.autoReply, privateOffer:!!form.privateOffer, conditions:{ minCompleted:Number(form.minCompleted)||0, minAccountAgeDays:Number(form.minAccountAgeDays)||0, maxOpenPerBuyer:Number(form.maxOpenPerBuyer)||0 } }, 'Offer updated.')} className="flex-1 py-1.5 rounded-lg text-[11px] font-bold bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white">{saving===id ? '…' : 'Save (no transaction)'}</button>
                      <button disabled={!!saving} onClick={()=>saveSettings(id, { rotateShareToken:true }, 'New link created. The old link no longer works.')} className="px-3 py-1.5 rounded-lg text-[10px] font-bold bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white">New link</button>
                    </div>
                    <p className="text-[10px] text-slate-500">Amount, per-buyer limits, price and expiry are locked on-chain and cannot be edited here. Withdraw and re-lock to change them.</p>
                  </div>
                )}
              </div>
            )}
            {o.kind !== 'offer' && ['stripe', 'sepa'].includes(o.fiatRail) && ['PAYMENT_CREATED', 'PAYMENT_INITIATED', 'PAYMENT_DETECTED'].includes(o.status) && <TradeTime role="seller" orderId={id} p2pFetch={p2pFetch} hasSession={hasSession} showToast={showToast} sendTx={sendTx} />}
            {(canConfirm || canVerify || canCancel || canDispute) && (
              <div className="flex gap-2">
                {canConfirm && <button disabled={busy} onClick={()=>onAction('confirm', id)} className="flex-1 py-2 rounded-lg text-[11px] font-bold bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white flex items-center justify-center gap-1">{busyId===id?<Loader2 size={12} className="animate-spin"/>:<CheckCircle2 size={12}/>} Confirm fiat received</button>}
                {canVerify && <button disabled={busy} onClick={()=>onAction('verify', id)} className="flex-1 py-2 rounded-lg text-[11px] font-bold bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white">{busyId===id?'…':'Verify lock'}</button>}
                {canCancel && <button disabled={busy} onClick={()=>onAction('cancel', id)} className="flex-1 py-2 rounded-lg text-[11px] font-bold bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white">{busyId===id?'…':(canVerify ? 'Discard' : (o.kind === 'offer' ? 'Withdraw remaining' : 'Cancel & withdraw'))}</button>}
                {canDispute && <button disabled={busy} onClick={()=>onAction('dispute', id)} className="py-2 px-3 rounded-lg text-[11px] font-bold border border-red-500/40 text-red-400 hover:bg-red-500/10 disabled:opacity-50">Dispute</button>}
              </div>
            )}
          </div>
        );
      })}
      {(hiddenCount > 0 || (showAllOrders && doneOrders.length > 5)) && (
        <button onClick={() => setShowAllOrders(v => !v)} className="w-full py-2 rounded-lg text-[11px] font-bold bg-slate-800 hover:bg-slate-700 text-slate-200">
          {showAllOrders ? 'Show only the last 5 finished trades' : `Show ${hiddenCount} older trade${hiddenCount === 1 ? '' : 's'}`}
        </button>
      )}
    </div>
  );
}
