#!/usr/bin/env node
// EPC portfolio view. Runs build_dashboard.mjs for every project sub-folder, then aggregates.
// Usage: node build_portfolio.mjs --data <portfolio-dir> --out <dir>   |   --demo --out <dir>
// <portfolio-dir>/<project-folder>/{project.csv,job_cost.csv,...}  (one folder per project)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : undefined; };
const here = path.dirname(fileURLToPath(import.meta.url));
const demo = args.includes('--demo');
const dataDir = demo ? path.join(here, '..', 'assets', 'sample_portfolio') : opt('data');
const outDir = opt('out') || process.cwd();
if (!dataDir) { console.error('Usage: --data <portfolio-dir> --out <dir>  (or --demo)'); process.exit(1); }

const folders = fs.readdirSync(dataDir, { withFileTypes: true }).filter(d => d.isDirectory() && fs.existsSync(path.join(dataDir, d.name, 'project.csv')) && fs.existsSync(path.join(dataDir, d.name, 'job_cost.csv'))).map(d => d.name).sort();
if (!folders.length) { console.error('No project sub-folders (each needs project.csv + job_cost.csv) in ' + dataDir); process.exit(1); }

// ---- run the single-project engine per folder ----
const projects = [], failed = [];
for (const f of folders) {
  const out = path.join(outDir, 'projects', f);
  try {
    execFileSync(process.execPath, [path.join(here, 'build_dashboard.mjs'), '--data', path.join(dataDir, f), '--out', out, ...(args.includes('--xlsx') ? ['--xlsx'] : [])], { stdio: 'pipe' });
    const m = JSON.parse(fs.readFileSync(path.join(out, 'metrics.json'), 'utf8'));
    const reds = m.warnings.filter(w => w.sev === 'red'), ambers = m.warnings.filter(w => w.sev !== 'red');
    const rag = reds.length || m.wip.estGP < 0 ? 'r' : ambers.length ? 'a' : 'g';
    projects.push({ folder: f, m, reds: reds.length, ambers: ambers.length, rag });
  } catch (e) { failed.push(f + ': ' + String(e.stderr || e.message).split('\n')[0]); }
}
if (!projects.length) { console.error('All projects failed:\n' + failed.join('\n')); process.exit(1); }

// ---- aggregate ----
const currencies = [...new Set(projects.map(p => p.m.project.currency || ''))];
const mixed = currencies.length > 1;
const S = (fn) => projects.reduce((s, p) => s + fn(p.m), 0);
const div = (a, b) => (b ? a / b : null);
const A = {
  rcv: S(m => m.wip.RCV), eac: S(m => m.jobCost.totals.eac), cost: S(m => m.jobCost.totals.actual), earned: S(m => m.wip.earned),
  billed: S(m => m.wip.billed), gpTD: S(m => m.wip.gpToDate), backlog: S(m => m.wip.backlog), loss: S(m => m.wip.loss),
  ev: S(m => m.evm.EV), pv: S(m => m.evm.PV), ac: S(m => m.evm.AC), bac: S(m => m.evm.BAC), vac: S(m => m.evm.VAC),
  netCash: S(m => m.cash.netCash), retHeld: S(m => m.cash.retHeld), netRecv: S(m => m.cash.netRecv),
  over: projects.reduce((s, p) => s + Math.max(p.m.wip.overUnder, 0), 0), under: projects.reduce((s, p) => s + Math.min(p.m.wip.overUnder, 0), 0),
};
A.estGP = A.rcv - A.eac; A.gpPct = div(A.estGP, A.rcv); A.cpi = div(A.ev, A.ac); A.spi = div(A.ev, A.pv); A.poc = div(A.cost, A.eac);
const priorGP = projects.every(p => p.m.project.prior_margin_pct !== undefined) ? projects.reduce((s, p) => s + p.m.wip.RCV * Number(p.m.project.prior_margin_pct) / 100, 0) : null;
A.fade = priorGP != null ? A.gpPct - priorGP / A.rcv : null;
const rank = { r: 0, a: 1, g: 2 };
projects.sort((a, b) => rank[a.rag] - rank[b.rag] || a.m.wip.estGPpct - b.m.wip.estGPpct);
const allAlerts = projects.flatMap(p => p.m.warnings.map(w => ({ ...w, proj: p.m.project.project_name, folder: p.folder }))).sort((a, b) => (a.sev === 'red' ? 0 : 1) - (b.sev === 'red' ? 0 : 1));

fs.mkdirSync(outDir, { recursive: true });
const pmetrics = { currencies, mixed, totals: A, projects: projects.map(p => ({ folder: p.folder, rag: p.rag, reds: p.reds, ambers: p.ambers, name: p.m.project.project_name, fade: p.m.fade, wip: p.m.wip, evm: p.m.evm, cash: p.m.cash })), alerts: allAlerts, failed };
fs.writeFileSync(path.join(outDir, 'portfolio_metrics.json'), JSON.stringify(pmetrics, null, 2));
if (args.includes('--xlsx')) {
  const { portfolioWorkbook } = await import('./export_excel.mjs');
  fs.writeFileSync(path.join(outDir, 'portfolio_controls.xlsx'), portfolioWorkbook(pmetrics));
  console.log('Excel workbook written: portfolio_controls.xlsx (+ one workbook per project in projects/<folder>/)');
}

// ---- html ----
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const f0 = (n) => n == null ? '–' : (n < 0 ? '(' : '') + Math.abs(Math.round(n)).toLocaleString('en-US') + (n < 0 ? ')' : '');
const fm = (n) => n == null ? '–' : (Math.abs(n) >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : f0(n));
const pc = (n, d = 1) => n == null ? '–' : (100 * n).toFixed(d) + '%';
const x2 = (n) => n == null ? '–' : n.toFixed(2);
const band = (v) => v == null ? '' : v >= 1 ? 'g' : v >= 0.95 ? 'a' : 'r';
const neg = (n) => n < 0 ? 'r' : '';
const tile = (l, v, s, c = '') => `<div class="tile ${c}"><div class="tl">${l}</div><div class="tv">${v}</div><div class="ts">${s || ''}</div></div>`;
const cur = mixed ? '' : currencies[0];
const dot = (r) => `<span class="dot ${r}" title="${r === 'r' ? 'Red' : r === 'a' ? 'Amber' : 'Green'}"></span><span class="sr">${r === 'r' ? 'Red' : r === 'a' ? 'Amber' : 'Green'}</span>`;
const link = (p) => `<a href="projects/${encodeURIComponent(p.folder)}/dashboard.html">${esc(p.m.project.project_name)}</a>`;
const th = (a) => a.map(h => `<th${h.startsWith('>') ? ' class="n"' : ''}>${esc(h.replace(/^>/, ''))}</th>`).join('');

const wipRows = projects.map(p => { const w = p.m.wip, t = p.m.jobCost.totals; const fd = p.m.fade; return `<tr><td>${dot(p.rag)}</td><td>${link(p)}</td><td class="n">${f0(w.RCV)}</td><td class="n">${f0(t.eac)}</td><td class="n ${neg(w.estGP)}">${f0(w.estGP)}</td><td class="n ${neg(w.estGP)}">${pc(w.estGPpct)}</td><td class="n ${fd == null ? '' : fd < -0.02 ? 'r' : fd < -0.01 ? 'a' : ''}">${fd == null ? '–' : (100 * fd).toFixed(1) + ' pts'}</td><td class="n">${f0(t.actual)}</td><td class="n">${pc(w.poc)}</td><td class="n">${f0(w.earned)}</td><td class="n">${f0(w.billed)}</td><td class="n ${Math.abs(w.overUnder / w.RCV) > 0.1 ? 'r' : Math.abs(w.overUnder / w.RCV) > 0.05 ? 'a' : ''}">${f0(w.overUnder)}</td><td class="n">${f0(w.gpToDate)}</td><td class="n">${f0(w.backlog)}</td><td class="n ${w.loss > 0 ? 'r' : ''}">${f0(w.loss)}</td></tr>`; }).join('');
const evmRows = projects.map(p => { const e = p.m.evm; return `<tr><td>${dot(p.rag)}</td><td>${link(p)}</td><td class="n">${f0(e.BAC)}</td><td class="n">${pc(e.pctComplete)}</td><td class="n">${pc(e.pctSpent)}</td><td class="n ${band(e.CPI)}">${x2(e.CPI)}</td><td class="n ${band(e.SPI)}">${x2(e.SPI)}</td><td class="n ${e.TCPI_BAC > 1.1 ? 'r' : e.TCPI_BAC > 1.05 ? 'a' : ''}">${x2(e.TCPI_BAC)}</td><td class="n ${neg(e.VAC)}">${f0(e.VAC)}</td><td class="n">${p.reds}/${p.ambers}</td></tr>`; }).join('');
const cashRows = projects.map(p => { const k = p.m.cash; return `<tr><td>${link(p)}</td><td class="n">${f0(k.billed)}</td><td class="n">${f0(k.retHeld)}</td><td class="n">${f0(k.cashIn)}</td><td class="n">${f0(k.netRecv)}</td><td class="n">${f0(k.paid)}</td><td class="n">${f0(k.payables)}</td><td class="n ${neg(k.netCash)}">${f0(k.netCash)}</td></tr>`; }).join('');

// margin bars (est. GP %) — one bar per project, shared scale
const mx = Math.max(0.2, ...projects.map(p => Math.abs(p.m.wip.estGPpct || 0))) * 1.1;
const bars = projects.map(p => { const v = p.m.wip.estGPpct || 0, wd = Math.abs(v) / mx * 50; const pr = p.m.project.prior_margin_pct !== undefined ? Number(p.m.project.prior_margin_pct) / 100 : null;
  return `<div class="bar"><div class="bn">${link(p)}</div><div class="bt"><div class="mid"></div><div class="fill ${v < 0 ? 'r' : p.rag}" style="${v < 0 ? `right:50%;width:${wd}%` : `left:50%;width:${wd}%`}"></div>${pr != null ? `<div class="prior" style="left:${50 + pr / mx * 50}%" title="Prior ${(100 * pr).toFixed(1)}%"></div>` : ''}</div><div class="bv ${neg(v)}">${pc(v)}</div></div>`; }).join('');

const alerts = allAlerts.slice(0, 25).map(a => `<li class="${a.sev}"><b>${a.sev === 'red' ? 'RED' : 'AMBER'}</b> <span class="own">${a.owner}</span> <a href="projects/${encodeURIComponent(a.folder)}/dashboard.html">${esc(a.proj)}</a> — ${esc(a.msg)}</li>`).join('');

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>EPC Portfolio Dashboard</title><style>
:root{--bg:#f5f6f8;--card:#fff;--ink:#14213d;--mut:#5b6577;--line:#e2e6ee;--g:#1a7f4b;--a:#b7791f;--r:#c0392b;--acc:#14213d;--lnk:#1f4fd8}
@media(prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#0f1420;--card:#171e2e;--ink:#e8ecf4;--mut:#9aa6bc;--line:#27324a;--g:#4ec58a;--a:#e0a84a;--r:#ef6f62;--acc:#e8ecf4;--lnk:#7fb0ff;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#0f1420;--card:#171e2e;--ink:#e8ecf4;--mut:#9aa6bc;--line:#27324a;--g:#4ec58a;--a:#e0a84a;--r:#ef6f62;--acc:#e8ecf4;--lnk:#7fb0ff;color-scheme:dark}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 system-ui,Segoe UI,Arial,sans-serif}a{color:var(--lnk);text-decoration:none}a:hover{text-decoration:underline}
.wrap{max-width:1360px;margin:0 auto;padding:20px 16px 48px}h1{font-size:22px;margin:0}h2{font-size:15px;margin:0 0 10px;letter-spacing:.02em}.muted,.ts{color:var(--mut)}
.badge{background:var(--acc);color:var(--bg);border-radius:4px;padding:2px 8px;font-size:12px}.hdr{display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px;margin-bottom:16px}
.grid{display:grid;gap:12px}.k6{grid-template-columns:repeat(auto-fit,minmax(150px,1fr))}.two{grid-template-columns:repeat(auto-fit,minmax(380px,1fr))}
.tile,.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px}.card{margin-top:12px}
.tl{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--mut)}.tv{font-size:24px;font-weight:650;margin:2px 0}
.tile.g .tv,.g{color:var(--g)}.tile.a .tv,.a{color:var(--a)}.tile.r .tv,.r{color:var(--r)}
.scroll{overflow-x:auto}table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}th,td{padding:6px 8px;border-bottom:1px solid var(--line);text-align:left;white-space:nowrap}
th{font-size:11px;text-transform:uppercase;color:var(--mut);letter-spacing:.05em}.n{text-align:right}tr.tot td{font-weight:700;border-top:2px solid var(--ink)}
.dot{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:4px}.dot.g{background:var(--g)}.dot.a{background:var(--a)}.dot.r{background:var(--r)}.sr{position:absolute;left:-9999px}
ul.al{list-style:none;margin:0;padding:0}ul.al li{padding:6px 8px;border-left:4px solid var(--line);margin-bottom:6px;background:var(--bg);border-radius:0 6px 6px 0}ul.al li.red{border-color:var(--r)}ul.al li.amber{border-color:var(--a)}
.own{font-size:11px;border:1px solid var(--line);border-radius:3px;padding:0 5px;margin:0 4px}
.bar{display:grid;grid-template-columns:minmax(120px,240px) 1fr 64px;gap:10px;align-items:center;margin:6px 0}.bt{position:relative;height:14px;background:var(--bg);border-radius:3px}.mid{position:absolute;left:50%;top:-2px;bottom:-2px;width:1px;background:var(--mut)}
.fill{position:absolute;top:0;bottom:0;border-radius:2px}.fill.g{background:var(--g)}.fill.a{background:var(--a)}.fill.r{background:var(--r)}.prior{position:absolute;top:-3px;bottom:-3px;width:2px;background:var(--ink)}.bv{text-align:right;font-variant-numeric:tabular-nums}
.kv{display:grid;grid-template-columns:1fr auto;gap:4px 12px}.kv span:nth-child(even){text-align:right;font-variant-numeric:tabular-nums}
footer{margin-top:20px;font-size:12px;color:var(--mut)}
</style></head><body><div class="wrap">
<div class="hdr"><div><h1>Portfolio — ${projects.length} project${projects.length > 1 ? 's' : ''}</h1><div class="muted">Currency: ${mixed ? 'MIXED (' + esc(currencies.join(', ')) + ') — totals not shown' : esc(cur)} · Status dates: ${esc([...new Set(projects.map(p => p.m.project.status_date))].join(', '))}</div></div><div>${demo ? '<span class="badge">ILLUSTRATIVE SAMPLE DATA</span>' : ''}</div></div>
${mixed ? '<div class="card"><b class="r">Mixed currencies:</b> portfolio totals and ratios are suppressed. Convert to one reporting currency (state the FX rates used) and re-run.</div>' : `
<div class="grid k6">
${tile('Total contract value', fm(A.rcv), 'Backlog ' + fm(A.backlog))}
${tile('Total EAC', fm(A.eac), 'Cost to date ' + fm(A.cost))}
${tile('Portfolio margin', pc(A.gpPct), fm(A.estGP) + (A.fade != null ? ' · fade ' + (100 * A.fade).toFixed(1) + ' pts' : ''), A.estGP < 0 ? 'r' : A.fade != null && A.fade < -0.01 ? 'a' : 'g')}
${tile('CPI (weighted)', x2(A.cpi), 'ΣEV / ΣAC', band(A.cpi) || '')}
${tile('SPI (weighted)', x2(A.spi), 'ΣEV / ΣPV', band(A.spi) || '')}
${tile('Net cash position', f0(A.netCash), 'Retainage held ' + fm(A.retHeld), A.netCash < 0 ? 'r' : 'g')}
</div>`}

<div class="card"><h2>Project health (${projects.filter(p => p.rag === 'r').length} red · ${projects.filter(p => p.rag === 'a').length} amber · ${projects.filter(p => p.rag === 'g').length} green) — forecast margin %, black tick = prior month</h2>${bars}</div>

<div class="card"><h2>WIP schedule — portfolio</h2><div class="scroll"><table><thead><tr>${th(['', 'Project', '>Contract (RCV)', '>EAC', '>Est. GP', '>GP %', '>Fade', '>Cost to date', '>POC %', '>Earned rev.', '>Billings', '>Over/(Under)', '>GP to date', '>Backlog', '>Loss prov.'])}</tr></thead><tbody>${wipRows}
${mixed ? '' : `<tr class="tot"><td></td><td>Portfolio</td><td class="n">${f0(A.rcv)}</td><td class="n">${f0(A.eac)}</td><td class="n ${neg(A.estGP)}">${f0(A.estGP)}</td><td class="n">${pc(A.gpPct)}</td><td class="n">${A.fade == null ? '–' : (100 * A.fade).toFixed(1) + ' pts'}</td><td class="n">${f0(A.cost)}</td><td class="n">${pc(A.poc)}</td><td class="n">${f0(A.earned)}</td><td class="n">${f0(A.billed)}</td><td class="n">${f0(A.over + A.under)}</td><td class="n">${f0(A.gpTD)}</td><td class="n">${f0(A.backlog)}</td><td class="n ${A.loss > 0 ? 'r' : ''}">${f0(A.loss)}</td></tr>`}</tbody></table></div>
${mixed ? '' : `<p class="muted">Balance-sheet split — overbillings (contract liability): <b>${f0(A.over)}</b> · underbillings (contract asset): <b>${f0(Math.abs(A.under))}</b>. Do not net projects against each other in the financial statements.</p>`}</div>

<div class="card"><h2>EVM — portfolio</h2><div class="scroll"><table><thead><tr>${th(['', 'Project', '>BAC', '>% complete', '>% spent', '>CPI', '>SPI', '>TCPI (BAC)', '>VAC', '>Red/Amber'])}</tr></thead><tbody>${evmRows}</tbody></table></div></div>

<div class="grid two">
<div class="card"><h2>Cash &amp; retainage</h2><div class="scroll"><table><thead><tr>${th(['Project', '>Billed', '>Retainage', '>Cash in', '>Net recv.', '>Paid', '>Payables', '>Net cash'])}</tr></thead><tbody>${cashRows}</tbody></table></div></div>
<div class="card"><h2>Alerts across portfolio (${allAlerts.length}${allAlerts.length > 25 ? ', top 25 shown' : ''})</h2><ul class="al">${alerts || '<li class="g">No alerts.</li>'}</ul></div>
</div>
<footer>Generated ${new Date().toISOString().slice(0, 10)} from local files. Each project row links to its own dashboard. Health: Red = any red alert or negative forecast margin; Amber = any amber alert. Portfolio CPI/SPI are value-weighted (ΣEV/ΣAC, ΣEV/ΣPV).${failed.length ? ' <b class="r">Failed projects: ' + esc(failed.join('; ')) + '</b>' : ''} Management calculation, not audit advice.</footer>
</div></body></html>`;
fs.writeFileSync(path.join(outDir, 'portfolio.html'), html);
console.log(`portfolio.html + portfolio_metrics.json + projects/*/dashboard.html written to ${outDir}`);
console.log(`Projects: ${projects.length}  Red: ${projects.filter(p => p.rag === 'r').length}  Amber: ${projects.filter(p => p.rag === 'a').length}  Green: ${projects.filter(p => p.rag === 'g').length}` + (failed.length ? `  FAILED: ${failed.length}` : ''));
