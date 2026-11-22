#!/usr/bin/env node
// Excel export for the EPC dashboard. Live formulas (blue = input, black = formula); no dependencies.
// Usage: node export_excel.mjs --metrics <metrics.json> --out <file.xlsx>
//        node export_excel.mjs --portfolio <portfolio_metrics.json> --out <file.xlsx>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildXlsx } from './xlsx_writer.mjs';

const N = (v) => { const n = parseFloat(String(v ?? '').replace(/,/g, '')); return Number.isFinite(n) ? n : 0; };
const I = (v, s = 'inum') => ({ v, s });                       // input cell
const F = (f, v, s = 'num') => ({ f, v: v == null ? '' : v, s }); // formula cell with cached value
const H = (...labels) => labels.map(l => ({ v: l, s: 'hdr' }));
const dv = (a, b) => (b ? a / b : '');
const CF_RAG = (c) => ({ sqref: c, first: c.split(':')[0], rules: [['AND(ISNUMBER({c}),{c}<0.95)', 0], ['AND(ISNUMBER({c}),{c}>=0.95,{c}<1)', 1], ['AND(ISNUMBER({c}),{c}>=1)', 2]] });
const titleRows = (title, note) => [[{ v: title, s: 'title' }], [{ v: note, s: 'note' }], []];
const NOTE = 'Blue = input, black = formula. Change inputs (e.g. ETC) and everything recalculates.';

export function projectWorkbook(m) {
  const P = m.project, L = m.jobCost.lines, T = m.jobCost.totals, W = m.wip, E = m.evm, K = m.cash;
  const ret = N(P.retainage_pct) / 100, n = L.length, r0 = 5, tr = r0 + n;       // job cost data rows r0..r0+n-1, total row tr
  const rng = (c) => `'Job Cost'!$${c}$${r0}:$${c}$${tr - 1}`;
  const sample = /sample|test/i.test(P.project_name) ? ' — ILLUSTRATIVE SAMPLE DATA' : '';
  const sheets = [];

  // ---- Job Cost ----
  const jc = [...titleRows('Job Cost Report — ' + P.project_name + sample, `Status date ${P.status_date} · ${P.currency} · ${NOTE}`),
  H('Cost code', 'Description', 'Category', 'Original budget', 'Approved changes', 'Revised budget', 'Committed', 'Open commitment', 'Actual to date', 'ETC (PM forecast)', 'EAC', 'Variance (budget − EAC)', '% spent', 'Physical % complete', 'Planned % complete', 'EV', 'PV', 'CPI', 'SPI')];
  L.forEach((l, i) => { const r = r0 + i; jc.push([
    I(l.code, 'itext'), l.desc, l.cat, I(l.orig), I(l.chg), F(`D${r}+E${r}`, l.budget), I(l.committed), F(`MAX(G${r}-I${r},0)`, l.open), I(l.actual), I(l.etc),
    F(`I${r}+J${r}`, l.eac), F(`F${r}-K${r}`, l.var), F(`IF(F${r}=0,"",I${r}/F${r})`, dv(l.actual, l.budget), 'pct'), I(l.prog / 100, 'ipct'), I(l.plan / 100, 'ipct'),
    F(`F${r}*MIN(MAX(N${r},0),1)`, l.ev), F(`F${r}*MIN(MAX(O${r},0),1)`, l.pv), F(`IF(I${r}=0,"",P${r}/I${r})`, dv(l.ev, l.actual), 'ratio'), F(`IF(Q${r}=0,"",P${r}/Q${r})`, dv(l.ev, l.pv), 'ratio')]); });
  const S = (c, v) => F(`SUM(${c}${r0}:${c}${tr - 1})`, v, 'tnum');
  jc.push([{ v: 'Total', s: 'tlabel' }, { v: '', s: 'tlabel' }, { v: '', s: 'tlabel' }, S('D', T.orig), S('E', T.chg), S('F', T.budget), S('G', T.committed), S('H', T.open), S('I', T.actual), S('J', T.etc), S('K', T.eac), S('L', T.var),
  F(`IF(F${tr}=0,"",I${tr}/F${tr})`, dv(T.actual, T.budget), 'tpct'), F(`IF(F${tr}=0,"",P${tr}/F${tr})`, dv(T.ev, T.budget), 'tpct'), F(`IF(F${tr}=0,"",Q${tr}/F${tr})`, dv(T.pv, T.budget), 'tpct'), S('P', T.ev), S('Q', T.pv),
  F(`IF(I${tr}=0,"",P${tr}/I${tr})`, dv(T.ev, T.actual), 'tratio'), F(`IF(Q${tr}=0,"",P${tr}/Q${tr})`, dv(T.ev, T.pv), 'tratio')]);
  const JC = { name: 'Job Cost', rows: jc, widths: [11, 32, 15, 15, 15, 15, 15, 15, 15, 15, 15, 16, 10, 12, 12, 15, 15, 8, 8], freeze: 'C5', heights: { 3: 45 }, cf: [CF_RAG(`R${r0}:S${tr}`)] };

  // ---- By Category ----
  const cr = 5, cats = m.jobCost.categories;
  const bc = [...titleRows('Summary by Category — ' + P.project_name, 'All values are SUMIF formulas over the Job Cost sheet.'), H('Category', 'Revised budget', 'Committed', 'Actual', 'ETC', 'EAC', 'Variance', 'EV', 'PV', 'CPI', 'SPI')];
  cats.forEach((c, i) => { const r = cr + i; const sf = (col, v) => F(`SUMIF(${rng('C')},$A${r},${rng(col)})`, v);
    bc.push([c.cat, sf('F', c.budget), sf('G', c.committed), sf('I', c.actual), sf('J', c.etc), sf('K', c.eac), F(`B${r}-F${r}`, c.var), sf('P', c.ev), sf('Q', c.pv), F(`IF(D${r}=0,"",H${r}/D${r})`, dv(c.ev, c.actual), 'ratio'), F(`IF(I${r}=0,"",H${r}/I${r})`, dv(c.ev, c.pv), 'ratio')]); });
  const bt = cr + cats.length, bs = (c, v) => F(`SUM(${c}${cr}:${c}${bt - 1})`, v, 'tnum');
  bc.push([{ v: 'Total', s: 'tlabel' }, bs('B', T.budget), bs('C', T.committed), bs('D', T.actual), bs('E', T.etc), bs('F', T.eac), bs('G', T.var), bs('H', T.ev), bs('I', T.pv), F(`IF(D${bt}=0,"",H${bt}/D${bt})`, dv(T.ev, T.actual), 'tratio'), F(`IF(I${bt}=0,"",H${bt}/I${bt})`, dv(T.ev, T.pv), 'tratio')]);
  const BC = { name: 'By Category', rows: bc, widths: [20, 16, 16, 16, 16, 16, 16, 16, 16, 9, 9], heights: { 3: 30 }, cf: [CF_RAG(`J${cr}:K${bt}`)] };

  // ---- WIP ----
  const wip = [...titleRows('WIP Schedule (cost-to-cost) — ' + P.project_name + sample, `Status date ${P.status_date} · ${P.currency} · ${NOTE}`), H('Item', 'Amount', 'Basis'),
  ['Original contract value', I(N(P.original_contract_value)), 'project.csv'],
  ['Approved change orders', I(N(P.approved_change_orders)), 'Approved only — pending COs are not revenue'],
  [{ v: 'Revised contract value (RCV)', s: 'bold' }, F('B5+B6', W.RCV, 'tnum'), 'Original + approved'],
  ['Estimated cost at completion (EAC)', F(`'Job Cost'!K${tr}`, T.eac), 'Actual + PM-signed ETC'],
  ['Estimated gross profit', F('B7-B8', W.estGP), 'RCV − EAC'],
  ['Estimated GP %', F('IF(B7=0,"",B9/B7)', W.estGPpct, 'pct'), ''],
  ['Cost to date', F(`'Job Cost'!I${tr}`, T.actual), ''],
  ['% complete (cost-to-cost)', F('IF(B8=0,0,MIN(B11/B8,1))', W.poc, 'pct'), 'Cost to date ÷ EAC (input method)'],
  ['Earned revenue to date', F('B12*B7', W.earned), 'POC × RCV'],
  ['Billings to date (gross)', I(W.billed), 'Incl. retainage held'],
  [{ v: 'Over / (Under) billing', s: 'bold' }, F('B14-B13', W.overUnder, 'tnum'), 'Billings − earned revenue'],
  ['Position', F('IF(B15>=0,"Overbilled — contract liability","Underbilled — contract asset")', W.overUnder >= 0 ? 'Overbilled — contract liability' : 'Underbilled — contract asset', 'def'), 'Do not net across projects in the balance sheet'],
  ['Gross profit to date', F('B13-B11', W.gpToDate), 'Earned revenue − cost to date'],
  ['Backlog (remaining revenue)', F('B7-B13', W.backlog), 'RCV − earned'],
  ['Loss provision required (total anticipated loss)', F('MAX(B8-B7,0)', W.loss), 'If EAC > RCV the full loss is recognized now — confirm policy with auditors'],
  ['Pending change orders (not in RCV)', I(N(P.pending_change_orders)), 'Upside only until approved']];
  const WIP = { name: 'WIP', rows: wip, widths: [48, 20, 70], heights: { 3: 22 } };

  // ---- EVM ----
  const ev = [...titleRows('Earned Value Management — ' + P.project_name + sample, `Status date ${P.status_date} · ${NOTE}`), H('Metric', 'Value', 'Note'),
  ['BAC (revised budget)', F(`'Job Cost'!F${tr}`, E.BAC), ''], ['PV (planned value)', F(`'Job Cost'!Q${tr}`, E.PV), 'Σ budget × planned %'], ['EV (earned value)', F(`'Job Cost'!P${tr}`, E.EV), 'Σ budget × physical %'], ['AC (actual cost)', F(`'Job Cost'!I${tr}`, E.AC), ''],
  ['CV = EV − AC', F('B7-B8', E.CV), ''], ['SV = EV − PV', F('B7-B6', E.SV), ''],
  [{ v: 'CPI = EV / AC', s: 'bold' }, F('IF(B8=0,"",B7/B8)', E.CPI, 'ratio'), '≥1.00 green · 0.95–0.99 amber · <0.95 red'],
  [{ v: 'SPI = EV / PV', s: 'bold' }, F('IF(B6=0,"",B7/B6)', E.SPI, 'ratio'), 'Distorted late in project — cross-check with the critical path'],
  ['TCPI to BAC', F('IF(B5=B8,"",(B5-B7)/(B5-B8))', E.TCPI_BAC, 'ratio'), '> 1.10 → returning to budget is unrealistic'],
  ['TCPI to EAC', F(`IF('Job Cost'!K${tr}=B8,"",(B5-B7)/('Job Cost'!K${tr}-B8))`, E.TCPI_EAC, 'ratio'), ''],
  ['% complete (EV / BAC)', F('IF(B5=0,"",B7/B5)', E.pctComplete, 'pct'), ''], ['% spent (AC / BAC)', F('IF(B5=0,"",B8/B5)', E.pctSpent, 'pct'), ''], [],
  H('EAC method', 'EAC', 'BAC − EAC'),
  ['EAC-1  BAC / CPI (past efficiency continues)', F('IF(N(B11)=0,"",B5/B11)', E.eac1), F('IF(B19="","",B5-B19)', E.eac1 == null ? '' : E.BAC - E.eac1)],
  ['EAC-2  AC + (BAC − EV) (one-off variance)', F('B8+(B5-B7)', E.eac2), F('B5-B20', E.BAC - E.eac2)],
  ['EAC-3  AC + (BAC − EV)/(CPI×SPI)', F('IF(OR(N(B11)=0,N(B12)=0),"",B8+(B5-B7)/(B11*B12))', E.eac3), F('IF(B21="","",B5-B21)', E.eac3 == null ? '' : E.BAC - E.eac3)],
  [{ v: 'EAC-4  Bottom-up AC + ETC (used everywhere)', s: 'bold' }, F(`'Job Cost'!K${tr}`, E.eac4, 'tnum'), F('B5-B22', E.BAC - E.eac4, 'tnum')],
  ['VAC = BAC − EAC', F('B5-B22', E.VAC), '']];
  const EVM = { name: 'EVM', rows: ev, widths: [48, 20, 60], heights: { 3: 22, 17: 22 }, cf: [CF_RAG('B11:B12')] };

  const out = [null, JC, BC, WIP, EVM];

  // ---- SOV ----
  if (m.sov) {
    const so = m.sov, s0 = 6, st = s0 + so.rows.length;
    const rows = [[{ v: 'SOV / Progress Billing — ' + P.project_name + sample, s: 'title' }], [{ v: 'Retainage %', s: 'bold' }, I(ret, 'ipct'), { v: NOTE, s: 'note' }], [], [], H('Item', 'Description', 'Scheduled value', 'Previous billed', 'This period', 'Stored materials', 'Total completed & stored', '% complete', 'Balance to finish', 'Retainage', 'Physical %', 'Billed % − physical %')];
    so.rows.forEach((x, i) => { const r = s0 + i; rows.push([I(x.item, 'itext'), x.desc, I(x.sv), I(x.prev), I(x.cur), I(x.stored), F(`D${r}+E${r}+F${r}`, x.total), F(`IF(C${r}=0,"",G${r}/C${r})`, dv(x.total, x.sv), 'pct'), F(`C${r}-G${r}`, x.bal), F(`G${r}*$B$2`, x.ret),
      x.phys == null ? I('', 'ipct') : I(x.phys / 100, 'ipct'), F(`IF(K${r}="","",H${r}-K${r})`, x.phys == null ? '' : dv(x.total, x.sv) - x.phys / 100, 'pct')]); });
    const ss = (c, v) => F(`SUM(${c}${s0}:${c}${st - 1})`, v, 'tnum');
    rows.push([{ v: 'Total', s: 'tlabel' }, { v: '', s: 'tlabel' }, ss('C', so.sv), ss('D', so.prev), ss('E', so.cur), ss('F', so.stored), ss('G', so.total), F(`IF(C${st}=0,"",G${st}/C${st})`, dv(so.total, so.sv), 'tpct'), ss('I', so.sv - so.total), ss('J', so.retainage)], [],
      [{ v: 'Earned less retainage', s: 'bold' }, '', '', '', '', '', F(`G${st}-J${st}`, so.earnedLessRet)],
      [{ v: 'Less previous net certificates', s: 'bold' }, '', '', '', '', '', F(`D${st}*(1-$B$2)`, so.prev * (1 - ret))],
      [{ v: 'Current payment due (net of retainage)', s: 'bold' }, '', '', '', '', '', F(`G${st + 2}-G${st + 3}`, so.due, 'tnum')],
      [{ v: 'Check: Σ scheduled value − revised contract value', s: 'note' }, '', '', '', '', '', F(`C${st}-WIP!B7`, so.sv - W.RCV)]);
    out.push({ name: 'SOV', rows, widths: [8, 36, 16, 16, 15, 15, 18, 11, 16, 14, 11, 14], freeze: 'C6', heights: { 4: 45 }, cf: [{ sqref: `L${s0}:L${st - 1}`, first: `L${s0}`, rules: [['AND(ISNUMBER({c}),{c}>0.2)', 0], ['AND(ISNUMBER({c}),{c}>0.1,{c}<=0.2)', 1]] }] });
  }

  // ---- Change orders ----
  if (m.changeOrders) {
    const co = m.changeOrders, c0 = 5, ct = c0 + co.rows.length;
    const rows = [...titleRows('Change Order Log — ' + P.project_name + sample, NOTE), H('CO no.', 'Description', 'Status', 'Revenue', 'Cost', 'Margin', 'Submitted')];
    co.rows.forEach((x, i) => { const r = c0 + i; rows.push([I(x.co_no, 'itext'), x.description, I(x.status, 'itext'), I(x.revenue), I(x.cost), F(`D${r}-E${r}`, x.revenue - x.cost), I(x.submitted_date, 'itext')]); });
    const sif = (st, c, v) => F(`SUMIF($C$${c0}:$C$${ct - 1},"${st}",${c}$${c0}:${c}$${ct - 1})`, v);
    rows.push([], [{ v: 'Approved — revenue', s: 'bold' }, '', '', sif('Approved', 'D', co.approvedRev)], [{ v: 'Pending — revenue (not in RCV)', s: 'bold' }, '', '', sif('Pending', 'D', co.pendingRev)], [{ v: 'Unapproved work — cost exposure', s: 'bold' }, '', '', sif('Unapproved-Work', 'E', co.unapprovedCost)]);
    out.push({ name: 'Change Orders', rows, widths: [10, 38, 18, 15, 15, 15, 13], heights: { 3: 22 } });
  }

  // ---- Cash ----
  const cash = [...titleRows('Cash & Retainage — ' + P.project_name + sample, `Status date ${P.status_date} · ${NOTE}`), H('Item', 'Amount', 'Basis'),
  ['Billed to date (gross)', I(K.billed), ''], ['Retainage %', I(ret, 'ipct'), ''], ['Retainage held by client', F('B5*B6', K.retHeld), 'Less any releases (not modelled)'],
  ['Cash received', I(K.cashIn), ''], [{ v: 'Net receivable', s: 'bold' }, F('B5-B7-B8', K.netRecv, 'tnum'), 'Billed − retainage − cash received'],
  ['Cost paid to vendors / subs', I(K.paid), ''], ['Actual cost to date', F(`'Job Cost'!I${tr}`, T.actual), ''], ['Payables outstanding', F('B11-B10', K.payables), 'Actual − paid'],
  [{ v: 'Net cash position', s: 'bold' }, F('B8-B10', K.netCash, 'tnum'), 'Cash received − cost paid']];
  out.push({ name: 'Cash', rows: cash, widths: [34, 20, 44], heights: { 3: 22 } });

  // ---- Trend ----
  if (m.trend && m.trend.length) {
    const t0 = 5, rows = [...titleRows('EVM Trend (cumulative) — ' + P.project_name + sample, NOTE), H('Period', 'PV', 'EV', 'AC', 'EAC', 'CPI', 'SPI', 'CV', 'SV')];
    m.trend.forEach((x, i) => { const r = t0 + i, pv = N(x.pv), e = N(x.ev), a = N(x.ac); rows.push([I(x.period, 'itext'), I(pv), I(e), I(a), x.eac === '' || x.eac == null ? null : I(N(x.eac)), F(`IF(D${r}=0,"",C${r}/D${r})`, dv(e, a), 'ratio'), F(`IF(B${r}=0,"",C${r}/B${r})`, dv(e, pv), 'ratio'), F(`C${r}-D${r}`, e - a), F(`C${r}-B${r}`, e - pv)]); });
    out.push({ name: 'Trend', rows, widths: [11, 15, 15, 15, 15, 8, 8, 14, 14], heights: { 3: 22 }, cf: [CF_RAG(`F${t0}:G${t0 + m.trend.length - 1}`)] });
  }

  // ---- Alerts ----
  const al = [...titleRows('Alerts & Actions — ' + P.project_name + sample, 'Default thresholds; company policy overrides. See references/interpretation.md.'), H('Severity', 'Owner', 'Message')];
  const ws = [...m.warnings].sort((a, b) => (a.sev === 'red' ? 0 : 1) - (b.sev === 'red' ? 0 : 1));
  ws.forEach(w => al.push([w.sev === 'red' ? 'RED' : 'AMBER', w.owner, { v: w.msg, s: 'wrap' }]));
  if (!ws.length) al.push(['—', '', 'No alerts.']);
  const alertRows = al.length;
  out.push({ name: 'Alerts', rows: al, widths: [11, 9, 120], heights: { 3: 22 }, cf: [{ sqref: `A5:A${Math.max(5, alertRows)}`, first: 'A5', rules: [['{c}="RED"', 0], ['{c}="AMBER"', 1]] }] });

  // ---- Summary (first) ----
  const reds = ws.filter(w => w.sev === 'red').length;
  const sum = [[{ v: P.project_name + sample, s: 'title' }], [{ v: `Client: ${P.client} · Status date: ${P.status_date} · Currency: ${P.currency}`, s: 'note' }], [],
  H('Key indicator', 'Value', 'Source'),
  ['Revised contract value', F('WIP!B7', W.RCV), 'WIP'], ['EAC (forecast cost at completion)', F('WIP!B8', T.eac), 'Job Cost (actual + ETC)'], ['Forecast gross profit', F('WIP!B9', W.estGP), 'WIP'], ['Forecast margin %', F('WIP!B10', W.estGPpct, 'pct'), 'WIP'],
  ['CPI', F('EVM!B11', E.CPI, 'ratio'), 'EVM'], ['SPI', F('EVM!B12', E.SPI, 'ratio'), 'EVM'], ['TCPI to BAC', F('EVM!B13', E.TCPI_BAC, 'ratio'), 'EVM'],
  ['Over / (Under) billing', F('WIP!B15', W.overUnder), 'WIP'], ['Loss provision required', F('WIP!B19', W.loss), 'WIP'], ['Net cash position', F('Cash!B13', K.netCash), 'Cash'],
  ['Open alerts (red / total)', `${reds} / ${ws.length}`, 'Alerts'], [],
  [{ v: 'Basis: revenue = cost-to-cost % complete × revised contract value; EAC = actual + PM-signed ETC; EVM uses physical progress. Management calculation, not audit advice.', s: 'note' }]];
  if (m.skipped?.length) sum.push([{ v: 'Not provided (sheets skipped): ' + m.skipped.join('; '), s: 'note' }]);
  out[0] = { name: 'Summary', rows: sum, widths: [40, 22, 28], heights: { 3: 22 }, cf: [CF_RAG('B9:B10')] };
  return buildXlsx(out);
}

export function portfolioWorkbook(pm) {
  const ps = pm.projects, n = ps.length, mixed = pm.mixed, r0 = 5, tr = r0 + n, cur = mixed ? 'MIXED CURRENCIES' : pm.currencies[0];
  const sample = ps.some(p => /sample|test/i.test(p.name)) ? ' — ILLUSTRATIVE SAMPLE DATA' : '';
  const ragTxt = { r: 'RED', a: 'AMBER', g: 'GREEN' };
  const ragCF = (c) => ({ sqref: c, first: c.split(':')[0], rules: [['{c}="RED"', 0], ['{c}="AMBER"', 1], ['{c}="GREEN"', 2]] });
  const sheets = [];
  const note = (extra = '') => `${cur} · ${NOTE}${mixed ? ' Totals suppressed: convert to one currency first.' : ''}${extra}`;
  // WIP
  const w = [...titleRows('Portfolio WIP Schedule' + sample, note()), H('Project', 'Health', 'Contract (RCV)', 'EAC', 'Est. GP', 'GP %', 'Fade vs prior', 'Cost to date', 'POC %', 'Earned revenue', 'Billings', 'Over / (Under)', 'GP to date', 'Backlog', 'Loss provision')];
  ps.forEach((p, i) => { const r = r0 + i, x = p.wip; w.push([p.name, ragTxt[p.rag], I(x.RCV), I(p.evm.eac4), F(`C${r}-D${r}`, x.RCV - p.evm.eac4), F(`IF(C${r}=0,"",E${r}/C${r})`, dv(x.RCV - p.evm.eac4, x.RCV), 'pct'), p.fade == null ? '' : I(p.fade, 'ipct'), I(p.evm.AC), F(`IF(D${r}=0,0,MIN(H${r}/D${r},1))`, x.poc, 'pct'), F(`I${r}*C${r}`, x.earned), I(x.billed), F(`K${r}-J${r}`, x.overUnder), F(`J${r}-H${r}`, x.gpToDate), F(`C${r}-J${r}`, x.backlog), F(`MAX(D${r}-C${r},0)`, x.loss)]); });
  const T = pm.totals, sm = (c, v) => F(`SUM(${c}${r0}:${c}${tr - 1})`, v, 'tnum');
  if (!mixed) {
    w.push([{ v: 'Portfolio', s: 'tlabel' }, { v: '', s: 'tlabel' }, sm('C', T.rcv), sm('D', T.eac), sm('E', T.estGP), F(`IF(C${tr}=0,"",E${tr}/C${tr})`, T.gpPct, 'tpct'), { v: T.fade ?? '', s: 'tpct' }, sm('H', T.cost), F(`IF(D${tr}=0,"",H${tr}/D${tr})`, T.poc, 'tpct'), sm('J', T.earned), sm('K', T.billed), sm('L', T.billed - T.earned), sm('M', T.gpTD), sm('N', T.backlog), sm('O', T.loss)], [],
      [{ v: 'Overbillings (contract liability)', s: 'bold' }, '', F(`SUMIF(L${r0}:L${tr - 1},">0")`, T.over)], [{ v: 'Underbillings (contract asset)', s: 'bold' }, '', F(`-SUMIF(L${r0}:L${tr - 1},"<0")`, -T.under)],
      [{ v: 'Report over- and under-billings separately — do not net across projects in the balance sheet.', s: 'note' }]);
  }
  sheets.push({ name: 'Portfolio WIP', rows: w, widths: [42, 9, 16, 16, 15, 9, 12, 16, 9, 16, 16, 15, 15, 16, 14], freeze: 'C5', heights: { 3: 32 }, cf: [ragCF(`B${r0}:B${tr - 1}`)] });
  // EVM
  const e = [...titleRows('Portfolio EVM' + sample, note()), H('Project', 'Health', 'BAC', 'EV', 'PV', 'AC', 'CPI', 'SPI', 'TCPI (BAC)', 'EAC (bottom-up)', 'VAC', 'Red alerts', 'Amber alerts')];
  ps.forEach((p, i) => { const r = r0 + i, x = p.evm; e.push([p.name, ragTxt[p.rag], I(x.BAC), I(x.EV), I(x.PV), I(x.AC), F(`IF(F${r}=0,"",D${r}/F${r})`, x.CPI, 'ratio'), F(`IF(E${r}=0,"",D${r}/E${r})`, x.SPI, 'ratio'), F(`IF(C${r}=F${r},"",(C${r}-D${r})/(C${r}-F${r}))`, x.TCPI_BAC, 'ratio'), I(x.eac4), F(`C${r}-J${r}`, x.VAC), I(p.reds, 'int'), I(p.ambers, 'int')]); });
  if (!mixed) e.push([{ v: 'Portfolio (value-weighted)', s: 'tlabel' }, { v: '', s: 'tlabel' }, sm('C', T.bac), sm('D', T.ev), sm('E', T.pv), sm('F', T.ac), F(`IF(F${tr}=0,"",D${tr}/F${tr})`, T.cpi, 'tratio'), F(`IF(E${tr}=0,"",D${tr}/E${tr})`, T.spi, 'tratio'), F(`IF(C${tr}=F${tr},"",(C${tr}-D${tr})/(C${tr}-F${tr}))`, dv(T.bac - T.ev, T.bac - T.ac), 'tratio'), sm('J', T.eac), sm('K', T.vac), sm('L', ps.reduce((s, p) => s + p.reds, 0)), sm('M', ps.reduce((s, p) => s + p.ambers, 0))]);
  sheets.push({ name: 'Portfolio EVM', rows: e, widths: [42, 9, 16, 16, 16, 16, 8, 8, 11, 16, 15, 10, 11], freeze: 'C5', heights: { 3: 32 }, cf: [ragCF(`B${r0}:B${tr - 1}`), CF_RAG(`G${r0}:H${tr}`)] });
  // Cash
  const c = [...titleRows('Portfolio Cash & Retainage' + sample, note()), H('Project', 'Billed', 'Retainage held', 'Cash received', 'Net receivable', 'Cost paid', 'Payables', 'Net cash')];
  ps.forEach((p, i) => { const r = r0 + i, k = p.cash; c.push([p.name, I(k.billed), I(k.retHeld), I(k.cashIn), F(`B${r}-C${r}-D${r}`, k.netRecv), I(k.paid), I(k.payables), F(`D${r}-F${r}`, k.netCash)]); });
  if (!mixed) c.push([{ v: 'Portfolio', s: 'tlabel' }, ...'BCDEFGH'.split('').map((l, j) => sm(l, [T.billed, T.retHeld, ps.reduce((s, p) => s + p.cash.cashIn, 0), T.netRecv, ps.reduce((s, p) => s + p.cash.paid, 0), ps.reduce((s, p) => s + p.cash.payables, 0), T.netCash][j]))]);
  sheets.push({ name: 'Cash', rows: c, widths: [42, 16, 16, 16, 16, 16, 16, 16], freeze: 'B5', heights: { 3: 30 } });
  // Alerts
  const a = [...titleRows('Alerts across portfolio' + sample, 'Red first. Default thresholds; company policy overrides.'), H('Severity', 'Owner', 'Project', 'Message')];
  (pm.alerts || []).forEach(x => a.push([x.sev === 'red' ? 'RED' : 'AMBER', x.owner, x.proj, { v: x.msg, s: 'wrap' }]));
  if (!(pm.alerts || []).length) a.push(['—', '', '', 'No alerts.']);
  sheets.push({ name: 'Alerts', rows: a, widths: [11, 9, 38, 110], heights: { 3: 22 }, cf: [{ sqref: `A5:A${Math.max(5, a.length)}`, first: 'A5', rules: [['{c}="RED"', 0], ['{c}="AMBER"', 1]] }] });
  if (pm.failed?.length) sheets.push({ name: 'Failed projects', rows: [...titleRows('Projects excluded (invalid input)', 'Not included in any total.'), ...pm.failed.map(f => [{ v: f, s: 'wrap' }])], widths: [140] });
  return buildXlsx(sheets);
}

// ---- CLI ----
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const a = process.argv.slice(2), o = (k) => { const i = a.indexOf('--' + k); return i >= 0 ? a[i + 1] : undefined; };
  const out = o('out');
  if (!out || !(o('metrics') || o('portfolio'))) { console.error('Usage: --metrics <metrics.json> --out <file.xlsx>  |  --portfolio <portfolio_metrics.json> --out <file.xlsx>'); process.exit(1); }
  const buf = o('metrics') ? projectWorkbook(JSON.parse(fs.readFileSync(o('metrics'), 'utf8'))) : portfolioWorkbook(JSON.parse(fs.readFileSync(o('portfolio'), 'utf8')));
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, buf);
  console.log('Excel written: ' + out);
}
