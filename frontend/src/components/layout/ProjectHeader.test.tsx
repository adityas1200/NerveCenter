import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TooltipProvider } from "@/components/ui";
import { ProjectHeader } from "@/components/layout/ProjectHeader";
import { ProjectContext, type ProjectContextValue } from "@/lib/projectContext";
import { renderWithClient } from "@/test/utils";

// SPEC-projects-03 FR-14 (amended 2026-10-06): the sidebar names the project and leads back to Home; there is no menu.
const alpha = { id: "alpha", name: "Alpha", slug: "alpha", role: "owner" as const, archived: false };
const base: ProjectContextValue = { projectId: "alpha", slug: "alpha", project: alpha, projects: [alpha], isGlobalAdmin: false, unrouted: 0, visitor: false, setProject: () => {} };
const show = (value: Partial<ProjectContextValue>, collapsed = false) => renderWithClient(<TooltipProvider><ProjectContext.Provider value={{ ...base, ...value }}><ProjectHeader collapsed={collapsed} /></ProjectContext.Provider></TooltipProvider>);

describe("ProjectHeader", () => {
  it("names the project and links back to Projects on Home, with no project menu", () => {
    show({});
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Projects" }).getAttribute("href")).toMatch(/\/$/);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("shows the role only when it limits you", () => {
    const { unmount } = show({});
    expect(screen.queryByText("Owner")).not.toBeInTheDocument();
    unmount();
    const viewer = { ...alpha, role: "viewer" as const };
    const second = show({ project: viewer, projects: [viewer] });
    expect(screen.getByText("Viewer")).toBeInTheDocument();
    second.unmount();
    const open = { ...alpha, role: "open" as const };
    show({ project: open, projects: [open], visitor: true });
    expect(screen.getByText("View only")).toBeInTheDocument();
  });

  it("names the Unrouted queue as read only", () => {
    show({ projectId: "unrouted", slug: "unrouted", project: null, isGlobalAdmin: true });
    expect(screen.getByText("Unrouted")).toBeInTheDocument();
    expect(screen.getByText("Read only")).toBeInTheDocument();
  });

  it("collapses to the project tile, which leads back to Projects", () => {
    show({}, true);
    expect(screen.getByRole("link", { name: "Alpha. Back to projects" }).getAttribute("href")).toMatch(/\/$/);
  });

  it("renders nothing without a project", () => {
    const { container } = show({ projectId: null, slug: null, project: null });
    expect(container).toBeEmptyDOMElement();
  });
});
