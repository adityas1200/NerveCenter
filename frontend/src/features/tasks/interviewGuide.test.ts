import { describe, expect, it } from "vitest";
import type { GuideQuestion } from "@/api/tasks";
import { groupGuide, guideCounts, guideMarkdown } from "./interviewGuide";

// SPEC-knowledge-03 FR-8: grouping, counts and the Markdown the build lead takes into the interview.

const question = (id: string, patch: Partial<GuideQuestion> = {}): GuideQuestion => ({ id, theme: "Orchestration", question: `Question ${id}?`, why: "", evidence: [], audience: "", priority: "medium", status: "open", answer: "", cites: [], pages: [], round: 1, updatedAt: null, ...patch });

describe("interview guide helpers", () => {
  const questions = [
    question("G-1", { theme: "Ownership", priority: "low" }),
    question("G-2", { status: "answered", answer: "Data Ops." }),
    question("G-3", { theme: "Sales load", priority: "high", audience: "Ops lead", why: "Two reruns with no cause.", evidence: [{ label: "INC-4821", href: "/tickets/OPS-4821" }, { label: "Run log", href: "https://example.com/run/1" }] }),
    question("G-10", { theme: "Sales load", status: "partly", answer: "Late file, sometimes.", round: 2 }),
    question("G-4", { status: "dropped" }),
  ];

  it("counts by status, open first, only the statuses that have questions", () => {
    expect(guideCounts(questions)).toEqual([{ status: "open", count: 2 }, { status: "partly", count: 1 }, { status: "answered", count: 1 }, { status: "dropped", count: 1 }]);
  });

  it("puts the theme with the most urgent question first, high priority then id inside a theme", () => {
    const groups = groupGuide(questions);
    expect(groups.map((group) => group.theme)).toEqual(["Sales load", "Orchestration", "Ownership"]);
    expect(groups[0].questions.map((item) => item.id)).toEqual(["G-3", "G-10"]);
    expect(groups[1].questions.map((item) => item.id)).toEqual(["G-2", "G-4"]);
  });

  it("still to ask keeps open and partly answered questions only", () => {
    expect(groupGuide(questions, true).flatMap((group) => group.questions.map((item) => item.id))).toEqual(["G-3", "G-10", "G-1"]);
  });

  it("writes the open questions with ids to say aloud, audience, why and evidence as full links", () => {
    const markdown = guideMarkdown({ questions, updatedAt: null }, { title: "Interview guide: Team knowledge", origin: "https://nc.example.com" });
    expect(markdown).toContain("# Interview guide: Team knowledge");
    expect(markdown).toContain('Say each question\'s id aloud (for example "G-7")');
    expect(markdown).toContain("## Sales load");
    expect(markdown).toContain("**G-3** · high priority · ask: Ops lead\n\nQuestion G-3?");
    expect(markdown).toContain("- Why: Two reruns with no cause.");
    expect(markdown).toContain("- Evidence: INC-4821 (https://nc.example.com/tickets/OPS-4821)");
    expect(markdown).toContain("- Evidence: Run log (https://example.com/run/1)");
    expect(markdown).toContain("**G-10** · round 2 · partly answered");
    expect(markdown).toContain("- So far: Late file, sometimes.");
    expect(markdown).not.toContain("G-2");
    expect(markdown).not.toContain("G-4");
  });

  it("says so when nothing is left to ask", () => {
    expect(guideMarkdown({ questions: [question("G-1", { status: "answered" })], updatedAt: null })).toContain("No open questions.");
  });
});
