import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { resolveTreeTarget } from "@/lib/fileTree";
import { parseFrontmatter } from "@/lib/frontmatter";
import { headingSlug, resolveLink } from "@/lib/markdownLinks";
import { citationFor, Markdown } from "./Markdown";

describe("resolveLink", () => {
  it("resolves relative links against the directory of the current file", () => {
    expect(resolveLink("runbooks/index.md", "./job-repair.md")).toEqual({ kind: "file", path: "runbooks/job-repair.md" });
    expect(resolveLink("runbooks/index.md", "job-repair.md")).toEqual({ kind: "file", path: "runbooks/job-repair.md" });
    expect(resolveLink("runbooks/index.md", "../index.md")).toEqual({ kind: "file", path: "index.md" });
    expect(resolveLink("index.md", "platform/")).toEqual({ kind: "file", path: "platform" });
    expect(resolveLink("a/b/c.md", "../../d/e.md#Some%20Section")).toEqual({ kind: "file", path: "d/e.md", anchor: "Some Section" });
    expect(resolveLink("SKILL.md", "references/causal-reasoning.md")).toEqual({ kind: "file", path: "references/causal-reasoning.md" });
    expect(resolveLink("a/b.md", "/top.md")).toEqual({ kind: "file", path: "top.md" });
    expect(resolveLink("a/b.md", "#steps")).toEqual({ kind: "anchor", anchor: "steps" });
    expect(resolveLink("index.md", "../other-base/x.md")).toEqual({ kind: "outside", href: "../other-base/x.md" });
    expect(resolveLink("index.md", "https://docs.databricks.com")).toEqual({ kind: "external", href: "https://docs.databricks.com" });
    expect(resolveLink("index.md", "mailto:ops@example.com")).toEqual({ kind: "external", href: "mailto:ops@example.com" });
  });

  it("slugs headings like GitHub", () => {
    expect(headingSlug("When to rerun")).toBe("when-to-rerun");
    expect(headingSlug("Step 2: repair (prod)")).toBe("step-2-repair-prod");
  });

  it("maps a link target to a file in the tree: files, folders, and paths without .md", () => {
    const tree = [
      { name: "runbooks", path: "runbooks", type: "directory" as const, children: [{ name: "index.md", path: "runbooks/index.md", type: "file" as const }, { name: "job-repair.md", path: "runbooks/job-repair.md", type: "file" as const }] },
      { name: "notes", path: "notes", type: "directory" as const, children: [{ name: "a.md", path: "notes/a.md", type: "file" as const }] },
      { name: "index.md", path: "index.md", type: "file" as const },
    ];
    expect(resolveTreeTarget(tree, "runbooks/job-repair.md")).toBe("runbooks/job-repair.md");
    expect(resolveTreeTarget(tree, "runbooks")).toBe("runbooks/index.md");
    expect(resolveTreeTarget(tree, "notes/")).toBe("notes/a.md");
    expect(resolveTreeTarget(tree, "runbooks/job-repair")).toBe("runbooks/job-repair.md");
    expect(resolveTreeTarget(tree, "")).toBe("index.md");
    expect(resolveTreeTarget(tree, "missing.md")).toBeNull();
  });
});

describe("parseFrontmatter", () => {
  it("reads scalars, inline and block lists, one-level mappings and block text", () => {
    const { properties, body } = parseFrontmatter("---\ntitle: \"Job repair\"\ntags: [a, b]\nowners:\n  - Priya\n  - Rahul\nverified:\n  by: human:x\n  at: 2026-09-15\nnotes: |\n  line one\n  line two\n---\n# Body\n");
    expect(properties).toEqual([["title", "Job repair"], ["tags", ["a", "b"]], ["owners", ["Priya", "Rahul"]], ["verified", [["by", "human:x"], ["at", "2026-09-15"]]], ["notes", "line one\nline two"]]);
    expect(body).toBe("# Body\n");
  });
});

describe("Markdown", () => {
  it("opens resolved relative links through onOpenFile, keeps external links in a new tab, and leaves task links as they were", () => {
    const opened: Array<[string, string | undefined]> = [];
    render(<Markdown currentPath="runbooks/index.md" onOpenFile={(path, anchor) => opened.push([path, anchor])} fileHref={(path) => `?file=${encodeURIComponent(path)}`}>{"[Up](../index.md) [Repair](./job-repair.md#when-to-rerun) [Docs](https://example.com) [Elsewhere](../../x.md)"}</Markdown>);
    const up = screen.getByRole("link", { name: "Up" });
    expect(up).toHaveAttribute("href", "?file=index.md");
    fireEvent.click(up);
    fireEvent.click(screen.getByRole("link", { name: "Repair" }));
    expect(opened).toEqual([["index.md", undefined], ["runbooks/job-repair.md", "when-to-rerun"]]);
    expect(screen.getByRole("link", { name: "Docs" })).toHaveAttribute("target", "_blank");
    expect(screen.queryByRole("link", { name: "Elsewhere" })).not.toBeInTheDocument();
    expect(screen.getByText("Elsewhere")).toHaveAttribute("title", "../../x.md is outside this folder");
  });

  it("gives headings anchors, numbering repeats", () => {
    const { container } = render(<Markdown>{"# When to rerun\n\n## Steps\n\n## Steps\n"}</Markdown>);
    expect(Array.from(container.querySelectorAll("[data-anchor]")).map((node) => node.getAttribute("data-anchor"))).toEqual(["when-to-rerun", "steps", "steps-1"]);
  });

  it("keeps the task-folder behaviour when no current path is given", () => {
    const opened: string[] = [];
    render(<Markdown onOpenFile={(path) => opened.push(path)}>{"[Report](tasks/T-1/report.md)"}</Markdown>);
    fireEvent.click(screen.getByRole("button", { name: "Report" }));
    expect(opened).toEqual(["report.md"]);
  });

  // The dark-theme stylesheet only retheme's a class it finds literally on the element (e.g.
  // `.bg-surface-subtle`); a class reaching an element only through a `[&_pre]:...` selector on an
  // ancestor is invisible to it and stays light. So these must carry their color/border/background
  // classes directly, not solely through the wrapper's nested-selector className.
  it("puts color, background and border classes directly on headings, code, tables and links, not only on the wrapper", () => {
    render(<Markdown currentPath="a.md">{"# Title\n\n**Bold**\n\n> Quoted\n\n---\n\n`inline`\n\n```\nblock\n```\n\n| A |\n|---|\n| 1 |\n\n[External](https://example.com)\n"}</Markdown>);
    expect(screen.getByRole("heading", { level: 1 })).toHaveClass("text-ink-1");
    expect(screen.getByText("Bold")).toHaveClass("text-ink-1");
    expect(screen.getByText("Quoted").closest("blockquote")).toHaveClass("border-line-strong", "text-ink-3");
    expect(document.querySelector("hr")).toHaveClass("border-line");
    expect(screen.getByText("inline").closest("code")).toHaveClass("bg-surface-subtle");
    expect(document.querySelector("pre")).toHaveClass("bg-surface-subtle", "border-line");
    expect(screen.getByRole("columnheader", { name: "A" })).toHaveClass("border-line");
    expect(screen.getByRole("cell", { name: "1" })).toHaveClass("border-line");
    expect(screen.getByRole("link", { name: "External" })).toHaveClass("text-brand");
  });
});

describe("citation chips", () => {
  it("recognises knowledge paths, ticket ids and run ids, and nothing else", () => {
    expect(citationFor("knowledge/runbooks/veltrix-load.md")).toMatchObject({ kind: "knowledge", path: "runbooks/veltrix-load.md", label: "veltrix-load.md", to: "/knowledge?path=runbooks%2Fveltrix-load.md" });
    expect(citationFor("runbooks/veltrix-load.md#when-to-rerun")).toMatchObject({ kind: "knowledge", path: "runbooks/veltrix-load.md", anchor: "when-to-rerun", title: "runbooks/veltrix-load.md#when-to-rerun" });
    expect(citationFor("OPS-42")).toMatchObject({ kind: "ticket", id: "OPS-42", to: "/tickets/OPS-42" });
    expect(citationFor("INC0012345")).toMatchObject({ kind: "ticket", id: "INC0012345" });
    expect(citationFor("CDO-7")).toMatchObject({ kind: "ticket", id: "CDO-7" });
    expect(citationFor("run 900100826")).toMatchObject({ kind: "run", id: "900100826", to: "/monitor?run=900100826" });
    expect(citationFor("900100826")).toBeNull();
    expect(citationFor("npm run build")).toBeNull();
    expect(citationFor("SELECT 1")).toBeNull();
    expect(citationFor("index.html")).toBeNull();
  });

  it("renders cited pages, tickets and runs in inline code and links as chips, but never inside code fences", () => {
    render(
      <MemoryRouter>
        <Markdown>{"See `knowledge/runbooks/veltrix-load.md` and [runbooks/veltrix-load.md](runbooks/veltrix-load.md#steps); ticket `OPS-42` failed in `run 900100826`.\n\n```\nOPS-99\n```\n\nPlain `SELECT 1` stays code."}</Markdown>
      </MemoryRouter>,
    );
    const chips = screen.getAllByRole("link");
    expect(chips.map((chip) => [chip.textContent, chip.getAttribute("href"), chip.getAttribute("title")])).toEqual([
      ["veltrix-load.md", "/knowledge?path=runbooks%2Fveltrix-load.md", "runbooks/veltrix-load.md"],
      ["veltrix-load.md", "/knowledge?path=runbooks%2Fveltrix-load.md#steps", "runbooks/veltrix-load.md#steps"],
      ["OPS-42", "/tickets/OPS-42", "Ticket OPS-42"],
      ["run 900100826", "/monitor?run=900100826", "Pipeline run 900100826"],
    ]);
    expect(chips[0].querySelector("svg")).not.toBeNull();
    expect(screen.getByText("OPS-99").closest("pre")).not.toBeNull();
    expect(screen.queryByRole("link", { name: "OPS-99" })).not.toBeInTheDocument();
    expect(screen.getByText("SELECT 1").tagName).toBe("CODE");
  });

  it("opens a cited page through onOpenKnowledge when the page can show knowledge itself, and keeps a link's own words", () => {
    const opened: Array<[string, string | undefined]> = [];
    render(<Markdown onOpenKnowledge={(path, anchor) => opened.push([path, anchor])}>{"Read [the load runbook](knowledge/runbooks/veltrix-load.md#steps)"}</Markdown>);
    const chip = screen.getByRole("button", { name: "the load runbook" });
    expect(chip).toHaveAttribute("title", "runbooks/veltrix-load.md#steps");
    fireEvent.click(chip);
    expect(opened).toEqual([["runbooks/veltrix-load.md", "steps"]]);
  });

  it("does not chip relative links inside a knowledge file being read", () => {
    render(<Markdown currentPath="runbooks/index.md" onOpenFile={() => {}} fileHref={(path) => `?file=${encodeURIComponent(path)}`}>{"[Repair](./job-repair.md)"}</Markdown>);
    const link = screen.getByRole("link", { name: "Repair" });
    expect(link).toHaveAttribute("href", "?file=runbooks%2Fjob-repair.md");
    expect(link).not.toHaveAttribute("data-citation");
  });
});
