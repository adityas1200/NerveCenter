// Real content from task T-1002 (pilot project, 24 Sep 2026), reshaped as components.
// Every block is something Sonic would emit with a show_* tool; the page renders it.

const V7 = ["sale_date", "npi", "product_id", "market", "trx_count", "nrx_count", "trx_qty", "nrx_qty", "plan_id", "payer_type", "zip", "territory_id", "file_week"];

window.TASK = {
  title: "Veltrix daily sales load failed — IQVIA file schema change",
  turns: [
    {
      id: "triage",
      who: "Automatic triage · INC0031201",
      user: "Triage this ticket. Read-only: do not change any system.",
      userMore: "1. Say in one line what the ticket is about and what type of work it is. 2. Check the live systems for the evidence the ticket points at. 3. Give the likely cause, or the smallest next check. 4. Say exactly what you would change and which approval that would need.",
      worked: {
        took: "2m", systems: ["Databricks", "Repo", "ServiceNow", "Jira", "Knowledge"],
        groups: [
          { h: "Knowledge", items: ["Read the IQVIA Xponent runbook", "Read the Veltrix data contract notes"] },
          { h: "Databricks", items: ["Listed runs of job 731 and job 732", "Read run 900001222: failed at curate_sales_facts"] },
          { h: "Repo · commercial-data-pipelines", items: ["Read contracts/iqvia_xponent_daily_v7.json", "Read curate_sales_facts.py"] },
          { h: "ServiceNow · Jira", items: ["Read INC0031201", "Found CDO-118 already open for this fix"] },
          { h: "Blocked by read-only", blocked: true, items: ["5 commands that would have written files or called the SQL API"] },
        ],
      },
      blocks: [
        { t: "headline", text: "Confirmed pipeline failure: IQVIA added a 14th column, plan_type, to the Veltrix file and the active contract only accepts 13. The fix is a contract change, not a rerun." },
        { t: "tiles", items: [
          { l: "Job 731 · today 04:00 UTC", v: "Failed", tone: "bad", s: "after 4 good days" },
          { l: "Brand dashboard shows", v: "23 Sep", tone: "warn", s: "one day behind" },
          { l: "Merge and rerun by", v: "12:00", tone: "", s: "UTC · review at 13:00" },
        ] },
        { t: "schema", title: "Why it failed", meta: "VLX_XPO_DAILY_20260924.txt",
          expected: V7, found: V7.concat(["plan_type"]), extra: "plan_type",
          note: "curate_sales_facts compares the header to contract v7 by exact match, so the 14-column file failed before anything was written. Yesterday's data is intact." },
        { t: "runs", title: "Last runs", meta: "Same vendor, two jobs",
          axis: ["20 Sep", "21 Sep", "22 Sep", "23 Sep", "24 Sep", ""],
          rows: [
            { nm: "Veltrix · job 731", sub: "veltrix_sales_daily_load", runs: [["ok", "20 Sep 04:00 · Success · 21m"], ["ok", "21 Sep 04:00 · Success · 20m"], ["ok", "22 Sep 04:00 · Success · 22m"], ["ok", "23 Sep 04:00 · Success · 21m"], ["bad", "24 Sep 04:00 · Failed after 19s · schema mismatch, unexpected column plan_type at position 14"], ["none", "No run since"]] },
            { nm: "Corvana · job 732", sub: "control", runs: [["ok", "20 Sep 04:15 · Success"], ["ok", "21 Sep 04:15 · Success"], ["ok", "22 Sep 04:15 · Success"], ["ok", "23 Sep 04:15 · Success"], ["ok", "24 Sep 04:15 · Success · same vendor, so the change is Veltrix-file specific"], ["none", ""]] },
          ] },
        { t: "cause", confidence: "High", text: "An additive vendor schema change met a strict contract check. Re-running job 731 fails the same way until the contract changes; the runbook says not to rerun.",
          evidence: [
            ["Databricks", "Run 900001222 error: unexpected column plan_type at position 14 (expected 13, found 14)"],
            ["Repo", "Contract v7 has 13 columns; ACTIVE_CONTRACT is pinned to v7"],
            ["Vendor notice", "IQVIA announced plan_type for daily files from 24 Sep"],
            ["Job 732", "Corvana loaded normally, so it is not a delivery problem"],
          ] },
        { t: "flow", title: "Where it stopped", nodes: [
          { l: "IQVIA file", s: "arrived 03:52", st: "ok" },
          { l: "ingest", s: "passed", st: "ok" },
          { l: "curate", s: "failed", st: "bad" },
          { l: "silver", s: "23 Sep", st: "stale" },
          { l: "gold", s: "23 Sep", st: "stale" },
          { l: "Dashboard", s: "23 Sep", st: "stale" },
        ] },
        { t: "question", q: "How should plan_type be handled?", opts: [
          { b: "Accept as a nullable STRING", s: "Contract v8, carried into silver. Gold unchanged for now." },
          { b: "Accept and drop it", s: "Today's load clears; the field is ignored." },
        ], chosen: 0, by: "Mitesh Shinde" },
        { t: "next", items: [
          { label: "Implement the fix on CDO-118", kind: "prompt", prompt: "Implement the fix for CDO-118" },
          { label: "Open triage report", kind: "file", small: "report.md" },
        ] },
      ],
    },
    {
      id: "fix",
      who: "Mitesh Shinde",
      user: "Implement the fix for CDO-118: branch, contract v8 with plan_type as a nullable STRING, point ACTIVE_CONTRACT at v8, add a regression test, run pytest, commit. Then comment on CDO-118 and move it to In Review.",
      worked: {
        took: "8m", systems: ["Repo", "Jira"],
        groups: [
          { h: "Repo · commercial-data-pipelines", items: ["Created branch ticket/CDO-118-iqvia-plan-type", "Wrote contract v8, edited curate_sales_facts.py, rewrote the tests", "python -m pytest -q: 9 passed", "Committed 87893e8 (not pushed: no remote)"] },
          { h: "Jira", items: ["Commented on CDO-118 (91559)", "Moved CDO-118 To Do → In Review", "Read it back"] },
        ],
      },
      blocks: [
        { t: "change", id: "change", branch: "ticket/CDO-118-iqvia-plan-type", base: "main", commit: "87893e8", tests: "9 passed", state: "approved", steps: 6,
          files: [
            { p: "contracts/iqvia_xponent_daily_v8.json", a: 23, r: 0, diff: [["ctx", "  \"version\": 8,"], ["add", "+ \"effective_from\": \"2026-09-24\","], ["ctx", "  ...13 columns from v7"], ["add", "+ { \"name\": \"plan_type\", \"type\": \"STRING\", \"nullable\": true }"]] },
            { p: "pipelines/veltrix_sales_daily_load/curate_sales_facts.py", a: 1, r: 1, diff: [["ctx", " CONTRACT_DIR = Path(__file__).resolve().parents[2] / \"contracts\""], ["del", "-ACTIVE_CONTRACT = \"iqvia_xponent_daily_v7.json\""], ["add", "+ACTIVE_CONTRACT = \"iqvia_xponent_daily_v8.json\""]] },
            { p: "tests/test_curate_sales_facts.py", a: 49, r: 6, diff: [["add", "+V8 = V7 + [\"plan_type\"]"], ["add", "+def test_plan_type_is_a_nullable_string_at_position_14():"], ["add", "+def test_v8_header_passes():"], ["add", "+def test_plan_type_absent_from_a_row_is_null_not_an_error():"]] },
          ] },
        { t: "headline", text: "The CDO-118 fix is implemented, tested and committed on a local branch, and the ticket is In Review with Priya Nair." },
        { t: "records", title: "Ticket updated", items: [
          { id: "CDO-118", sys: "Jira", from: "To Do", to: "In Review", note: "Comment 91559: branch, commit and test result", rb: "Read back" },
        ] },
        { t: "notes", title: "Worth knowing", items: [
          ["Nullable means the value, not the header.", "v8 now rejects a 13-column file. Files from before 24 Sep need v7 pinned explicitly; a test covers that."],
          ["plan_type reaches silver on its own.", "Gold and the dashboard are unchanged; that is a separate story, as you decided."],
        ] },
        { t: "next", items: [
          { label: "Push the branch", kind: "done", small: "needs a remote" },
          { label: "Deploy is done, rerun job 731", kind: "prompt", prompt: "Deploy is done: rerun job 731" },
        ] },
      ],
    },
    {
      id: "recover",
      who: "Mitesh Shinde",
      user: "Deploy is done: contract v8 is live on job 731. Rerun it, verify, then resolve INC0031201 and close CDO-118.",
      worked: {
        took: "8m", systems: ["Databricks", "SQL", "ServiceNow", "Jira"],
        groups: [
          { h: "Skills", items: ["Remediation", "Verification"] },
          { h: "Databricks", items: ["Preflight: no run in progress, max_concurrent_runs 1", "Triggered run-now on job 731 → run 910000002", "Polled to a terminal state"] },
          { h: "SQL warehouse", items: ["Read gold.veltrix_sales_daily for 24 Sep", "Read DQ results for veltrix_sales"] },
          { h: "ServiceNow · Jira", items: ["Work note and Resolved on INC0031201", "Comment 98258 and Done on CDO-118", "Read both back"] },
        ],
      },
      blocks: [
        { t: "approval", id: "rerun", state: "approved", by: "Mitesh Shinde", at: "05:37",
          title: "Rerun job 731 in production",
          what: "Runs veltrix_sales_daily_load again on today's file with contract v8: ingest, curate, then refresh the gold mart.",
          checks: ["No run in progress; only one can run at a time", "The failed run wrote nothing", "Writes use overwrite, so no duplicate rows"],
          kv: [["Rollback", "None needed. A failed run writes nothing."], ["If it fails", "Priya Nair and the ops alias are notified"], ["Policy", "Production run · ask"]],
          cmd: "curl -s -X POST -H \"Authorization: Bearer $DATABRICKS_TOKEN\" \"$DATABRICKS_HOST/api/2.2/jobs/run-now\" -d '{\"job_id\": 731}'" },
        { t: "tracker", id: "tracker", title: "Run 910000002", meta: "05:37:19 – 05:37:44 UTC",
          tasks: [["ingest_iqvia_file", "8s"], ["curate_sales_facts", "11s"], ["refresh_gold_mart", "6s"]] },
        { t: "headline", text: "The Veltrix load is recovered and the brand dashboard is current ahead of the 09:00 EST review. One check could not be confirmed, so it is not claimed." },
        { t: "verify", id: "verify", rows: [
          { c: "Original failure retested", e: "curate_sales_facts passed on the same file", r: "pass" },
          { c: "Newest run of 731", e: "910000002 · all 3 tasks", r: "pass" },
          { c: "Gold mart current", e: "gold.veltrix_sales_daily has 24 Sep rows, loaded 05:40", r: "pass" },
          { c: "DQ: freshness, trx_null_rate", e: "Results read fail but predate the 05:40 load; next batch 06:30", r: "open", act: true },
        ] },
        { t: "records", title: "Records changed", items: [
          { id: "INC0031201", sys: "ServiceNow", from: "In Progress", to: "Resolved", note: "Work note and close notes: reopen if DQ still fails at 06:30", rb: "Read back" },
          { id: "CDO-118", sys: "Jira", from: "In Review", to: "Done", note: "Comment 98258", rb: "Read back" },
        ] },
        { t: "notes", title: "Worth knowing", items: [
          ["hcp_match_rate also reads fail.", "It is not in the IQVIA runbook and may belong to the duplicate-NPI work on CDO-119. Flagged on both tickets."],
          ["Row counts are unconfirmed.", "The SQL warehouse returned null for COUNT(*); only row presence and loaded_at were checked."],
        ] },
        { t: "next", id: "next-final", items: [
          { label: "Run the DQ checks now", kind: "tool", action: "dq" },
          { label: "Draft the update for the brand team", kind: "prompt", prompt: "Draft the update for the brand team" },
          { label: "Open CDO-119", kind: "link" },
        ] },
      ],
    },
  ],
  // Answers for the follow-ups the mock can play.
  followups: {
    dq: {
      who: "Mitesh Shinde", user: "Run the DQ checks now",
      worked: { took: "40s", systems: ["Databricks"], groups: [{ h: "Databricks", items: ["Triggered dq_checks_daily for veltrix_sales", "Read the new results"] }] },
      blocks: [
        { t: "approval", id: "dq-run", state: "pending",
          title: "Run the Veltrix DQ checks",
          what: "Runs dq_checks_daily for the veltrix_sales suite now, against the data loaded at 05:40, instead of waiting for 06:30.",
          checks: ["Read-only against the tables; writes only DQ result rows", "No other DQ run in progress"],
          kv: [["Rollback", "Not needed."], ["Policy", "Production run · ask"]],
          cmd: "curl -s -X POST \"$DATABRICKS_HOST/api/2.2/jobs/run-now\" -d '{\"job_id\": 770, \"job_parameters\": {\"suite\": \"veltrix_sales\"}}'" },
        { t: "headline", text: "Both checks pass on today's data. INC0031201 can stay resolved." },
        { t: "tiles", items: [
          { l: "freshness", v: "Pass", tone: "ok", s: "loaded 05:40 · limit 06:00" },
          { l: "trx_null_rate", v: "0.02%", tone: "ok", s: "limit 0.5%" },
          { l: "hcp_match_rate", v: "Fail", tone: "bad", s: "unrelated · CDO-119" },
        ] },
      ],
      after: "dq",
    },
    email: {
      who: "Mitesh Shinde", user: "Draft the update for the brand team",
      worked: { took: "20s", systems: ["Knowledge"], groups: [{ h: "Knowledge", items: ["Looked up the Veltrix brand team distribution list", "Used the incident update template"] }] },
      blocks: [
        { t: "email", id: "mail", to: "veltrix-brand-analytics@helixa.example", cc: "priya.nair@helixa.example", subject: "Veltrix dashboard is current for today's review",
          body: [
            "Hi team,",
            "This morning's Veltrix sales load failed because IQVIA added a new column to the daily file. We updated the data contract and reran the load at 05:37 UTC.",
            "LIST:The dashboard now shows data through 24 Sep|No data was lost or duplicated|The new plan_type field is stored but not on the dashboard yet",
            "Nothing is needed from you. Reply here if any number looks off.",
            "Mitesh",
          ] },
      ],
    },
  },
  details: {
    files: [["report.md", "Report"], ["triage-OPS-1001.md", "Working notes"]],
    skills: [["Remediation", "used"], ["Verification", "used"]],
    knowledge: [["iqvia-xponent-runbook.md", "read"], ["veltrix-data-contract.md", "read"]],
    session: [["Model", "Opus 5"], ["Turns", "69"], ["Time", "20m 3s"], ["Cost", "$5.73"], ["Permission", "Ask first"]],
  },
};
