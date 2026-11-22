# Report layouts

## 1. Job Cost Report
Columns: Cost Code · Description · Original Budget · Approved Changes · Revised Budget ·
Committed · Open Commitment · Actual to Date · ETC · EAC · Variance (Budget − EAC) · % Spent · % Complete.
Group by category with subtotals; sort exceptions (largest negative variance) first in the
"Top overruns" panel. Footer: totals + reconciliation to GL (user supplies GL total to tie out).

## 2. WIP Schedule
One row per project (portfolio view) or one block per project:
RCV · EAC · Est. GP · Est. GP % · Cost to Date · POC % · Earned Revenue · Billings ·
Over/(Under) · GP to Date · Backlog · Loss Provision · Prior-month GP% · Fade.
Totals split into over-billings (liability) and under-billings (asset) for the balance sheet.

## 3. SOV / Pay application
Per line: Item · Description · Scheduled Value · Previous · This Period · Stored · Total ·
% · Balance · Retainage. Summary: Contract sum to date, total completed, retainage,
earned less retainage, previous certificates, **current payment due**.

## 4. EAC / ETC Forecast
Budget → EAC bridge by driver (scope growth, productivity, price escalation, schedule,
subcontract, risk contingency drawn). Show: Prior EAC → Current EAC with the delta explained.
Contingency & risk register burn-down alongside.

## 5. EVM
KPI strip (CPI, SPI, CV, SV, TCPI, VAC) · S-curve (PV/EV/AC, + EAC marker) ·
EAC method comparison table · by-category CPI/SPI heat table.

## 6. Change orders
Log with status, revenue, cost, margin; totals: approved / pending / unapproved-work exposure.

## 7. Cash & retainage
Billed · Retainage held · Cash received · Net receivable · Cost paid · Payables · Net cash position.

## 8. Alerts panel (auto)
Rules in `interpretation.md` → list with severity (red/amber), owner (PM/PA), suggested action.

## Monthly PA × PM review agenda (30–45 min)
1. Status date & cut-off confirmation (accruals, stored materials, unbilled).
2. Forecast changes: top 5 cost-code ETC movements, with reasons.
3. Margin bridge: prior vs current forecast margin.
4. Billing: over/under, next milestones, SOV front-loading, retainage.
5. Change orders: pending > 30 days, unapproved work.
6. EVM: CPI/SPI trend, TCPI realism.
7. Risks/contingency; decisions & owners with dates.
