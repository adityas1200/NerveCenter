import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ToastProvider } from "@/components/ui";
import { SkillsPage } from "./SkillsPage";
import { skillDisplayName, splitDescription } from "./skillText";
import { jsonResponse, mockFetch, renderWithClient } from "@/test/utils";

const skills = [
  { id: "plugin:rca", name: "rca", heading: "Investigate root cause", description: "Investigate an operational failure and produce an evidence-backed root-cause analysis. Use for failed jobs, pipelines and data-quality checks.", origin: "plugin" },
  { id: "plugin:tickets", name: "tickets", description: "Work tickets from the queue.", origin: "plugin" },
  { id: "custom:failure-summary", name: "failure-summary", description: "Summarise a failure in one paragraph.", origin: "custom" },
];
const tree = [{ name: "references", path: "references", type: "directory", children: [{ name: "checklist.md", path: "references/checklist.md", type: "file", size: 2048 }] }, { name: "SKILL.md", path: "SKILL.md", type: "file", size: 812 }];
const skillMd = "---\nname: rca\ndescription: Root-cause analysis for failed runs.\n---\n# Root cause analysis\n\nCompare the last good run with the first bad one. Read the [checklist](references/checklist.md) first.\n";
const checklist = "# Checklist\n\n- Last good run\n\nBack to [the skill](../SKILL.md).\n";

function renderAt(path: string, role = "admin") {
  mockFetch((url, init) => {
    if (url.includes("/api/me")) return jsonResponse({ user: { id: "admin.local", name: "Admin" }, role, permissions: [] });
    if (url.endsWith("/api/skills")) return jsonResponse({ items: skills });
    if (url.includes("/tree")) return jsonResponse({ id: "plugin:rca", items: tree });
    if (url.includes("/file?path=SKILL.md")) return jsonResponse({ path: "SKILL.md", size: 812, content: skillMd });
    if (url.includes("/file?path=references%2Fchecklist.md")) return jsonResponse({ path: "references/checklist.md", size: 2048, content: checklist });
    if (url.includes("/api/skills/upload") && init?.method === "POST") return jsonResponse({ id: "custom:new-skill", name: "new-skill", description: "", origin: "custom", files: 1, replaced: false }, 201);
    return jsonResponse({ items: [] });
  });
  return renderWithClient(<MemoryRouter initialEntries={[path]}><ToastProvider><Routes><Route path="/skills" element={<SkillsPage />} /><Route path="/skills/:skillId" element={<SkillsPage />} /></Routes></ToastProvider></MemoryRouter>);
}

describe("SkillsPage", () => {
  it("lists built-in and custom skills with readable names and descriptions, and follows relative links between skill files", async () => {
    renderAt("/skills");
    expect(await screen.findByRole("region", { name: "Built in skills" })).toBeInTheDocument();
    expect(screen.queryByText("2 built in · 1 custom")).not.toBeInTheDocument();
    expect(screen.queryByText(/plugin/i)).not.toBeInTheDocument();
    expect(screen.getAllByText("Built in")).toHaveLength(1); // the section label; cards no longer repeat it
    expect(screen.getByText("Investigate root cause")).toBeInTheDocument();
    expect(screen.getByText("Investigate an operational failure and produce an evidence-backed root-cause analysis.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload skill (zip)" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^RCA/ }));
    expect(await screen.findByRole("heading", { name: "Root cause analysis" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "RCA" })).toBeInTheDocument();
    expect(screen.getByText("When Sonic uses it")).toBeInTheDocument();
    expect(screen.getByText("Failed jobs, pipelines and data-quality checks.")).toBeInTheDocument();
    expect(screen.queryByText(/operations-fleet:/)).not.toBeInTheDocument();
    // Frontmatter is a properties header, not raw YAML.
    expect(within(screen.getByLabelText("Properties")).getByText("Root-cause analysis for failed runs.")).toBeInTheDocument();
    expect(screen.queryByText(/^name: rca/)).not.toBeInTheDocument();
    expect(screen.getByText("2.0 KB")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("link", { name: "checklist" }));
    expect(await screen.findByRole("heading", { name: "Checklist" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /checklist.md/ })).toHaveAttribute("aria-current", "true");
    fireEvent.click(screen.getByRole("link", { name: "the skill" }));
    expect(await screen.findByRole("heading", { name: "Root cause analysis" })).toBeInTheDocument();
  });

  it("puts a horizontal divider between the description and the files that moves up and down", async () => {
    renderAt("/skills/plugin%3Arca");
    const divider = await screen.findByRole("separator", { name: "Resize the description and the file list" });
    expect(divider).toHaveAttribute("aria-orientation", "horizontal");
    expect(divider).toHaveAttribute("aria-valuenow", "240");
    fireEvent.keyDown(divider, { key: "ArrowUp" });
    expect(divider).toHaveAttribute("aria-valuenow", "224");
    fireEvent.keyDown(divider, { key: "Home" });
    expect(divider).toHaveAttribute("aria-valuenow", "56");
    fireEvent.doubleClick(divider);
    expect(divider).toHaveAttribute("aria-valuenow", "240");
    // Description and files are both still there either side of it.
    expect(screen.getByText("When Sonic uses it")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /SKILL\.md/ })).toBeInTheDocument();
  });

  it("says when the description continues below the fold, and Show more opens it up", async () => {
    renderAt("/skills/plugin%3Arca");
    const divider = await screen.findByRole("separator", { name: "Resize the description and the file list" });
    const box = divider.previousElementSibling!.firstElementChild as HTMLElement;
    expect(screen.queryByRole("button", { name: /Show more/ })).not.toBeInTheDocument();
    // 500px of description in a 240px box.
    Object.defineProperty(box, "scrollHeight", { value: 500, configurable: true });
    Object.defineProperty(box, "clientHeight", { value: 240, configurable: true });
    fireEvent.scroll(box);
    fireEvent.click(await screen.findByRole("button", { name: /Show more/ }));
    expect(Number(divider.getAttribute("aria-valuenow"))).toBeGreaterThan(240);
  });

  it("filters to just one origin from the Filter menu, hiding the other section entirely", async () => {
    renderAt("/skills");
    await screen.findByRole("region", { name: "Built in skills" });
    expect(screen.getAllByText("Built in").length).toBeGreaterThan(0);
    expect(screen.getByText("Custom", { selector: "h2" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Filter skills" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Custom" }));

    expect(screen.queryByText("Built in")).not.toBeInTheDocument();
    expect(screen.getByText("Failure summary")).toBeInTheDocument();

    // Reset brings the built-in section back.
    await userEvent.click(screen.getByRole("button", { name: "Filter skills" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Reset filters and sort" }));
    expect(screen.getAllByText("Built in").length).toBeGreaterThan(0);
  });

  it("sorts the grid alphabetically and flips the order on the sort toggle", async () => {
    renderAt("/skills");
    await screen.findByRole("region", { name: "Built in skills" });
    const order = () => { const buttons = screen.getAllByRole("button"); return [buttons.findIndex((b) => b.textContent?.startsWith("RCA")), buttons.findIndex((b) => b.textContent?.startsWith("Tickets"))]; };
    const [rcaFirst, ticketsFirst] = order();
    expect(rcaFirst).toBeLessThan(ticketsFirst); // A → Z by default: RCA before Tickets

    fireEvent.click(screen.getByRole("button", { name: /Sorted A to Z/ }));
    const [rcaSecond, ticketsSecond] = order();
    expect(ticketsSecond).toBeLessThan(rcaSecond); // flipped to Z → A
  });

  it("hides upload for non-admins, shows Remove only for custom skills, and never shows a plugin prefix", async () => {
    renderAt("/skills/custom%3Afailure-summary", "developer");
    expect(await screen.findByRole("heading", { level: 1, name: "Failure summary" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Upload skill (zip)" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "More actions" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Custom")).toBeInTheDocument());
    expect(screen.queryByText(/operations-fleet/)).not.toBeInTheDocument();
  });
});

describe("skill text", () => {
  it("turns folder names into titles and splits what a skill does from when it is used", () => {
    expect(skillDisplayName("rca")).toBe("RCA");
    expect(skillDisplayName("failure-summary")).toBe("Failure summary");
    expect(skillDisplayName("operations-fleet:tickets")).toBe("Tickets");
    expect(splitDescription("Implement a fix. Use when an RCA identifies a defect in code.")).toEqual({ what: "Implement a fix.", when: "When an RCA identifies a defect in code." });
    expect(splitDescription("Research current information. Use whenever a task depends on vendor docs. Also use when the user asks to verify.")).toEqual({ what: "Research current information.", when: "Whenever a task depends on vendor docs. When the user asks to verify." });
    expect(splitDescription("Only what it does.")).toEqual({ what: "Only what it does.", when: "" });
  });
});
