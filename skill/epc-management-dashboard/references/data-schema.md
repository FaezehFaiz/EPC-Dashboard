# Input data schema (CSV, UTF-8, header row required, numbers without thousands separators)

## project.csv  — `key,value` pairs (required)
| key | meaning |
|---|---|
| project_name, client, currency | labels (currency e.g. USD) |
| status_date | YYYY-MM-DD |
| original_contract_value | number |
| approved_change_orders | sum of approved COs (revenue) |
| pending_change_orders | priced & submitted, not approved |
| retainage_pct | e.g. 10 |
| billed_to_date | gross billings incl. retainage |
| cash_received | |
| cost_paid | cash paid to vendors/subs |
| planned_duration_days, elapsed_days | optional |
| prior_eac, prior_margin_pct | optional, for fade / trend |

## job_cost.csv (required)
`cost_code,description,category,original_budget,approved_changes,committed,actual_to_date,etc,progress_pct,planned_pct`
- `category` ∈ Engineering | Procurement | Construction | Indirects | Contingency (or any text; used for grouping)
- `etc` = PM's cost-to-complete for the line (must be ≥ open commitment)
- `progress_pct` = physical % complete (0–100) → EV
- `planned_pct` = baseline % at status date (0–100) → PV

## sov.csv (optional)
`item,description,scheduled_value,previous_billed,this_period,stored_materials,physical_pct`
`physical_pct` optional (enables front-loading check).

## trend.csv (optional, enables S-curve & trend)
`period,pv,ev,ac,eac` — cumulative values per month (eac optional).

## change_orders.csv (optional)
`co_no,description,status,revenue,cost,submitted_date`
`status` ∈ Approved | Pending | Unapproved-Work

## Portfolio folder layout
```
portfolio/
  P1-name/  project.csv  job_cost.csv  [sov.csv trend.csv change_orders.csv]
  P2-name/  ...
```
Only sub-folders containing both `project.csv` and `job_cost.csv` are read.

## Hard errors (project refused, not guessed)
Missing `project_name, currency, status_date, original_contract_value, billed_to_date`;
`job_cost.csv` lacking `cost_code, original_budget, actual_to_date, etc` or having no rows;
`original_contract_value` ≤ 0. progress/planned % outside 0–100 are clamped for EV/PV and warned.

## Validation performed by the script
- Σ scheduled value vs revised contract value
- actual > committed, negative ETC, ETC < open commitment
- progress_pct / planned_pct outside 0–100
- EAC > revised contract value (loss contract)
- Missing optional files → report skipped, not an error
