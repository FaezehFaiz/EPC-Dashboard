# Formulas

Notation: BAC budget at completion, PV planned value, EV earned value, AC actual cost,
CV cost variance, SV schedule variance.

## 1. Job Cost Report (per cost code)

```
Revised Budget      = Original Budget + Approved Budget Changes
Uncommitted Budget  = Revised Budget − Committed
Open Commitment     = Committed − Actual (not yet invoiced / incurred)
Cost to Complete    = ETC  (PM forecast: open commitment + uncommitted forecast)
EAC                 = Actual to Date + ETC
Variance at Compl.  = Revised Budget − EAC       (negative = overrun)
% Spent             = Actual / Revised Budget
```
Check: `Actual ≤ Committed` (otherwise uncommitted spend), `ETC ≥ 0`, `ETC ≥ Open Commitment`
(you will have to pay what you have committed unless a PO is being cancelled).

## 2. EAC / ETC (forecast)

Primary (used everywhere): **bottom-up** `EAC = AC + ETC`, ETC signed by PM.

Cross-checks (EVM-based):

| Name | Formula | Use when |
|---|---|---|
| EAC-1 | `BAC / CPI` | Past cost efficiency will continue |
| EAC-2 | `AC + (BAC − EV)` | Variance was one-off; remaining work at budget |
| EAC-3 | `AC + (BAC − EV) / (CPI × SPI)` | Cost *and* schedule pressure both persist |
| EAC-4 | `AC + ETC_bottom-up` | Default; PM re-estimate |

```
ETC (from EAC)  = EAC − AC
VAC             = BAC − EAC
Forecast margin = Revised Contract Value − EAC
Margin %        = Forecast margin / Revised Contract Value
Margin fade     = Margin % now − Margin % prior month (or at bid)
```
Flag when EAC-4 is better than EAC-1/EAC-3 by > 3 % of BAC: forecast may be optimistic.

## 3. WIP schedule (cost-to-cost)

```
Revised Contract Value (RCV) = Original + Approved Change Orders
% Complete (POC)             = Cost to Date / EAC            (cap 100 %)
Earned Revenue to Date       = POC × RCV
Billings to Date             = invoiced to client (gross, incl. retainage held)
Over / (Under) Billing       = Billings − Earned Revenue
   > 0  → Billings in excess of costs & earnings (contract liability)
   < 0  → Costs & earnings in excess of billings (contract asset)
Gross Profit to Date         = Earned Revenue − Cost to Date
Backlog (remaining revenue)  = RCV − Earned Revenue
Estimated Gross Profit       = RCV − EAC
Loss provision               = if EAC > RCV:  (EAC − RCV) − (loss already recognized)
```
Worked example: RCV 10.0M, EAC 8.5M, cost to date 4.25M → POC 50 %, earned 5.0M,
billed 5.6M → overbilled 0.6M (liability), GP to date 0.75M, est. GP 1.5M (15 %).

Red flags: overbilling > 10 % of RCV (cash front-loading — can mask a cost problem);
underbilling growing 2 months in a row (billing lag / disputed progress);
POC jump > 10 points in a month without matching physical progress.

## 4. SOV / progress billing

Per line:
```
Work Completed This Period (D)   input
Materials Stored (E)             input
Total Completed & Stored (G)     = Previous (C) + D + E
% Complete (G / B)               B = Scheduled Value
Balance to Finish (B − G)
Retainage                        = G × retainage %
Net Billing                      = G − Retainage − Previous Certified
```
Reconciliation: Σ Scheduled Values = Revised Contract Value; front-loaded SOV lines
(G% much higher than physical progress) must be flagged.

## 5. EVM

```
EV  = Σ (Budget_i × Physical % Complete_i)         (weighted by cost code / WBS)
PV  = Σ (Budget_i × Planned % Complete_i)          (baseline schedule at status date)
CV  = EV − AC           SV  = EV − PV
CPI = EV / AC           SPI = EV / PV
TCPI (to BAC) = (BAC − EV) / (BAC − AC)
TCPI (to EAC) = (BAC − EV) / (EAC − AC)
% Complete (EV) = EV / BAC           % Spent = AC / BAC
```
Interpretation bands: CPI/SPI ≥ 1.00 green · 0.95–0.99 amber · < 0.95 red.
TCPI(BAC) > 1.10 → returning to budget is unrealistic; re-forecast.
Time estimate (optional): `Estimated Duration = Planned Duration / SPI` (rough; prefer
critical-path analysis, EVM SPI is distorted late in the project — use earned schedule if available).

## 6. Change orders

```
Approved CO value  → adds to RCV and (if budgeted) Revised Budget
Pending CO         → priced, submitted, not approved → show as upside, NOT in RCV
Unapproved cost    = cost incurred/forecast for extra work without approved CO
Exposure           = Unapproved cost − (Pending CO value × win-probability)   (only if user gives probability)
Net CO margin      = CO value − CO cost
```

## 7. Cash & retainage

```
Retainage Held by Client = Billings × retainage %  (less releases)
Net Receivable           = Billings − Retainage − Cash Received
Cash Position            = Cash Received − Cost Paid
Payables Outstanding     = Actual cost − Cost Paid
Billing Position         = Over / (Under) Billing  (see §3)
```
Retainage release is a milestone: track "retainage due at completion" in the cash panel.
