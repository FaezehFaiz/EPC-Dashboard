# EPC-Dashboard

EPC project-controls skill (Job Cost, WIP, SOV, EAC/ETC, EVM) + demo outputs. All sample data is fictional.

- `skill/epc-management-dashboard/`  the skill (source of truth copy). Live install for Claude Code: `C:\Users\<you>\.claude\skills\epc-management-dashboard\`
- `share/`  zips to send: the skill (upload in claude.ai > Settings > Skills) and the demo outputs
- `demo-outputs/`  dashboard.html, portfolio.html, Excel workbooks (open in browser / Excel)

Run (Node 18+), from `skill/epc-management-dashboard/`:

    node scripts/build_dashboard.mjs --demo --xlsx --out ../../out-single
    node scripts/build_portfolio.mjs --demo --xlsx --out ../../out-portfolio
    node scripts/build_dashboard.mjs --data <folder with project.csv + job_cost.csv> --xlsx --out <dir>

Input format: `skill/epc-management-dashboard/references/data-schema.md`.
Note: edits here do not change the installed Claude Code copy automatically; re-copy the folder to `.claude\skills\` after changes.
