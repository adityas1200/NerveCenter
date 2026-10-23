---
max_turns: 6
allowed_tools: [Skill]
---
Job `orders_daily_load` run 88213 failed at 06:12 IST on 22 Sep 2026 with `AnalysisException: [UNRESOLVED_COLUMN] region_cd`. The upstream vendor file renamed `region_cd` to `region_code` on 21 Sep; runs before that succeeded; nothing changed in code. Dashboards show data up to 21 Sep. Give me the RCA.
