import { cleanup, render, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { PageHeaderOutletContext, PageTitleOutletContext } from "@/components/layout/PageHeaderOutlet";
import { PageHeader } from "./PageHeader";

describe("PageHeader action placement", () => {
  afterEach(() => { cleanup(); document.querySelectorAll("[data-test-outlet]").forEach((node) => node.remove()); });

  it("SPEC-platform-15 FR-3: puts page actions beside a large content title", () => {
    const shell = document.createElement("div");
    const title = document.createElement("div");
    shell.dataset.testOutlet = ""; title.dataset.testOutlet = "";
    document.body.append(shell, title);
    render(<MemoryRouter><PageHeaderOutletContext.Provider value={shell}><PageTitleOutletContext.Provider value={title}><PageHeader title="Inbox" actions={<button>Refresh</button>} /></PageTitleOutletContext.Provider></PageHeaderOutletContext.Provider></MemoryRouter>);

    expect(within(title).getByRole("heading", { name: "Inbox" })).toBeInTheDocument();
    expect(within(title).getByRole("button", { name: "Refresh" })).toBeInTheDocument();
    expect(within(shell).queryByRole("button", { name: "Refresh" })).not.toBeInTheDocument();
  });

  it("keeps controls in the shell for compact pages", () => {
    const shell = document.createElement("div");
    const title = document.createElement("div");
    shell.dataset.testOutlet = ""; title.dataset.testOutlet = "";
    document.body.append(shell, title);
    render(<MemoryRouter><PageHeaderOutletContext.Provider value={shell}><PageTitleOutletContext.Provider value={title}><PageHeader title="Task" compact actions={<button>Details</button>} /></PageTitleOutletContext.Provider></PageHeaderOutletContext.Provider></MemoryRouter>);

    expect(within(shell).getByRole("button", { name: "Details" })).toBeInTheDocument();
    expect(within(title).queryByRole("button", { name: "Details" })).not.toBeInTheDocument();
  });
});
