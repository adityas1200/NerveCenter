import { layoutFlow } from "@/components/ops/flowLayout";
import { cardFrom, queryCardFrom } from "./cards/cards";

// Kept from the Journey tab's tests (SPEC-tasks-10 removed the tab): the card parsers and the flow layout the lineage card uses.
const nc = (tool: string) => `mcp__nervecenter__${tool}`;

describe("cards drawn from Sonic's tools", () => {
  it("reads a lineage, keeping only edges between known nodes", () => {
    const card = cardFrom({ type: "tool.use", name: nc("show_lineage"), input: JSON.stringify({ title: "L", focus: "b", nodes: [{ id: "a" }, { id: "b", status: "failed", kind: "job" }], edges: [{ from: "a", to: "b" }, { from: "a", to: "zz" }] }) });
    expect(card).toMatchObject({ kind: "lineage", focus: "b", edges: [{ from: "a", to: "b", label: null }] });
    if (card?.kind === "lineage") expect(card.nodes[1]).toMatchObject({ label: "b", kind: "job", status: "failed" });
  });

  it("counts a change's added and removed lines", () => {
    const card = cardFrom({ type: "tool.use", name: nc("show_change"), input: JSON.stringify({ title: "Fix", files: [{ path: "a.sql", diff: "--- a/a.sql\n+++ b/a.sql\n@@ -1 +1 @@\n-old\n+new\n+more" }], link: "javascript:alert(1)" }) });
    expect(card).toMatchObject({ kind: "change", state: "proposed", link: null, files: [{ path: "a.sql", additions: 2, deletions: 1 }] });
  });

  it("reads a query and the rows that came back, or its error", () => {
    const call = { type: "tool.use" as const, name: nc("query_data"), input: JSON.stringify({ statement: "select a from cat.s.t join `x`.`y` on 1=1", provider: "databricks" }) };
    expect(queryCardFrom(call, { content: JSON.stringify({ columns: [{ name: "a" }], rows: [{ a: 1 }], rowCount: 1, durationMs: 9 }), isError: false })).toMatchObject({ tables: ["cat.s.t", "x.y"], result: { columns: ["a"], rows: [[1]], rowCount: 1, durationMs: 9, error: null } });
    expect(queryCardFrom(call, { content: "Error: Only SELECT statements", isError: true })?.result?.error).toBe("Only SELECT statements");
  });
});

describe("layoutFlow", () => {
  it("places nodes one column after their furthest parent and centres short columns", () => {
    const { positions, columns, rows } = layoutFlow([{ id: "a", title: "a" }, { id: "b", title: "b" }, { id: "c", title: "c" }, { id: "d", title: "d" }], [{ from: "a", to: "b" }, { from: "a", to: "c" }, { from: "b", to: "d" }, { from: "c", to: "d" }]);
    expect(columns).toBe(3); expect(rows).toBe(2);
    expect(positions.get("a")).toEqual({ column: 0, row: 0.5 });
    expect(positions.get("d")).toEqual({ column: 2, row: 0.5 });
  });

  it("survives a cycle", () => {
    const { columns } = layoutFlow([{ id: "a", title: "a" }, { id: "b", title: "b" }], [{ from: "a", to: "b" }, { from: "b", to: "a" }]);
    expect(columns).toBeGreaterThan(0);
  });
});
