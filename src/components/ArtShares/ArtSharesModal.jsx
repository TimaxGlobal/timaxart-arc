import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import ArtSharesCredit from './ArtSharesCredit.jsx';
import ArtSharesNotes from './ArtSharesNotes.jsx';
import { X, Palette, Loader2, ShieldCheck, AlertTriangle, CheckCircle2 } from 'lucide-react';
import {
  createPublicClient, http, fallback, parseAbi, parseUnits, formatUnits,
  encodeFunctionData, encodeAbiParameters, keccak256, concat, pad,
} from 'viem';

// Art Shares: buy fractional shares of a physical painting from the Uniswap v4 hook pools on Arc.
// Painting data (images, video, price, contract addresses) is read from /offer/paintings/<CODE>/painting.json,
// the same file the investor offer page uses, so there is one source of truth.
// Wallet: uses the app's own wallet plumbing (walletAddress, onSendTx, smartSwitchChain), same as TimaxMorphoFamilyModal.

const ARC_ID = 5042;
const ARC_RPCS = ['https://rpc.mainnet.arc.io', 'https://arc-rpc.publicnode.com', 'https://arc.gateway.tenderly.co'];
const FEE_DYNAMIC = 0x800000;
const TICK_SPACING = 60;

const ABI = {
  router: parseAbi(['function swapExactIn((address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) key, bool zeroForOne, uint256 amountIn, uint256 minOut, uint256 deadline) returns (uint256)']),
  hook: parseAbi(['function kyc(address) view returns (bool)', 'function currentFee(bytes32) view returns (uint24)']),
  pm: parseAbi(['function extsload(bytes32 slot) view returns (bytes32)']),
  erc20: parseAbi(['function balanceOf(address) view returns (uint256)', 'function allowance(address,address) view returns (uint256)', 'function approve(address,uint256) returns (bool)']),
  oracle: parseAbi(['function pricePerShare() view returns (uint256)', 'function isStale() view returns (bool)']),
};

// ---------- pure helpers ----------
export function sortPair(a, b) { return BigInt(a) < BigInt(b) ? [a, b] : [b, a]; }
export function makePoolKey(share, quote, hook) {
  const [c0, c1] = sortPair(share, quote);
  return { currency0: c0, currency1: c1, fee: FEE_DYNAMIC, tickSpacing: TICK_SPACING, hooks: hook };
}
export function makePoolId(k) {
  return keccak256(encodeAbiParameters(
    [{ type: 'address' }, { type: 'address' }, { type: 'uint24' }, { type: 'int24' }, { type: 'address' }],
    [k.currency0, k.currency1, k.fee, k.tickSpacing, k.hooks]));
}
export const slot0Slot = (id) => keccak256(concat([id, pad('0x06', { size: 32 })]));
export const sqrtFromSlot0 = (word) => BigInt(word) & ((1n << 160n) - 1n);
export function quotePerShare(sqrtP, shareIs0, quoteDecimals) {
  const r = Number(sqrtP) / 2 ** 96, ratio = r * r;
  const raw = shareIs0 ? ratio : 1 / ratio;
  return (raw * 1e18) / 10 ** quoteDecimals;
}
const num = (n, d = 2) => Number(n).toLocaleString('en-GB', { minimumFractionDigits: d, maximumFractionDigits: d });
const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '—');
const txHashOf = (r) => { const h = r?.hash || r?.transactionHash || r; return typeof h === 'string' && /^0x[0-9a-fA-F]{64}$/.test(h) ? h : null; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function friendly(e) {
  const m = e?.shortMessage || e?.reason || e?.message || String(e);
  if (/user rejected|denied|rejected the request|cancel/i.test(m)) return 'You cancelled the request in your wallet.';
  if (/NotAllowed|not allowed/i.test(m)) return 'The pool refused this swap. Your wallet may not be verified yet.';
  if (/ReceiverNotApproved/.test(m)) return 'This wallet is not approved to hold the shares.';
  if (/slippage|too little received/i.test(m)) return 'The price moved while you were buying. Try a smaller amount.';
  return m.length > 180 ? `${m.slice(0, 180)}…` : m;
}

export default function ArtSharesModal({ open = true, onClose, code = 'ART001', walletAddress, onSendTx, smartSwitchChain, onOpenCredit, assetBase = '/offer/paintings' }) {
  const wallet = typeof walletAddress === 'string' ? walletAddress.toLowerCase() : walletAddress;
  const [painting, setPainting] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [qi, setQi] = useState(0);
  const [quotes, setQuotes] = useState([]);
  const [forSale, setForSale] = useState(null);
  const [user, setUser] = useState({ kyc: null, bal: null, held: null });
  const [amount, setAmount] = useState('100');
  const [mediaIdx, setMediaIdx] = useState(0);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState({ kind: '', text: '' });

  const dep = painting?.deployment;
  const contracts = dep?.contracts;

  const client = useMemo(() => {
    const urls = [dep?.chain?.rpc, ...ARC_RPCS].filter((u, i, a) => u && a.indexOf(u) === i);
    return createPublicClient({
      chain: { id: ARC_ID, name: 'Arc', nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 }, rpcUrls: { default: { http: urls } } },
      transport: fallback(urls.map((u) => http(u, { timeout: 12000, retryCount: 1 }))),
    });
  }, [dep?.chain?.rpc]);

  // painting data
  useEffect(() => {
    if (!open) return undefined;
    let dead = false;
    (async () => {
      try {
        const r = await fetch(`${assetBase}/${code}/painting.json?ts=${Date.now() % 1e6}`, { cache: 'no-store' });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const p = JSON.parse((await r.text()).replace(/^﻿/, ''));
        const lc = (v) => (typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v) ? v.toLowerCase() : v);
        if (p.deployment) {
          p.deployment.contracts = Object.fromEntries(Object.entries(p.deployment.contracts || {}).map(([k, v]) => [k, lc(v)]));
          p.deployment.quotes = (p.deployment.quotes || []).map((x) => ({ ...x, address: lc(x.address), oracle: lc(x.oracle) }));
        }
        if (!dead) setPainting(p);
      } catch (e) { if (!dead) setLoadError(`The offer details could not be loaded (${e.message}).`); }
    })();
    return () => { dead = true; };
  }, [open, code, assetBase]);

  // live reads (pool price, fee, valuation, user)
  const refresh = useCallback(async () => {
    if (!contracts || !dep?.quotes?.length) return;
    const out = await Promise.all(dep.quotes.map(async (x) => {
      const q = { symbol: x.symbol, address: x.address, decimals: x.decimals, oracleAddr: x.oracle, marketId: x.marketId };
      try {
        const key = makePoolKey(contracts.share, x.address, contracts.hook);
        const id = makePoolId(key);
        q.key = key; q.shareIs0 = BigInt(contracts.share) < BigInt(x.address);
        const word = await client.readContract({ address: contracts.poolManager, abi: ABI.pm, functionName: 'extsload', args: [slot0Slot(id)] });
        const sq = sqrtFromSlot0(word);
        if (sq > 0n) {
          q.spot = quotePerShare(sq, q.shareIs0, x.decimals);
          q.fee = Number(await client.readContract({ address: contracts.hook, abi: ABI.hook, functionName: 'currentFee', args: [id] }));
        }
      } catch (e) { console.warn('[ArtShares] pool read', x.symbol, e?.message); }
      try {
        const v = await client.readContract({ address: x.oracle, abi: ABI.oracle, functionName: 'pricePerShare' });
        q.oracle = Number(formatUnits(v, x.decimals));
      } catch (e) { q.oracle = null; }
      return q;
    }));
    setQuotes(out);
    try { setForSale(Number(formatUnits(await client.readContract({ address: contracts.share, abi: ABI.erc20, functionName: 'balanceOf', args: [contracts.poolManager] }), 18))); } catch { /* keep */ }
    if (wallet) {
      try {
        const q = out[Math.min(qi, out.length - 1)];
        const [kyc, bal, held] = await Promise.all([
          client.readContract({ address: contracts.hook, abi: ABI.hook, functionName: 'kyc', args: [wallet] }),
          client.readContract({ address: q.address, abi: ABI.erc20, functionName: 'balanceOf', args: [wallet] }),
          client.readContract({ address: contracts.share, abi: ABI.erc20, functionName: 'balanceOf', args: [wallet] }),
        ]);
        setUser({ kyc, bal: Number(formatUnits(bal, q.decimals)), held: Number(formatUnits(held, 18)) });
      } catch (e) { console.warn('[ArtShares] user read', e?.message); }
    }
  }, [client, contracts, dep, wallet, qi]);

  useEffect(() => { if (open && painting) refresh(); }, [open, painting, refresh]);

  const q = quotes[Math.min(qi, quotes.length - 1)] || null;
  const sym = q?.symbol || dep?.quotes?.[qi]?.symbol || 'USDC';
  const a = parseFloat(amount);
  const fee = q?.fee != null ? q.fee / 1e6 : null;
  const est = q?.spot && a > 0 ? (a / q.spot) * (1 - (fee || 0)) : null;
  const media = useMemo(() => {
    if (!painting) return [];
    const base = `${assetBase}/${code}`;
    return [...(painting.video ? [{ video: `${base}/${painting.video}` }] : []), ...(painting.images || []).map((i) => ({ img: `${base}/${i}` }))];
  }, [painting, assetBase, code]);
  const cover = media.find((m) => m.img)?.img;
  const m0 = media[Math.min(mediaIdx, Math.max(media.length - 1, 0))];

  async function waitAllowance(token, owner, spender, need) {
    for (let i = 0; i < 40; i++) {
      const al = await client.readContract({ address: token, abi: ABI.erc20, functionName: 'allowance', args: [owner, spender] });
      if (al >= need) return;
      await sleep(1500);
    }
    throw new Error('The approval was not confirmed in time. Please try again.');
  }

  // one place that switches to Arc, sends through the app's wallet, and waits for the receipt (used by the credit panel)
  const sendTx = useCallback(async ({ to, data }) => {
    if (!walletAddress) throw new Error('Log in to your TimaxPay wallet first.');
    if (!onSendTx) throw new Error('Wallet transaction sender is not available.');
    try { if (smartSwitchChain) { await smartSwitchChain(ARC_ID); await sleep(500); } } catch (e) { console.warn('[ArtShares] chain switch:', e?.message); }
    const res = await onSendTx({ from: walletAddress, to, data, value: 0n, chainId: ARC_ID });
    const h = txHashOf(res);
    if (h) {
      const rc = await client.waitForTransactionReceipt({ hash: h, timeout: 90000 });
      if (rc?.status === 'reverted') throw new Error('The transaction was rejected on-chain (reverted).');
    } else await sleep(6000);
    return h;
  }, [walletAddress, onSendTx, smartSwitchChain, client]);

  async function buy() {
    setStatus({ kind: '', text: '' }); setBusy(true);
    try {
      if (!wallet) throw new Error('Log in to your TimaxPay wallet first.');
      if (!onSendTx) throw new Error('Wallet transaction sender is not available.');
      if (!q?.spot) throw new Error('The pool price is not available yet.');
      if (!(a > 0)) throw new Error('Enter an amount above zero.');
      const amountIn = parseUnits(a.toFixed(q.decimals), q.decimals);
      const minOut = parseUnits((est * 0.98).toFixed(8), 18);       // 2% slippage allowance
      try { if (smartSwitchChain) { await smartSwitchChain(ARC_ID); await sleep(500); } } catch (e) { console.warn('[ArtShares] chain switch:', e?.message); }

      const allowance = await client.readContract({ address: q.address, abi: ABI.erc20, functionName: 'allowance', args: [wallet, contracts.router] });
      if (allowance < amountIn) {
        setStatus({ kind: '', text: `Approve ${sym} in your wallet…` });
        await onSendTx({ from: walletAddress, to: q.address, data: encodeFunctionData({ abi: ABI.erc20, functionName: 'approve', args: [contracts.router, amountIn] }), value: 0n, chainId: ARC_ID });
        setStatus({ kind: '', text: 'Waiting for the approval…' });
        await waitAllowance(q.address, wallet, contracts.router, amountIn);
      }
      setStatus({ kind: '', text: 'Confirm the purchase in your wallet…' });
      const res = await onSendTx({
        from: walletAddress, to: contracts.router, value: 0n, chainId: ARC_ID,
        data: encodeFunctionData({ abi: ABI.router, functionName: 'swapExactIn', args: [q.key, !q.shareIs0, amountIn, minOut, BigInt(Math.floor(Date.now() / 1000) + 600)] }),
      });
      const h = txHashOf(res);
      setStatus({ kind: '', text: 'Waiting for the network…' });
      if (h) { const rc = await client.waitForTransactionReceipt({ hash: h, timeout: 90000 }); if (rc?.status === 'reverted') throw new Error('The purchase was rejected on-chain (reverted). Your funds were not spent.'); } else await sleep(6000);
      setStatus({ kind: 'good', text: 'Done. The shares are in your wallet.' });
      await refresh();
    } catch (e) { setStatus({ kind: 'err', text: friendly(e) }); } finally { setBusy(false); }
  }

  if (!open) return null;
  const canBuy = !busy && wallet && user.kyc && q?.spot && a > 0;

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-start justify-center overflow-y-auto bg-black/70 p-3 md:p-8" onClick={onClose}>
      <div className="relative w-full max-w-5xl rounded-2xl border border-slate-700 bg-slate-900 text-slate-100 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <button type="button" onClick={onClose} className="absolute right-4 top-4 rounded-full p-2 text-slate-400 hover:bg-slate-800 hover:text-white" aria-label="Close"><X size={20} /></button>

        {!painting ? (
          <div className="flex items-center justify-center gap-3 p-16 text-slate-400">
            {loadError ? <><AlertTriangle className="text-amber-400" /> {loadError}</> : <><Loader2 className="animate-spin" /> Loading the offer…</>}
          </div>
        ) : (
          <div className="p-5 md:p-8 space-y-8">
            <div className="grid gap-6 md:grid-cols-2">
              <div>
                <div className="overflow-hidden rounded-lg bg-black">
                  {m0?.video ? (
                    <video key={m0.video} src={m0.video} poster={cover} muted loop playsInline autoPlay controls preload="metadata" className="block w-full h-auto" />
                  ) : m0?.img ? (
                    <img src={m0.img} alt={painting.title} className="block w-full h-auto" />
                  ) : (<div className="flex aspect-[4/3] items-center justify-center text-sm text-slate-500">Image of the painting to be added</div>)}
                </div>
                {media.length > 1 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {media.map((m, i) => (
                      <button key={i} type="button" onClick={() => setMediaIdx(i)} aria-label={m.video ? 'Video' : `Image ${i + 1}`}
                        className={`relative h-12 w-16 overflow-hidden rounded border-2 ${i === mediaIdx ? 'border-amber-400' : 'border-transparent'}`}>
                        <img src={m.img || cover} alt="" className="h-full w-full object-cover" />
                        {m.video && <span className="absolute inset-0 flex items-center justify-center bg-black/40 text-white text-sm">▶</span>}
                      </button>
                    ))}
                  </div>
                )}
                <p className="mt-3 font-semibold">{painting.title} ({painting.code})</p>
                <p className="text-sm text-slate-400">{[painting.artist, painting.year, painting.medium].filter(Boolean).join(' · ')}</p>
              </div>

              <div className="space-y-4">
                <p className="text-xs uppercase tracking-widest text-amber-300 flex items-center gap-2"><Palette size={14} /> Art share offer</p>
                <h2 className="text-3xl font-bold text-white">{painting.title}</h2>
                <p className="text-slate-400">{painting.medium ? `${painting.medium}, valued` : 'Valued'} at £{num(painting.priceGbp, 0)} and split into {num(painting.shares, 0)} shares.</p>
                {painting.description && <p className="text-slate-300 text-sm">{painting.description}</p>}
                <div className="grid grid-cols-3 gap-3">
                  <Fact label="Appraised value" value={`£${num(painting.priceGbp, 0)}`} sub="independent valuation" />
                  <Fact label="Shares in total" value={num(painting.shares, 0)} sub={`£${num(painting.priceGbp / painting.shares)} each at valuation`} />
                  <Fact label="On offer now" value={forSale != null ? num(forSale, 0) : num(painting.offeredShares, 0)} sub={forSale != null ? 'left in the pools' : 'planned for sale'} />
                </div>
              </div>
            </div>

            {!dep ? (
              <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-200">This painting is not launched on-chain yet.</p>
            ) : (
              <div className="grid gap-6 md:grid-cols-3">
                <div className="space-y-4 rounded-xl border border-slate-700 bg-slate-800/50 p-5 md:col-span-2">
                  <div>
                    <h3 className="font-bold text-lg">Buy shares</h3>
                    <p className="text-sm text-slate-400">Pay in stablecoins from your TimaxPay wallet on Arc.</p>
                  </div>
                  <div className="inline-flex rounded-lg border border-slate-600 p-0.5">
                    {dep.quotes.map((x, i) => (
                      <button key={x.symbol} type="button" onClick={() => setQi(i)} className={`rounded-md px-4 py-1.5 text-sm font-medium ${i === qi ? 'bg-sky-700 text-white' : 'text-slate-300'}`}>{x.symbol}</button>
                    ))}
                  </div>
                  <Rows rows={[
                    ['Pool price', q?.spot ? `${num(q.spot, 4)} ${sym}` : '—'],
                    ['Valuation price', q?.oracle != null ? `${num(q.oracle, 4)} ${sym}` : '—'],
                    ['Swap fee now', fee != null ? `${num(fee * 100)}%` : '—'],
                  ]} />
                  <label className="block text-xs uppercase tracking-wide text-slate-400">You pay ({sym})
                    <input value={amount} onChange={(e) => setAmount(e.target.value.replace(',', '.'))} inputMode="decimal" className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-base text-white normal-case tracking-normal" />
                  </label>
                  <Rows rows={[
                    ['You receive about', est ? `${num(est, 2)} ${painting.code}` : '—'],
                    ['Share of painting', est ? `${num((est / painting.shares) * 100, 3)}%` : '—'],
                  ]} />
                  {!wallet ? (
                    <p className="text-sm text-slate-400">Log in to TimaxPay to see whether you are verified and to buy.</p>
                  ) : (
                    <Rows rows={[
                      ['Wallet', short(walletAddress)],
                      ['Verified', user.kyc == null ? '…' : user.kyc ? 'Verified' : 'Not verified'],
                      [`${sym} balance`, user.bal != null ? num(user.bal, 2) : '—'],
                      [`${painting.code} held`, user.held != null ? num(user.held, 2) : '—'],
                    ]} />
                  )}
                  {wallet && user.kyc === false && (
                    <p className="flex items-start gap-2 text-sm text-amber-300"><ShieldCheck size={16} className="mt-0.5 shrink-0" /> Your wallet is not verified for this offer yet. Contact support@timaxpay.com to be added.</p>
                  )}
                  <button type="button" onClick={buy} disabled={!canBuy} className="w-full rounded-lg bg-sky-700 py-3 font-semibold text-white disabled:opacity-40">
                    {busy ? <span className="inline-flex items-center gap-2"><Loader2 size={16} className="animate-spin" /> Working…</span> : 'Buy shares'}
                  </button>
                  {status.text && (
                    <p className={`flex items-start gap-2 text-sm ${status.kind === 'err' ? 'text-red-400' : status.kind === 'good' ? 'text-emerald-400' : 'text-slate-300'}`}>
                      {status.kind === 'good' && <CheckCircle2 size={16} className="mt-0.5 shrink-0" />}{status.text}
                    </p>
                  )}
                </div>

                <div className="space-y-4 rounded-xl border border-slate-700 bg-slate-800/50 p-5">
                  <div>
                    <h3 className="font-bold text-lg">Lend and borrow</h3>
                    <p className="text-sm text-slate-400">Post shares as collateral and borrow {dep.quotes.map((x) => x.symbol).join(' or ')}, or lend to those who do.</p>
                  </div>
                  <Rows rows={[
                    ['Max loan to value', `${num((dep.lltv || 0.385) * 100)}%`],
                    ['Valuation used', q?.oracle != null ? `${num(q.oracle, 4)} ${sym} / share` : '—'],
                  ]} />
                  <ArtSharesCredit key={sym} client={client} contracts={contracts} quote={dep.quotes.find((x) => x.symbol === sym) || dep.quotes[0]} wallet={wallet} send={sendTx} code={painting.code} onChanged={refresh} bonus={painting.lenderBonus?.[sym]} />
                  <p className="text-xs text-slate-400">Lending uses the independent valuation, never the pool price. A lower valuation applies at once; a higher one is limited to +10% a week.</p>
                  {typeof onOpenCredit === 'function' && (
                    <button type="button" onClick={() => onOpenCredit({ code, marketId: q?.marketId, symbol: sym })} className="w-full rounded-lg border border-sky-600 py-2 text-sky-300">Open full credit view</button>
                  )}
                </div>
              </div>
            )}

            {contracts?.note && <ArtSharesNotes client={client} contracts={contracts} quotes={dep.quotes} wallet={wallet} verified={user.kyc} send={sendTx} code={painting.code} onChanged={refresh} />}

            <div className="grid gap-6 text-sm text-slate-300 md:grid-cols-2">
              <div>
                <h3 className="mb-2 font-bold text-white">What backs the shares</h3>
                <ul className="list-disc space-y-1 pl-5">
                  <li>One painting, valued at £{num(painting.priceGbp, 0)} by {painting.valuer || 'a valuer to be confirmed'}.</li>
                  <li>Held by {painting.custodian || 'a custodian to be confirmed'}. Shares are claims on the painting through {painting.owner || 'the holding company (to be confirmed)'}.</li>
                  <li>Only verified wallets can hold or trade the shares.</li>
                </ul>
              </div>
              <div>
                <h3 className="mb-2 font-bold text-white">What can go wrong</h3>
                <ul className="list-disc space-y-1 pl-5">
                  <li>The painting can lose value, and the pool price can fall below the valuation.</li>
                  <li>Selling can be slow: only a small amount of liquidity sits in the pool.</li>
                  <li>Borrowing can end in liquidation if the valuation falls or you borrow close to the limit.</li>
                  <li>Losing access to a verified wallet can lock your position.</li>
                  <li>These are new smart contracts without a long track record.</li>
                </ul>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

function Fact({ label, value, sub }) {
  return (<div><p className="text-[10px] uppercase tracking-widest text-slate-400">{label}</p><p className="font-mono text-xl text-white">{value}</p><p className="text-xs text-slate-400">{sub}</p></div>);
}
function Rows({ rows }) {
  return (<div className="space-y-1.5 rounded-lg border border-dashed border-slate-600 p-3 text-sm">{rows.map(([k, v]) => (<div key={k} className="flex justify-between gap-3"><span className="text-slate-400">{k}</span><span className="text-right text-slate-100">{v}</span></div>))}</div>);
}
