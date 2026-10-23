import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ActionsCard } from "./ActionsCard";
import { TaskActionsContext } from "./taskActions";

describe("ActionsCard navigation cues", () => {
  it("SPEC-platform-15 FR-1/FR-2: describes same-app actions and marks external destinations", () => {
    const block = { kind: "actions" as const, title: "", questions: [], items: [
      { kind: "open" as const, label: "View ticket", href: "/tickets/OPS-7", prompt: null, detail: null, needsApproval: false },
      { kind: "open" as const, label: "Open local ticket", href: `${window.location.origin}/tickets/OPS-8`, prompt: null, detail: null, needsApproval: false },
      { kind: "open" as const, label: "Open in Jira", href: "https://jira.example.test/browse/OPS-7", prompt: null, detail: null, needsApproval: false },
    ] };
    const { container } = render(<MemoryRouter><TaskActionsContext.Provider value={{ canAsk: false }}><ActionsCard block={block} /></TaskActionsContext.Provider></MemoryRouter>);

    const internal = screen.getByRole("link", { name: "View ticket" });
    const sameOrigin = screen.getByRole("link", { name: "Open local ticket" });
    const external = screen.getByRole("link", { name: "Open in Jira" });
    expect(internal.querySelector("svg")?.getAttribute("class")).toContain("lucide-eye");
    expect(sameOrigin.querySelector("svg")?.getAttribute("class")).toContain("lucide-eye");
    expect(sameOrigin).not.toHaveAttribute("target", "_blank");
    expect(external.querySelector("svg")?.getAttribute("class")).toContain("lucide-external-link");
    expect(external).toHaveAttribute("target", "_blank");
    expect(container.querySelectorAll("a")).toHaveLength(3);
  });
});
