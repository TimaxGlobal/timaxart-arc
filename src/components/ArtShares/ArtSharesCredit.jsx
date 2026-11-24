import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, AlertTriangle } from 'lucide-react';
import { encodeFunctionData, formatUnits, parseAbi, parseUnits } from 'viem';

// Direct Morpho Blue credit for the art share: lend USDC/EURC, or post shares as collateral and borrow.
// Same direct-Morpho pattern as TimaxMorphoFamilyModal (supply / supplyCollateral / borrow / repay), NOT the Managed account:
// the share token only allows verified wallets and Morpho itself, so a managed-account contract could not receive the shares.
const MORPHO_ABI = parseAbi([
  'function idToMarketParams(bytes32 id) view returns (address loanToken, address collateralToken, address oracle, address irm, uint256 lltv)',
  'function market(bytes32 id) view returns (uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee)',
  'function position(bytes32 id, address user) view returns (uint256 supplyShares, uint128 borrowShares, uint128 collateral)',
  'function supply((address loanToken,address collateralToken,address oracle,address irm,uint256 lltv) marketParams,uint256 assets,uint256 shares,address onBehalf,bytes data) returns (uint256,uint256)',
  'function withdraw((address loanToken,address collateralToken,address oracle,address irm,uint256 lltv) marketParams,uint256 assets,uint256 shares,address onBehalf,address receiver) returns (uint256,uint256)',
  'function supplyCollateral((address loanToken,address collateralToken,address oracle,address irm,uint256 lltv) marketParams,uint256 assets,address onBehalf,bytes data)',
  'function withdrawCollateral((address loanToken,address collateralToken,address oracle,address irm,uint256 lltv) marketParams,uint256 assets,address onBehalf,address receiver)',
  'function borrow((address loanToken,address collateralToken,address oracle,address irm,uint256 lltv) marketParams,uint256 assets,uint256 shares,address onBehalf,address receiver) returns (uint256,uint256)',
  'function repay((address loanToken,address collateralToken,address oracle,address irm,uint256 lltv) marketParams,uint256 assets,uint256 shares,address onBehalf,bytes data) returns (uint256,uint256)',
]);
const IRM_ABI = parseAbi(['function borrowRateView((address loanToken,address collateralToken,address oracle,address irm,uint256 lltv) marketParams,(uint128 totalSupplyAssets,uint128 totalSupplyShares,uint128 totalBorrowAssets,uint128 totalBorrowShares,uint128 lastUpdate,uint128 fee) market) view returns (uint256)']);
const ORACLE_ABI = parseAbi(['function price() view returns (uint256)']);
const ERC20 = parseAbi(['function balanceOf(address) view returns (uint256)', 'function allowance(address,address) view returns (uint256)', 'function approve(address,uint256) returns (bool)']);
const E36 = 10n ** 36n;
const E18 = 10n ** 18n;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmt = (raw, dec, dp = 4) => { try { return Number(formatUnits(BigInt(raw), dec)).toLocaleString('en-GB', { maximumFractionDigits: dp }); } catch { return '—'; } };
const exact = (raw, dec) => formatUnits(BigInt(raw), dec);

function nice(e) {
  const m = e?.shortMessage || e?.reason || e?.message || String(e);
  if (/user rejected|denied|rejected the request|cancel/i.test(m)) return 'You cancelled the request in your wallet.';
  if (/ReceiverNotApproved/.test(m)) return 'This wallet is not approved to hold the shares.';
  if (/insufficient liquidity|InsufficientLiquidity/i.test(m)) return 'The market does not have enough free liquidity for this right now.';
  if (/insufficient collateral|InsufficientCollateral/i.test(m)) return 'Not enough collateral for that loan. Borrow less or add shares.';
  return m.length > 180 ? `${m.slice(0, 180)}…` : m;
}

export default function ArtSharesCredit({ client, contracts, quote, wallet, send, code, onChanged, bonus }) {
  const [tab, setTab] = useState('lend');
  const [a1, setA1] = useState('');   // lend amount | collateral shares
  const [a2, setA2] = useState('');   // borrow / repay amount
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({ kind: '', text: '' });
  const [loadErr, setLoadErr] = useState('');
  const loanDec = quote?.decimals ?? 6;
  const sym = quote?.symbol || 'USDC';
  const marketId = quote?.marketId;

  const load = useCallback(async () => {
    if (!marketId || !contracts?.morpho) return;
    try {
      setLoadErr('');
      const morpho = contracts.morpho;
      const p = await client.readContract({ address: morpho, abi: MORPHO_ABI, functionName: 'idToMarketParams', args: [marketId] });
      const params = { loanToken: p[0], collateralToken: p[1], oracle: p[2], irm: p[3], lltv: p[4] };
      const mk = await client.readContract({ address: morpho, abi: MORPHO_ABI, functionName: 'market', args: [marketId] });
      const m = { totalSupplyAssets: mk[0], totalSupplyShares: mk[1], totalBorrowAssets: mk[2], totalBorrowShares: mk[3], lastUpdate: mk[4], fee: mk[5] };
      let price = null, borrowApy = null;
      try { price = await client.readContract({ address: params.oracle, abi: ORACLE_ABI, functionName: 'price' }); } catch { /* oracle unreadable */ }
      try {
        const rate = Number(await client.readContract({ address: params.irm, abi: IRM_ABI, functionName: 'borrowRateView', args: [params, m] })) / 1e18;
        borrowApy = Math.exp(rate * 31536000) - 1;
      } catch { /* rate unavailable */ }
      const util = m.totalSupplyAssets > 0n ? Number(m.totalBorrowAssets) / Number(m.totalSupplyAssets) : 0;
      const out = { params, m, price, borrowApy, util, supplyApy: borrowApy == null ? null : borrowApy * util * (1 - Number(m.fee) / 1e18), free: m.totalSupplyAssets > m.totalBorrowAssets ? m.totalSupplyAssets - m.totalBorrowAssets : 0n };
      if (wallet) {
        const [pos, walletLoan, walletShare] = await Promise.all([
          client.readContract({ address: morpho, abi: MORPHO_ABI, functionName: 'position', args: [marketId, wallet] }),
          client.readContract({ address: params.loanToken, abi: ERC20, functionName: 'balanceOf', args: [wallet] }),
          client.readContract({ address: params.collateralToken, abi: ERC20, functionName: 'balanceOf', args: [wallet] }),
        ]);
        const supplyShares = pos[0], borrowShares = pos[1], collateral = pos[2];
        out.supplyShares = supplyShares; out.borrowShares = borrowShares; out.collateral = collateral;
        out.supplied = (supplyShares * (m.totalSupplyAssets + 1n)) / (m.totalSupplyShares + 1000000n);
        out.debt = borrowShares === 0n ? 0n : (borrowShares * (m.totalBorrowAssets + 1n) + (m.totalBorrowShares + 1000000n) - 1n) / (m.totalBorrowShares + 1000000n);
        out.walletLoan = walletLoan; out.walletShare = walletShare;
        if (price && collateral > 0n) {
          const collValue = (collateral * price) / E36;
          out.maxBorrow = (collValue * params.lltv) / E18;
          out.hf = out.debt > 0n ? Number(out.maxBorrow) / Number(out.debt) : null;
        } else { out.maxBorrow = 0n; out.hf = null; }
      }
      setInfo(out);
    } catch (e) { setLoadErr('Could not read the credit market right now.'); console.warn('[ArtShares credit]', e?.message); }
  }, [client, contracts, marketId, wallet]);

  useEffect(() => { setInfo(null); load(); }, [load]);

  async function ensureAllowance(token, need, label) {
    const al = await client.readContract({ address: token, abi: ERC20, functionName: 'allowance', args: [wallet, contracts.morpho] });
    if (al >= need) return;
    setMsg({ kind: '', text: `Approve ${label} in your wallet…` });
    await send({ to: token, data: encodeFunctionData({ abi: ERC20, functionName: 'approve', args: [contracts.morpho, need] }) });
    for (let i = 0; i < 40; i++) {
      if ((await client.readContract({ address: token, abi: ERC20, functionName: 'allowance', args: [wallet, contracts.morpho] })) >= need) return;
      await sleep(1500);
    }
    throw new Error('The approval was not confirmed in time. Please try again.');
  }
  const call = (functionName, args) => send({ to: contracts.morpho, data: encodeFunctionData({ abi: MORPHO_ABI, functionName, args }) });

  async function run(label, fn) {
    setBusy(true); setMsg({ kind: '', text: '' });
    try { if (!wallet) throw new Error('Log in to your TimaxPay wallet first.'); await fn(); setMsg({ kind: 'good', text: `${label} confirmed.` }); setA1(''); setA2(''); await load(); onChanged?.(); }
    catch (e) { setMsg({ kind: 'err', text: nice(e) }); } finally { setBusy(false); }
  }
  const raw = (t, d) => { try { return t.trim() ? parseUnits(t.trim(), d) : 0n; } catch { return 0n; } };
  const P = info?.params;

  const lend = () => run('Supply', async () => {
    const v = raw(a1, loanDec); if (v <= 0n) throw new Error('Enter an amount above zero.');
    await ensureAllowance(P.loanToken, v, sym);
    setMsg({ kind: '', text: 'Confirm the supply in your wallet…' });
    await call('supply', [P, v, 0n, wallet, '0x']);
  });
  const unlend = () => run('Withdraw', async () => {
    const v = raw(a1, loanDec); if (v <= 0n) throw new Error('Enter an amount above zero.');
    const all = info.supplyShares > 0n && v >= info.supplied;
    await call('withdraw', all ? [P, 0n, info.supplyShares, wallet, wallet] : [P, v, 0n, wallet, wallet]);
  });
  const borrow = () => run('Borrow', async () => {
    const col = raw(a1, 18), loan = raw(a2, loanDec);
    if (loan <= 0n) throw new Error('Enter the amount to borrow.');
    if (col <= 0n && !(info.collateral > 0n)) throw new Error('Enter how many shares to post as collateral.');
    if (col > 0n) {
      await ensureAllowance(P.collateralToken, col, code);
      setMsg({ kind: '', text: 'Confirm posting the shares in your wallet…' });
      await call('supplyCollateral', [P, col, wallet, '0x']);
    }
    setMsg({ kind: '', text: 'Confirm the loan in your wallet…' });
    await call('borrow', [P, loan, 0n, wallet, wallet]);
  });
  const repay = (all) => run('Repay', async () => {
    if (all) {
      if (info.borrowShares <= 0n) throw new Error('There is no debt to repay.');
      if (info.walletLoan < info.debt) throw new Error(`You need about ${exact(info.debt, loanDec)} ${sym} in your wallet to repay everything.`);
      await ensureAllowance(P.loanToken, info.debt + info.debt / 100n + 10n, sym);
      setMsg({ kind: '', text: 'Confirm the repayment in your wallet…' });
      await call('repay', [P, 0n, info.borrowShares, wallet, '0x']);
    } else {
      const v = raw(a2, loanDec); if (v <= 0n) throw new Error('Enter the amount to repay.');
      await ensureAllowance(P.loanToken, v, sym);
      setMsg({ kind: '', text: 'Confirm the repayment in your wallet…' });
      await call('repay', [P, v, 0n, wallet, '0x']);
    }
  });
  const takeBack = () => run('Withdraw shares', async () => {
    const v = raw(a1, 18); if (v <= 0n) throw new Error('Enter how many shares to withdraw.');
    await call('withdrawCollateral', [P, v, wallet, wallet]);
  });

  const typedBorrow = raw(a2, loanDec), typedCol = raw(a1, 18);
  const after = (() => {
    if (!info?.price || tab !== 'borrow') return null;
    const coll = (info.collateral || 0n) + typedCol, debt = (info.debt || 0n) + typedBorrow;
    if (coll <= 0n || typedBorrow <= 0n) return null;
    const max = (((coll * info.price) / E36) * P.lltv) / E18;
    return { hf: Number(max) / Number(debt), maxBorrow: max };
  })();
  const safeMax = info?.price ? (() => { const coll = (info.collateral || 0n) + typedCol; const max = (((coll * info.price) / E36) * P.lltv) / E18; const t = (max * 80n) / 100n; let v = t > (info.debt || 0n) ? t - info.debt : 0n; if (v > info.free) v = info.free; return v; })() : 0n;
  const pct = (v) => (v == null ? '—' : `${(v * 100).toFixed(2)}%`);
  const chip = 'rounded-md bg-slate-700 px-2 py-1 text-[11px] font-semibold text-slate-100 disabled:opacity-40';
  const input = 'w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white';

  return (
    <div className="space-y-3">
      <div className="inline-flex rounded-lg border border-slate-600 p-0.5 text-sm">
        {[['lend', 'Lend'], ['borrow', 'Borrow']].map(([id, l]) => (
          <button key={id} type="button" onClick={() => { setTab(id); setA1(''); setA2(''); setMsg({ kind: '', text: '' }); }} className={`rounded-md px-4 py-1 font-medium ${tab === id ? 'bg-sky-700 text-white' : 'text-slate-300'}`}>{l} {id === 'lend' ? sym : ''}</button>
        ))}
      </div>
      {loadErr && <p className="text-xs text-amber-300">{loadErr}</p>}
      {!info && !loadErr && <p className="flex items-center gap-2 text-xs text-slate-400"><Loader2 size={14} className="animate-spin" /> Reading the market…</p>}
      {info && (
        <>
          <div className="space-y-1 rounded-lg border border-dashed border-slate-600 p-3 text-xs">
            {[['Supply rate', pct(info.supplyApy)], ...(bonus && bonus.aprPct > 0 ? [['Bonus from TimaxArt', `+${Number(bonus.aprPct).toFixed(2)}%`], ['Total for lenders', pct((info.supplyApy || 0) + bonus.aprPct / 100)]] : []), ['Borrow rate', pct(info.borrowApy)], ['Utilisation', pct(info.util)], ['Free to borrow', `${fmt(info.free, loanDec, 2)} ${sym}`]].map(([k, v]) => (
              <div key={k} className="flex justify-between"><span className="text-slate-400">{k}</span><span>{v}</span></div>
            ))}
          </div>
          {wallet && (
            <div className="space-y-1 rounded-lg border border-dashed border-slate-600 p-3 text-xs">
              {(tab === 'lend'
                ? [['You supplied', `${fmt(info.supplied, loanDec)} ${sym}`], [`${sym} in wallet`, fmt(info.walletLoan, loanDec, 2)]]
                : [['Shares posted', `${fmt(info.collateral, 18, 4)} ${code}`], ['Borrowed', `${fmt(info.debt, loanDec)} ${sym}`], ['Safety ratio', info.hf == null ? (info.debt > 0n ? '—' : 'No debt') : `${info.hf.toFixed(2)}x`], [`${code} in wallet`, fmt(info.walletShare, 18, 4)]]
              ).map(([k, v]) => (<div key={k} className="flex justify-between"><span className="text-slate-400">{k}</span><span>{v}</span></div>))}
            </div>
          )}

          {tab === 'lend' ? (
            <>
              <input value={a1} onChange={(e) => setA1(e.target.value.replace(',', '.'))} placeholder={`${sym} amount`} inputMode="decimal" className={input} />
              <div className="flex flex-wrap gap-2">
                <button type="button" className={chip} disabled={busy || !(info.walletLoan > 0n)} onClick={() => setA1(exact(info.walletLoan, loanDec))}>Max supply</button>
                <button type="button" className={chip} disabled={busy || !(info.supplied > 0n)} onClick={() => setA1(exact(info.supplied < info.free ? info.supplied : info.free, loanDec))}>Max withdraw</button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={lend} disabled={busy || !a1} className="rounded-lg bg-emerald-600 py-2 text-sm font-semibold text-white disabled:opacity-40">Supply</button>
                <button type="button" onClick={unlend} disabled={busy || !a1} className="rounded-lg border border-slate-600 py-2 text-sm font-semibold disabled:opacity-40">Withdraw</button>
              </div>
              <p className="text-[11px] text-slate-400">{bonus && bonus.aprPct > 0 && <>TimaxArt adds a bonus of {Number(bonus.aprPct).toFixed(2)}% a year on the {sym} you supply{bonus.until ? `, until ${bonus.until}` : ''}. It is paid by TimaxArt every so often, not by the market, and it can be changed or ended. </>}You lend {sym} to people who post {code} shares as collateral. Rates are variable. You can withdraw only what is not currently borrowed, and a loan that is liquidated at a loss can cost lenders money.</p>
            </>
          ) : (
            <>
              {info.free === 0n && <p className="flex items-start gap-2 text-[11px] text-amber-300"><AlertTriangle size={14} className="mt-0.5 shrink-0" /> Nobody has lent {sym} to this market yet, so there is nothing to borrow. Lenders can start on the Lend tab.</p>}
              <label className="block text-[11px] text-slate-400">{code} shares to post as collateral
                <input value={a1} onChange={(e) => setA1(e.target.value.replace(',', '.'))} placeholder={`${code} shares`} inputMode="decimal" className={`${input} mt-1`} />
              </label>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={chip} disabled={busy || !(info.walletShare > 0n)} onClick={() => setA1(exact(info.walletShare, 18))}>Max in wallet</button>
                <button type="button" className={chip} disabled={busy || !(info.collateral > 0n)} onClick={() => setA1(exact(info.debt > 0n ? 0n : info.collateral, 18))}>Max withdraw</button>
              </div>
              <label className="block text-[11px] text-slate-400">{sym} to borrow or repay
                <input value={a2} onChange={(e) => setA2(e.target.value.replace(',', '.'))} placeholder={`${sym} amount`} inputMode="decimal" className={`${input} mt-1`} />
              </label>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={chip} disabled={busy || safeMax === 0n} onClick={() => setA2(exact(safeMax, loanDec))}>Max borrow (safe)</button>
                <button type="button" className={chip} disabled={busy || !(info.debt > 0n)} onClick={() => setA2(exact(info.debt < info.walletLoan ? info.debt : info.walletLoan, loanDec))}>Max repay</button>
              </div>
              {after && (
                <p className={`text-[11px] ${after.hf < 1.15 ? 'text-red-400' : after.hf < 1.5 ? 'text-amber-300' : 'text-emerald-300'}`}>
                  After this: borrowed {fmt((info.debt || 0n) + typedBorrow, loanDec)} {sym}, safety ratio {after.hf.toFixed(2)}x{after.hf < 1.05 ? '. Too risky: this would be liquidated almost at once.' : after.hf < 1.5 ? '. Low buffer: a small fall in the valuation could liquidate you.' : '.'}
                </p>
              )}
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={borrow} disabled={busy || !a2 || (after && after.hf < 1.05)} className="rounded-lg bg-amber-600 py-2 text-sm font-semibold text-white disabled:opacity-40">Open / increase</button>
                <button type="button" onClick={() => repay(false)} disabled={busy || !a2} className="rounded-lg border border-slate-600 py-2 text-sm font-semibold disabled:opacity-40">Repay</button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => repay(true)} disabled={busy || !(info.debt > 0n)} className="rounded-lg border border-emerald-600/60 py-2 text-xs font-semibold text-emerald-300 disabled:opacity-40">Repay all debt</button>
                <button type="button" onClick={takeBack} disabled={busy || !a1} className="rounded-lg border border-slate-600 py-2 text-xs font-semibold disabled:opacity-40">Withdraw shares</button>
              </div>
              <p className="text-[11px] text-slate-400">The loan is limited to {pct(Number(P.lltv) / 1e18)} of the independent valuation, never the pool price. If the valuation falls or you borrow close to the limit, your shares can be sold to repay the loan.</p>
            </>
          )}
          {msg.text && <p className={`text-xs ${msg.kind === 'err' ? 'text-red-400' : msg.kind === 'good' ? 'text-emerald-400' : 'text-slate-300'}`}>{msg.text}</p>}
        </>
      )}
    </div>
  );
}
