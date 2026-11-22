#!/usr/bin/env node
// EPC management dashboard builder. Node >= 18, no dependencies.
// Usage: node build_dashboard.mjs --data <dir> --out <dir>   |   --demo --out <dir>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : undefined; };
const here = path.dirname(fileURLToPath(import.meta.url));
const demo = args.includes('--demo');
const dataDir = demo ? path.join(here, '..', 'assets', 'sample_data') : opt('data');
const outDir = opt('out') || process.cwd();
if (!dataDir) { console.error('Usage: --data <dir> --out <dir>  (or --demo)'); process.exit(1); }

// ---------- CSV ----------
function parseCSV(text) {
  const rows = []; let row = [], f = '', q = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); f = ''; if (row.some(x => x.trim() !== '')) rows.push(row); row = []; }
    else f += c;
  }
  row.push(f); if (row.some(x => x.trim() !== '')) rows.push(row);
  const head = rows.shift().map(h => h.trim());
  return rows.map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
}
const readCSV = (n) => { const p = path.join(dataDir, n); return fs.existsSync(p) ? parseCSV(fs.readFileSync(p, 'utf8')) : null; };
const num = (v) => { const n = parseFloat(String(v ?? '').replace(/,/g, '')); return Number.isFinite(n) ? n : 0; };
const div = (a, b) => (b ? a / b : null);

// ---------- load ----------
const warnings = [], skipped = [];
const warn = (sev, msg, owner = 'PA') => warnings.push({ sev, msg, owner });
const projRows = readCSV('project.csv'), jc = readCSV('job_cost.csv');
if (!projRows || !jc) { console.error('project.csv and job_cost.csv are required in ' + dataDir); process.exit(1); }
const P = Object.fromEntries(projRows.map(r => [r.key, r.value]));
{ // hard input validation: refuse to produce a misleading dashboard
  const missing = ['project_name', 'currency', 'status_date', 'original_contract_value', 'billed_to_date'].filter(k => !P[k]);
  const cols = ['cost_code', 'original_budget', 'actual_to_date', 'etc'].filter(c => !jc.length || !(c in jc[0]));
  if (missing.length || cols.length || !jc.length || !(num(P.original_contract_value) > 0)) {
    console.error(`Invalid input in ${dataDir}: ` + [missing.length && `project.csv missing/empty keys: ${missing.join(', ')}`, cols.length && `job_cost.csv missing columns/rows: ${cols.join(', ') || 'no data rows'}`, !(num(P.original_contract_value) > 0) && 'original_contract_value must be > 0'].filter(Boolean).join(' | '));
    process.exit(2);
  }
}
const sov = readCSV('sov.csv'), trend = readCSV('trend.csv'), cos = readCSV('change_orders.csv');
if (!sov) skipped.push('SOV (sov.csv missing)');
if (!trend) skipped.push('S-curve / trend (trend.csv missing)');
if (!cos) skipped.push('Change order log (change_orders.csv missing)');

// ---------- job cost ----------
const lines = jc.map(r => {
  const l = {
    code: r.cost_code, desc: r.description, cat: r.category || 'Other',
    orig: num(r.original_budget), chg: num(r.approved_changes), committed: num(r.committed),
    actual: num(r.actual_to_date), etc: num(r.etc), prog: num(r.progress_pct), plan: num(r.planned_pct),
  };
  l.budget = l.orig + l.chg;
  l.open = Math.max(l.committed - l.actual, 0);
  l.eac = l.actual + l.etc;
  l.var = l.budget - l.eac;
  l.spent = div(l.actual, l.budget);
  l.ev = l.budget * Math.min(Math.max(l.prog, 0), 100) / 100; // clamped; out-of-range is warned below
  l.pv = l.budget * Math.min(Math.max(l.plan, 0), 100) / 100;
  if (l.actual > l.committed + 1) warn('amber', `Code ${l.code}: actual (${l.actual}) exceeds committed (${l.committed}) — uncommitted spend / missing PO.`);
  if (l.etc < 0) warn('red', `Code ${l.code}: negative ETC.`);
  if (l.etc + 1 < l.open) warn('amber', `Code ${l.code}: ETC (${l.etc}) is below open commitment (${l.open}).`, 'PM');
  if (l.prog < 0 || l.prog > 100 || l.plan < 0 || l.plan > 100) warn('red', `Code ${l.code}: progress/planned % outside 0–100.`);
  return l;
});
const sum = (a, k) => a.reduce((s, x) => s + (typeof k === 'function' ? k(x) : x[k]), 0);
const T = {
  orig: sum(lines, 'orig'), chg: sum(lines, 'chg'), budget: sum(lines, 'budget'), committed: sum(lines, 'committed'),
  open: sum(lines, 'open'), actual: sum(lines, 'actual'), etc: sum(lines, 'etc'), eac: sum(lines, 'eac'),
  ev: sum(lines, 'ev'), pv: sum(lines, 'pv'),
};
T.var = T.budget - T.eac;
const cats = [...new Set(lines.map(l => l.cat))].map(c => {
  const ls = lines.filter(l => l.cat === c);
  const o = { cat: c, budget: sum(ls, 'budget'), committed: sum(ls, 'committed'), actual: sum(ls, 'actual'), etc: sum(ls, 'etc'), eac: sum(ls, 'eac'), ev: sum(ls, 'ev'), pv: sum(ls, 'pv') };
  o.var = o.budget - o.eac; o.cpi = div(o.ev, o.actual); o.spi = div(o.ev, o.pv); return o;
});

// ---------- contract / WIP ----------
const cur = P.currency || '';
const origCV = num(P.original_contract_value), apprCO = num(P.approved_change_orders), pendCO = num(P.pending_change_orders);
const RCV = origCV + apprCO, ret = num(P.retainage_pct) / 100;
const billed = num(P.billed_to_date), cashIn = num(P.cash_received), paid = num(P.cost_paid);
const poc = Math.min(div(T.actual, T.eac) ?? 0, 1);
const earned = poc * RCV;
const overUnder = billed - earned;
const estGP = RCV - T.eac, estGPpct = div(estGP, RCV);
const lossTotal = Math.max(T.eac - RCV, 0);
const gpToDate = earned - T.actual;
const W = { RCV, poc, earned, billed, overUnder, gpToDate, backlog: RCV - earned, estGP, estGPpct, loss: lossTotal };
if (Math.abs(T.budget - RCV) / RCV > 0.15) warn('amber', `Revised budget (${T.budget}) differs from revised contract value (${RCV}) by >15% — confirm scope/budget basis.`, 'PM');
if (lossTotal > 0) warn('red', `Loss contract: EAC exceeds revised contract value by ${lossTotal}. Full anticipated loss must be recognized now.`, 'PA');

// ---------- EVM ----------
const BAC = T.budget, AC = T.actual, EV = T.ev, PV = T.pv;
const CPI = div(EV, AC), SPI = div(EV, PV);
const E = {
  BAC, PV, EV, AC, CV: EV - AC, SV: EV - PV, CPI, SPI,
  TCPI_BAC: div(BAC - EV, BAC - AC), TCPI_EAC: div(BAC - EV, T.eac - AC),
  eac1: CPI ? BAC / CPI : null, eac2: AC + (BAC - EV), eac3: CPI && SPI ? AC + (BAC - EV) / (CPI * SPI) : null, eac4: T.eac,
  VAC: BAC - T.eac, pctComplete: div(EV, BAC), pctSpent: div(AC, BAC),
};
if (E.eac1 && (E.eac1 - E.eac4) / BAC > 0.03) warn('amber', `Bottom-up EAC (${Math.round(E.eac4)}) is ${(100 * (E.eac1 - E.eac4) / BAC).toFixed(1)}% of BAC below CPI-based EAC (${Math.round(E.eac1)}) — forecast may be optimistic.`, 'PM');
if (CPI != null && CPI < 0.95) warn('red', `CPI ${CPI.toFixed(2)} < 0.95.`, 'PM'); else if (CPI != null && CPI < 1) warn('amber', `CPI ${CPI.toFixed(2)} below 1.00.`, 'PM');
if (SPI != null && SPI < 0.95) warn('red', `SPI ${SPI.toFixed(2)} < 0.95.`, 'PM'); else if (SPI != null && SPI < 1) warn('amber', `SPI ${SPI.toFixed(2)} below 1.00.`, 'PM');
if (E.TCPI_BAC != null && E.TCPI_BAC > 1.1) warn('red', `TCPI(BAC) ${E.TCPI_BAC.toFixed(2)} > 1.10 — returning to budget is unrealistic.`, 'PM');
else if (E.TCPI_BAC != null && E.TCPI_BAC > 1.05) warn('amber', `TCPI(BAC) ${E.TCPI_BAC.toFixed(2)} > 1.05.`, 'PM');
const ouPct = overUnder / RCV;
if (Math.abs(ouPct) > 0.10) warn('red', `${overUnder > 0 ? 'Overbilling' : 'Underbilling'} is ${(100 * Math.abs(ouPct)).toFixed(1)}% of contract value.`);
else if (Math.abs(ouPct) > 0.05) warn('amber', `${overUnder > 0 ? 'Overbilling' : 'Underbilling'} is ${(100 * Math.abs(ouPct)).toFixed(1)}% of contract value.`);
const cont = lines.find(l => /conting/i.test(l.cat));
if (cont && cont.budget > 0) {
  const burned = 1 - cont.etc / cont.budget;
  if (burned * 100 - E.pctComplete * 100 > 15) warn('red', `Contingency burned ${(100 * burned).toFixed(0)}% vs ${(100 * E.pctComplete).toFixed(0)}% complete.`, 'PM');
}
// margin fade
const marginPct = estGPpct, priorM = P.prior_margin_pct !== undefined ? num(P.prior_margin_pct) / 100 : null;
const fade = priorM != null && marginPct != null ? marginPct - priorM : null;
if (fade != null && fade < -0.02) warn('red', `Margin fade ${(100 * fade).toFixed(1)} pts vs prior month.`, 'PM');
else if (fade != null && fade < -0.01) warn('amber', `Margin fade ${(100 * fade).toFixed(1)} pts vs prior month.`, 'PM');

// ---------- SOV ----------
let S = null;
if (sov) {
  const rows = sov.map(r => {
    const x = { item: r.item, desc: r.description, sv: num(r.scheduled_value), prev: num(r.previous_billed), cur: num(r.this_period), stored: num(r.stored_materials), phys: r.physical_pct === '' || r.physical_pct === undefined ? null : num(r.physical_pct) };
    x.total = x.prev + x.cur + x.stored; x.pct = div(x.total, x.sv); x.bal = x.sv - x.total; x.ret = x.total * ret;
    if (x.phys != null && (x.pct * 100 - x.phys) > 20) warn('red', `SOV item ${x.item}: billed ${(100 * x.pct).toFixed(0)}% vs physical ${x.phys}% (front-loading).`);
    else if (x.phys != null && (x.pct * 100 - x.phys) > 10) warn('amber', `SOV item ${x.item}: billed ${(100 * x.pct).toFixed(0)}% vs physical ${x.phys}% (front-loading).`);
    return x;
  });
  const svTot = sum(rows, 'sv');
  if (Math.abs(svTot - RCV) > 1) warn('amber', `Σ SOV (${svTot}) ≠ revised contract value (${RCV}).`);
  const tot = sum(rows, 'total'), prev = sum(rows, 'prev');
  S = { rows, sv: svTot, prev, cur: sum(rows, 'cur'), stored: sum(rows, 'stored'), total: tot, retainage: tot * ret, earnedLessRet: tot * (1 - ret), due: tot * (1 - ret) - prev * (1 - ret) };
  if (Math.abs(tot - billed) > 1) warn('amber', `SOV total completed (${tot}) ≠ billed_to_date in project.csv (${billed}).`);
}

// ---------- COs ----------
let C = null;
if (cos) {
  const r = cos.map(x => ({ ...x, revenue: num(x.revenue), cost: num(x.cost) }));
  const by = (s) => r.filter(x => x.status.toLowerCase() === s);
  const unappr = by('unapproved-work');
  C = { rows: r, approvedRev: sum(by('approved'), 'revenue'), pendingRev: sum(by('pending'), 'revenue'), unapprovedCost: sum(unappr, 'cost') };
  if (C.unapprovedCost / RCV > 0.03) warn('red', `Unapproved-work cost ${C.unapprovedCost} > 3% of contract value.`, 'PM');
  else if (C.unapprovedCost / RCV > 0.01) warn('amber', `Unapproved-work cost ${C.unapprovedCost} > 1% of contract value.`, 'PM');
  const sd = new Date(P.status_date || Date.now());
  for (const x of by('pending')) { const d = (sd - new Date(x.submitted_date)) / 864e5; if (d > 60) warn('red', `${x.co_no} pending ${Math.round(d)} days.`, 'PM'); else if (d > 30) warn('amber', `${x.co_no} pending ${Math.round(d)} days.`, 'PM'); }
  if (Math.abs(C.approvedRev - apprCO) > 1) warn('amber', `Approved COs in log (${C.approvedRev}) ≠ approved_change_orders in project.csv (${apprCO}).`);
}

// ---------- cash ----------
const retHeld = billed * ret;
const K = { billed, retHeld, cashIn, netRecv: billed - retHeld - cashIn, paid, payables: T.actual - paid, netCash: cashIn - paid };

// ---------- output ----------
const metrics = { project: P, warnings, skipped, jobCost: { totals: T, categories: cats, lines }, wip: W, evm: E, sov: S, changeOrders: C, cash: K, fade, trend: trend || null };
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'metrics.json'), JSON.stringify(metrics, null, 2));

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const f0 = (n) => n == null ? '–' : (n < 0 ? '(' : '') + Math.abs(Math.round(n)).toLocaleString('en-US') + (n < 0 ? ')' : '');
const fm = (n) => n == null ? '–' : (Math.abs(n) >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : f0(n));
const pc = (n, d = 1) => n == null ? '–' : (100 * n).toFixed(d) + '%';
const x2 = (n) => n == null ? '–' : n.toFixed(2);
const band = (v) => v == null ? '' : v >= 1 ? 'g' : v >= 0.95 ? 'a' : 'r';
const neg = (n) => n < 0 ? 'r' : '';
const tile = (label, val, sub, cls = '') => `<div class="tile ${cls}"><div class="tl">${label}</div><div class="tv">${val}</div><div class="ts">${sub || ''}</div></div>`;

function sCurve() {
  if (!trend) return '<p class="muted">trend.csv not provided — S-curve skipped.</p>';
  const d = trend.map(r => ({ p: r.period, pv: num(r.pv), ev: num(r.ev), ac: num(r.ac) }));
  const w = 640, h = 260, m = { l: 56, r: 16, t: 14, b: 28 };
  const max = Math.max(...d.flatMap(x => [x.pv, x.ev, x.ac])) * 1.08;
  const X = (i) => m.l + (d.length > 1 ? i * (w - m.l - m.r) / (d.length - 1) : 0), Y = (v) => h - m.b - v / max * (h - m.t - m.b);
  const line = (k, c, dash = '') => `<polyline fill="none" stroke="${c}" stroke-width="2.4" ${dash} points="${d.map((x, i) => `${X(i)},${Y(x[k])}`).join(' ')}"/>` + d.map((x, i) => `<circle cx="${X(i)}" cy="${Y(x[k])}" r="3" fill="${c}"><title>${esc(x.p)} ${k.toUpperCase()}: ${f0(x[k])}</title></circle>`).join('');
  const grid = [0, .25, .5, .75, 1].map(t => `<line x1="${m.l}" x2="${w - m.r}" y1="${Y(max * t / 1.08)}" y2="${Y(max * t / 1.08)}" class="gl"/><text x="${m.l - 6}" y="${Y(max * t / 1.08) + 4}" text-anchor="end" class="ax">${fm(max * t / 1.08)}</text>`).join('');
  const xs = d.map((x, i) => `<text x="${X(i)}" y="${h - 8}" text-anchor="middle" class="ax">${esc(x.p)}</text>`).join('');
  return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="S-curve of planned value, earned value and actual cost">${grid}${xs}${line('pv', 'var(--pv)', 'stroke-dasharray="6 4"')}${line('ev', 'var(--ev)')}${line('ac', 'var(--ac)')}</svg>
  <div class="legend"><span><i style="background:var(--pv)"></i>PV (plan)</span><span><i style="background:var(--ev)"></i>EV (earned)</span><span><i style="background:var(--ac)"></i>AC (actual)</span></div>`;
}

const table = (head, body, cls = '') => `<div class="scroll"><table class="${cls}"><thead><tr>${head.map(h => `<th${h.startsWith('>') ? ' class="n"' : ''}>${esc(h.replace(/^>/, ''))}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div>`;
const jcBody = cats.map(c => `<tr class="grp"><td colspan="2">${esc(c.cat)}</td><td class="n">${f0(c.budget)}</td><td class="n">${f0(c.committed)}</td><td class="n">${f0(c.actual)}</td><td class="n">${f0(c.etc)}</td><td class="n">${f0(c.eac)}</td><td class="n ${neg(c.var)}">${f0(c.var)}</td><td class="n ${band(c.cpi)}">${x2(c.cpi)}</td><td class="n ${band(c.spi)}">${x2(c.spi)}</td></tr>` +
  lines.filter(l => l.cat === c.cat).map(l => `<tr><td>${esc(l.code)}</td><td>${esc(l.desc)}</td><td class="n">${f0(l.budget)}</td><td class="n">${f0(l.committed)}</td><td class="n">${f0(l.actual)}</td><td class="n">${f0(l.etc)}</td><td class="n">${f0(l.eac)}</td><td class="n ${neg(l.var)}">${f0(l.var)}</td><td class="n ${band(div(l.ev, l.actual))}">${x2(div(l.ev, l.actual))}</td><td class="n ${band(div(l.ev, l.pv))}">${x2(div(l.ev, l.pv))}</td></tr>`).join('')).join('') +
  `<tr class="tot"><td colspan="2">Total</td><td class="n">${f0(T.budget)}</td><td class="n">${f0(T.committed)}</td><td class="n">${f0(T.actual)}</td><td class="n">${f0(T.etc)}</td><td class="n">${f0(T.eac)}</td><td class="n ${neg(T.var)}">${f0(T.var)}</td><td class="n ${band(CPI)}">${x2(CPI)}</td><td class="n ${band(SPI)}">${x2(SPI)}</td></tr>`;
const overruns = [...lines].filter(l => l.var < 0).sort((a, b) => a.var - b.var).slice(0, 5);
const alerts = warnings.length ? warnings.sort((a, b) => (a.sev === 'red' ? 0 : 1) - (b.sev === 'red' ? 0 : 1)).map(w => `<li class="${w.sev}"><b>${w.sev === 'red' ? 'RED' : 'AMBER'}</b> <span class="own">${w.owner}</span> ${esc(w.msg)}</li>`).join('') : '<li class="g">No alerts.</li>';

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>EPC Project Controls Dashboard</title><style>
:root{--bg:#f5f6f8;--card:#fff;--ink:#14213d;--mut:#5b6577;--line:#e2e6ee;--g:#1a7f4b;--a:#b7791f;--r:#c0392b;--pv:#7a8599;--ev:#1f6feb;--ac:#d9480f;--acc:#14213d}
@media(prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#0f1420;--card:#171e2e;--ink:#e8ecf4;--mut:#9aa6bc;--line:#27324a;--g:#4ec58a;--a:#e0a84a;--r:#ef6f62;--pv:#8d99b0;--ev:#5b9bff;--ac:#ff8a52;--acc:#e8ecf4;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#0f1420;--card:#171e2e;--ink:#e8ecf4;--mut:#9aa6bc;--line:#27324a;--g:#4ec58a;--a:#e0a84a;--r:#ef6f62;--pv:#8d99b0;--ev:#5b9bff;--ac:#ff8a52;--acc:#e8ecf4;color-scheme:dark}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 system-ui,Segoe UI,Arial,sans-serif}
.wrap{max-width:1280px;margin:0 auto;padding:20px 16px 48px}h1{font-size:22px;margin:0}h2{font-size:15px;margin:0 0 10px;letter-spacing:.02em}
.hdr{display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px;margin-bottom:16px}.muted,.ts,.ax{color:var(--mut)}.ax{fill:var(--mut);font-size:11px}
.badge{background:var(--acc);color:var(--bg);border-radius:4px;padding:2px 8px;font-size:12px}
.grid{display:grid;gap:12px}.k6{grid-template-columns:repeat(auto-fit,minmax(150px,1fr))}.two{grid-template-columns:repeat(auto-fit,minmax(380px,1fr))}
.tile,.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px}.card{margin-top:12px}
.tl{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--mut)}.tv{font-size:24px;font-weight:650;margin:2px 0}
.tile.g .tv,.g{color:var(--g)}.tile.a .tv,.a{color:var(--a)}.tile.r .tv,.r{color:var(--r)}
.scroll{overflow-x:auto}table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}th,td{padding:6px 8px;border-bottom:1px solid var(--line);text-align:left;white-space:nowrap}
th{font-size:11px;text-transform:uppercase;color:var(--mut);letter-spacing:.05em}.n{text-align:right}tr.grp td{background:var(--bg);font-weight:650}tr.tot td{font-weight:700;border-top:2px solid var(--ink)}
ul.al{list-style:none;margin:0;padding:0}ul.al li{padding:6px 8px;border-left:4px solid var(--line);margin-bottom:6px;background:var(--bg);border-radius:0 6px 6px 0}ul.al li.red{border-color:var(--r)}ul.al li.amber{border-color:var(--a)}ul.al li.g{border-color:var(--g)}
.own{font-size:11px;border:1px solid var(--line);border-radius:3px;padding:0 5px;margin:0 4px}
svg{width:100%;height:auto}.gl{stroke:var(--line)}.legend{display:flex;gap:16px;font-size:12px;color:var(--mut)}.legend i{display:inline-block;width:12px;height:3px;margin-right:5px;vertical-align:middle}
.kv{display:grid;grid-template-columns:1fr auto;gap:4px 12px}.kv span:nth-child(even){text-align:right;font-variant-numeric:tabular-nums}
footer{margin-top:20px;font-size:12px;color:var(--mut)}
</style></head><body><div class="wrap">
<div class="hdr"><div><h1>${esc(P.project_name)}</h1><div class="muted">Client: ${esc(P.client)} · Status date: ${esc(P.status_date)} · Currency: ${esc(cur)}</div></div>
<div>${demo ? '<span class="badge">ILLUSTRATIVE SAMPLE DATA</span>' : ''}</div></div>

<div class="grid k6">
${tile('Revised contract', fm(RCV), 'Orig ' + fm(origCV) + ' + CO ' + fm(apprCO))}
${tile('EAC (forecast)', fm(T.eac), 'Budget ' + fm(T.budget), T.var < 0 ? 'r' : 'g')}
${tile('Forecast margin', pc(estGPpct), fm(estGP) + (fade != null ? ' · fade ' + (100 * fade).toFixed(1) + ' pts' : ''), estGP < 0 ? 'r' : fade != null && fade < -0.01 ? 'a' : 'g')}
${tile('CPI', x2(CPI), 'CV ' + f0(E.CV), band(CPI) === 'g' ? 'g' : band(CPI) === 'a' ? 'a' : 'r')}
${tile('SPI', x2(SPI), 'SV ' + f0(E.SV), band(SPI) === 'g' ? 'g' : band(SPI) === 'a' ? 'a' : 'r')}
${tile('Over / (Under) billing', f0(overUnder), pc(ouPct) + ' of contract', Math.abs(ouPct) > 0.1 ? 'r' : Math.abs(ouPct) > 0.05 ? 'a' : 'g')}
</div>

<div class="card"><h2>Alerts &amp; actions (${warnings.length})</h2><ul class="al">${alerts}</ul></div>

<div class="grid two">
<div class="card"><h2>EVM — S-curve</h2>${sCurve()}</div>
<div class="card"><h2>EVM metrics</h2><div class="kv">
<span>BAC</span><span>${f0(BAC)}</span><span>PV</span><span>${f0(PV)}</span><span>EV</span><span>${f0(EV)}</span><span>AC</span><span>${f0(AC)}</span>
<span>% complete (EV) / % spent</span><span>${pc(E.pctComplete)} / ${pc(E.pctSpent)}</span>
<span>TCPI to BAC / to EAC</span><span class="${E.TCPI_BAC > 1.1 ? 'r' : E.TCPI_BAC > 1.05 ? 'a' : ''}">${x2(E.TCPI_BAC)} / ${x2(E.TCPI_EAC)}</span>
<span>VAC (BAC − EAC)</span><span class="${neg(E.VAC)}">${f0(E.VAC)}</span></div>
<h2 style="margin-top:14px">EAC methods</h2>
${table(['Method', '>EAC', '>vs BAC'], [['EAC-1  BAC / CPI', E.eac1], ['EAC-2  AC + (BAC − EV)', E.eac2], ['EAC-3  AC + (BAC − EV)/(CPI×SPI)', E.eac3], ['EAC-4  Bottom-up (AC + ETC) — used', E.eac4]].map(([n, v]) => `<tr><td>${n}</td><td class="n">${f0(v)}</td><td class="n ${v == null ? '' : neg(BAC - v)}">${v == null ? '–' : f0(BAC - v)}</td></tr>`).join(''))}</div>
</div>

<div class="card"><h2>Job Cost Report</h2>${table(['Code', 'Description', '>Revised budget', '>Committed', '>Actual', '>ETC', '>EAC', '>Variance', '>CPI', '>SPI'], jcBody)}</div>

<div class="grid two">
<div class="card"><h2>WIP schedule (cost-to-cost POC)</h2><div class="kv">
<span>Revised contract value</span><span>${f0(RCV)}</span><span>Estimated cost at completion</span><span>${f0(T.eac)}</span>
<span>Estimated gross profit</span><span class="${neg(estGP)}">${f0(estGP)} (${pc(estGPpct)})</span>
<span>Cost to date</span><span>${f0(T.actual)}</span><span>% complete (cost-to-cost)</span><span>${pc(poc)}</span>
<span>Earned revenue</span><span>${f0(earned)}</span><span>Billings to date</span><span>${f0(billed)}</span>
<span>${overUnder >= 0 ? 'Overbilling (contract liability)' : 'Underbilling (contract asset)'}</span><span class="${Math.abs(ouPct) > 0.1 ? 'r' : ''}">${f0(Math.abs(overUnder))}</span>
<span>Gross profit to date</span><span>${f0(gpToDate)}</span><span>Backlog (remaining revenue)</span><span>${f0(W.backlog)}</span>
<span>Loss provision required</span><span class="${lossTotal > 0 ? 'r' : ''}">${f0(lossTotal)}</span></div></div>
<div class="card"><h2>Cash &amp; retainage</h2><div class="kv">
<span>Billed to date (gross)</span><span>${f0(K.billed)}</span><span>Retainage held (${(ret * 100).toFixed(0)}%)</span><span>${f0(K.retHeld)}</span>
<span>Cash received</span><span>${f0(K.cashIn)}</span><span>Net receivable</span><span>${f0(K.netRecv)}</span>
<span>Cost paid</span><span>${f0(K.paid)}</span><span>Payables outstanding</span><span>${f0(K.payables)}</span>
<span>Net cash position</span><span class="${neg(K.netCash)}">${f0(K.netCash)}</span></div>
<h2 style="margin-top:14px">Change orders</h2>${C ? `<div class="kv"><span>Approved revenue</span><span>${f0(C.approvedRev)}</span><span>Pending revenue (not in RCV)</span><span>${f0(C.pendingRev)}</span><span>Unapproved-work cost exposure</span><span class="${C.unapprovedCost > 0 ? 'a' : ''}">${f0(C.unapprovedCost)}</span></div>` : '<p class="muted">Not provided.</p>'}</div>
</div>

${S ? `<div class="card"><h2>SOV / progress billing</h2>${table(['Item', 'Description', '>Scheduled value', '>Previous', '>This period', '>Stored', '>Total', '>%', '>Balance', '>Retainage'],
  S.rows.map(r => `<tr><td>${esc(r.item)}</td><td>${esc(r.desc)}</td><td class="n">${f0(r.sv)}</td><td class="n">${f0(r.prev)}</td><td class="n">${f0(r.cur)}</td><td class="n">${f0(r.stored)}</td><td class="n">${f0(r.total)}</td><td class="n ${r.phys != null && r.pct * 100 - r.phys > 20 ? 'r' : r.phys != null && r.pct * 100 - r.phys > 10 ? 'a' : ''}">${pc(r.pct, 0)}</td><td class="n">${f0(r.bal)}</td><td class="n">${f0(r.ret)}</td></tr>`).join('') +
  `<tr class="tot"><td colspan="2">Total</td><td class="n">${f0(S.sv)}</td><td class="n">${f0(S.prev)}</td><td class="n">${f0(S.cur)}</td><td class="n">${f0(S.stored)}</td><td class="n">${f0(S.total)}</td><td class="n">${pc(div(S.total, S.sv), 0)}</td><td class="n">${f0(S.sv - S.total)}</td><td class="n">${f0(S.retainage)}</td></tr>`)}
<p class="muted">Current payment due (this period, net of retainage): <b>${f0(S.due)}</b></p></div>` : ''}

<div class="card"><h2>Top cost overruns (EAC vs revised budget)</h2>${overruns.length ? table(['Code', 'Description', '>Budget', '>EAC', '>Variance'], overruns.map(l => `<tr><td>${esc(l.code)}</td><td>${esc(l.desc)}</td><td class="n">${f0(l.budget)}</td><td class="n">${f0(l.eac)}</td><td class="n r">${f0(l.var)}</td></tr>`).join('')) : '<p class="muted">No cost code is forecast over budget.</p>'}</div>

<footer>Generated ${new Date().toISOString().slice(0, 10)} from local CSV files. Revenue = cost-to-cost POC × revised contract value; EAC = actual + PM-signed ETC. Thresholds are defaults — company policy overrides. This is a management calculation, not audit advice.${skipped.length ? ' Skipped: ' + esc(skipped.join('; ')) + '.' : ''}</footer>
</div></body></html>`;
fs.writeFileSync(path.join(outDir, 'dashboard.html'), html);
console.log(`dashboard.html + metrics.json written to ${outDir}`);
if (args.includes('--xlsx')) {
  const { projectWorkbook } = await import('./export_excel.mjs');
  const safe = String(P.project_name).replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_').slice(0, 60) || 'project';
  fs.writeFileSync(path.join(outDir, `${safe}_project_controls.xlsx`), projectWorkbook(JSON.parse(fs.readFileSync(path.join(outDir, 'metrics.json'), 'utf8'))));
  console.log(`Excel workbook written: ${safe}_project_controls.xlsx`);
}
console.log(`Warnings: ${warnings.length} (${warnings.filter(w => w.sev === 'red').length} red)`); if (skipped.length) console.log('Skipped: ' + skipped.join('; '));
