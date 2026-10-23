import type { TaskEvent } from "@/api/tasks";
import { evidenceTarget, investigationFrom } from "./investigation";

const finding = (seq: number, input: Record<string, unknown>, extra: Partial<TaskEvent> = {}): TaskEvent => ({ id: `f${seq}`, taskId: "T-1", seq, at: `2026-09-25T09:${String(seq).padStart(2, "0")}:00Z`, type: "tool.use", toolUseId: `tu${seq}`, name: "mcp__nervecenter__record_finding", input: JSON.stringify(input), ...extra });

describe("investigationFrom", () => {
  it("folds hypotheses, evidence, what was ruled out, the root cause, the fix and the verification", () => {
    const events: TaskEvent[] = [
      { id: "u1", taskId: "T-1", seq: 1, at: "2026-09-25T09:00:00Z", type: "user.message", text: "Why did it fail?" },
      finding(2, { kind: "hypothesis", id: "h1", text: "The vendor file gained a column." }),
      finding(3, { kind: "hypothesis", id: "h2", text: "The cluster ran out of memory." }),
      finding(4, { kind: "evidence", hypothesisId: "h1", text: "Run 900100826 fails on plan_type.", evidence: [{ label: "Run 900100826", kind: "run", ref: "900100826" }, { label: "INC0031300", kind: "ticket", ref: "INC0031300" }] }),
      finding(5, { kind: "evidence", text: "Nothing else changed that night.", evidence: [{ label: "deploys.md", kind: "file", ref: "notes/deploys.md" }] }),
      finding(6, { kind: "ruled_out", hypothesisId: "h2", text: "Memory peaked at 40 percent.", evidence: [{ label: "Cluster metrics", kind: "url", ref: "https://example.com/metrics" }] }),
      finding(7, { kind: "root_cause", hypothesisId: "h1", text: "A new plan_type column broke the schema check.", confidence: "high" }),
      finding(8, { kind: "fix", text: "Added the column to the expected schema." }),
      finding(9, { kind: "verification", text: "The repair run loaded 1.2M rows." }),
      // Subagent findings stay out of the person's view.
      finding(10, { kind: "hypothesis", id: "h9", text: "Noise" }, { parentToolUseId: "sub-1" }),
    ];
    const result = investigationFrom(events);
    expect(result.count).toBe(8);
    expect(result.hypotheses.map((item) => [item.id, item.state])).toEqual([["h1", "confirmed"], ["h2", "ruled_out"]]);
    expect(result.hypotheses[0].evidence).toHaveLength(1);
    expect(result.hypotheses[0].evidence[0].refs.map((ref) => ref.kind)).toEqual(["run", "ticket"]);
    // The ruled-out reason appears once; its refs become chips on the hypothesis, not a second evidence line.
    expect(result.hypotheses[1].ruledOutBecause).toBe("Memory peaked at 40 percent.");
    expect(result.hypotheses[1].evidence).toHaveLength(0);
    expect(result.hypotheses[1].refs.map((ref) => ref.label)).toEqual(["Cluster metrics"]);
    expect(result.looseEvidence.map((item) => item.text)).toEqual(["Nothing else changed that night."]);
    expect(result.rootCause).toMatchObject({ text: "A new plan_type column broke the schema check.", confidence: "high", hypothesisId: "h1" });
    expect(result.fixes.map((item) => item.text)).toEqual(["Added the column to the expected schema."]);
    expect(result.verifications.map((item) => item.text)).toEqual(["The repair run loaded 1.2M rows."]);
    expect(result.inconclusive).toBeNull();
  });

  it("keeps the confirmed hypothesis first and records an inconclusive outcome", () => {
    const events: TaskEvent[] = [
      finding(1, { kind: "hypothesis", id: "a", text: "A" }),
      finding(2, { kind: "hypothesis", id: "b", text: "B" }),
      finding(3, { kind: "ruled_out", text: "A stray cause without a hypothesis." }),
      finding(4, { kind: "root_cause", hypothesisId: "b", text: "B did it.", confidence: "medium" }),
      finding(5, { kind: "inconclusive", text: "Logs for the window are gone." }),
      finding(6, { kind: "hypothesis", text: "   " }),
      { id: "x", taskId: "T-1", seq: 7, at: "2026-09-25T09:07:00Z", type: "tool.use", name: "mcp__nervecenter__record_finding", input: "not json" },
    ];
    const result = investigationFrom(events);
    expect(result.hypotheses.map((item) => [item.id, item.state])).toEqual([["b", "confirmed"], ["a", "open"], ["f-3", "ruled_out"]]);
    expect(result.inconclusive?.text).toBe("Logs for the window are gone.");
    expect(result.count).toBe(5);
    expect(investigationFrom([]).count).toBe(0);
  });

  it("sends each evidence chip to the right place", () => {
    expect(evidenceTarget({ label: "INC0031300", kind: "ticket", ref: "INC0031300" })).toEqual({ type: "route", to: "/tickets/INC0031300" });
    expect(evidenceTarget({ label: "Ticket OPS-1001", kind: "ticket", ref: null })).toEqual({ type: "route", to: "/tickets/OPS-1001" });
    expect(evidenceTarget({ label: "Run 900100826", kind: "run", ref: "900100826" })).toEqual({ type: "route", to: "/monitor?q=Run%20900100826" });
    expect(evidenceTarget({ label: "rca.md", kind: "file", ref: "rca.md" })).toEqual({ type: "file", path: "rca.md" });
    expect(evidenceTarget({ label: "Monitoring sources", kind: "knowledge", ref: "knowledge/helixa-commercial-ops-knowledge/platform/monitoring-sources.md" })).toEqual({ type: "route", to: "/knowledge?path=helixa-commercial-ops-knowledge%2Fplatform%2Fmonitoring-sources.md" });
    // A bare filename with no base segment used to route to a dead `/knowledge?file=` param; it now resolves via locateCitedPath.
    expect(evidenceTarget({ label: "Monitoring sources", kind: "knowledge", ref: "monitoring-sources.md" })).toEqual({ type: "route", to: "/knowledge?path=monitoring-sources.md" });
    expect(evidenceTarget({ label: "Vendor note", kind: "url", ref: "https://example.com/a" })).toEqual({ type: "url", href: "https://example.com/a" });
    expect(evidenceTarget({ label: "gold.nbrx_weekly", kind: "table", ref: "gold.nbrx_weekly" })).toEqual({ type: "none" });
  });
});
