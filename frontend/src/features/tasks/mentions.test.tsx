import { fireEvent, screen, waitFor } from "@testing-library/react";
import { insertMention, mentionAt, mentionsIn, rankMentions, typedTable, type Mention } from "./mentions";
import { TaskComposer } from "./TaskComposer";
import { jsonResponse, mockFetch, renderWithClient } from "@/test/utils";

const ticket: Mention = { kind: "ticket", id: "OPS-12", label: "INC0012", title: "Sales load failed" };
const pipeline: Mention = { kind: "pipeline", id: "731", label: "veltrix_sales_daily_load" };
const table: Mention = { kind: "table", id: "commercial.silver.sales_fact", label: "commercial.silver.sales_fact" };

describe("@ mention text handling", () => {
  it("finds the @word before the caret only at a word start", () => {
    expect(mentionAt("why did @INC", 12)).toEqual({ start: 8, term: "INC" });
    expect(mentionAt("@", 1)).toEqual({ start: 0, term: "" });
    expect(mentionAt("mail me@zs.com", 14)).toBeNull();
    expect(mentionAt("why did @INC0012 fail", 21)).toBeNull();
  });

  it("replaces the typed @word with the label and a space", () => {
    expect(insertMention("why did @IN fail", 8, 11, "INC0012")).toEqual({ text: "why did @INC0012 fail", caret: 17 });
    expect(insertMention("look at @sal", 8, 12, "commercial.silver.sales_fact")).toEqual({ text: "look at @commercial.silver.sales_fact ", caret: 38 });
  });

  it("keeps only the picked records still written in the text", () => {
    expect(mentionsIn("why did @INC0012 fail?", [ticket, pipeline, ticket])).toEqual([ticket]);
    expect(mentionsIn("check @commercial.silver.sales_fact.", [table])).toEqual([table]);
    expect(mentionsIn("why did @INC00123 fail", [ticket])).toEqual([]);
  });

  it("ranks label prefixes first, matches table name parts and titles, and groups by kind", () => {
    expect(rankMentions("sales", [ticket, pipeline, table]).map((item) => item.id)).toEqual(["OPS-12", "731", "commercial.silver.sales_fact"]);
    expect(rankMentions("inc", [pipeline, ticket]).map((item) => item.id)).toEqual(["OPS-12"]);
    expect(rankMentions("", [table, ticket]).map((item) => item.kind)).toEqual(["ticket", "table"]);
    expect(typedTable("silver.sales_fact")?.id).toBe("silver.sales_fact");
    expect(typedTable("sales_fact")).toBeNull();
  });
});

describe("TaskComposer @ menu", () => {
  beforeEach(() => {
    mockFetch((url) => {
      if (url.includes("/api/tickets")) return jsonResponse({ items: [{ ticketId: "OPS-12", title: "Sales load failed", status: "open", externalReference: { number: "INC0012" }, updatedAt: "2026-10-03T08:00:00Z" }] });
      if (url.includes("/api/pipelines")) return jsonResponse({ items: [{ pipelineId: "731", name: "veltrix_sales_daily_load", status: "failed", platform: "databricks" }] });
      if (url.includes("/api/data-platform/tables")) return jsonResponse({ error: "Set a Unity Catalog catalog and schema to browse Databricks tables" }, 400);
      return jsonResponse({ items: [] });
    });
  });
  function renderComposer(onSend: (text: string, mentions: Mention[]) => void) {
    renderWithClient(<TaskComposer mentions onSend={onSend} placeholder="Ask Sonic" />);
    return screen.getByRole("textbox", { name: "Ask Sonic" }) as HTMLTextAreaElement;
  }
  const type = (box: HTMLTextAreaElement, value: string) => { fireEvent.change(box, { target: { value, selectionStart: value.length, selectionEnd: value.length } }); };

  it("offers tickets and pipelines after @, inserts the pick and sends it with the message", async () => {
    const onSend = vi.fn();
    const box = renderComposer(onSend);
    type(box, "why did @veltrix");
    expect(await screen.findByRole("option", { name: /veltrix_sales_daily_load/ })).toBeInTheDocument();
    fireEvent.keyDown(box, { key: "Enter" });
    expect(box.value).toBe("why did @veltrix_sales_daily_load ");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(onSend).toHaveBeenCalledWith("why did @veltrix_sales_daily_load", [expect.objectContaining({ kind: "pipeline", id: "731" })]));
  });

  it("offers a typed table name when the platform cannot list tables, and Esc closes the menu", async () => {
    const onSend = vi.fn();
    const box = renderComposer(onSend);
    type(box, "is @silver.sales_fact");
    expect(await screen.findByRole("option", { name: /silver\.sales_fact.*Use this name/ })).toBeInTheDocument();
    fireEvent.keyDown(box, { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(onSend).toHaveBeenCalledWith("is @silver.sales_fact", []));
  });
});
