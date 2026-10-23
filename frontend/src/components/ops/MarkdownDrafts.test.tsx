import { render, screen, within } from "@testing-library/react";
import { Markdown, splitDrafts } from "./Markdown";

const page = "# Pipeline failures\n\n## Schema change\n\nAdd the column.\n\n<!-- draft source=OPS-7 updated=2026-09-30 -->\n## Seen on finance_daily\n\nSame fix.\n<!-- /draft -->\n\n## Late file\n\nRerun later.\n";

describe("draft sections in knowledge pages", () => {
  it("splits a page at the agent's draft markers and reads their source", () => {
    const parts = splitDrafts(page);
    expect(parts.map((part) => part.draft)).toEqual([false, true, false]);
    expect(parts[1]).toMatchObject({ source: "OPS-7", updated: "2026-09-30" });
    expect(parts[1].text).toContain("## Seen on finance_daily");
    expect(splitDrafts("plain text")).toEqual([{ draft: false, text: "plain text" }]);
  });

  it("shows a draft section as a labelled callout and the rest as usual", () => {
    render(<Markdown>{page}</Markdown>);
    const draft = screen.getByRole("region", { name: "Draft section" });
    expect(within(draft).getByText(/Draft from Sonic · OPS-7 · 2026-09-30 · not reviewed yet/)).toBeInTheDocument();
    expect(within(draft).getByRole("heading", { name: "Seen on finance_daily" })).toBeInTheDocument();
    expect(within(draft).queryByRole("heading", { name: "Late file" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Late file" })).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("<!--");
  });
});
