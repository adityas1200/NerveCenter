import { fireEvent, render, screen } from "@testing-library/react";
import { EmptyState } from "./EmptyState";
import { ErrorNotice } from "./ErrorNotice";
import { SurfaceCard } from "./SurfaceCard";

describe("EmptyState", () => {
  it("renders the title, body, action and a single-stroke line drawing", () => {
    const onClick = vi.fn();
    const { container } = render(<EmptyState illustration="inbox" title="Nothing waiting on you" body="Approvals land here." action={<button type="button" onClick={onClick}>Ask Sonic</button>} />);
    expect(screen.getByText("Nothing waiting on you")).toBeInTheDocument();
    expect(screen.getByText("Approvals land here.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ask Sonic" }));
    expect(onClick).toHaveBeenCalled();
    const svg = container.querySelector("svg[data-illustration=inbox]");
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute("width", "96");
    expect(svg).toHaveAttribute("fill", "none");
    expect(svg).toHaveAttribute("stroke", "currentColor");
    expect(svg).toHaveAttribute("aria-hidden", "true");
  });

  it("draws one figure per illustration name and nothing when none is asked for", () => {
    for (const kind of ["tasks", "inbox", "checks", "pipelines", "knowledge", "search"] as const) {
      const { container, unmount } = render(<EmptyState illustration={kind} title={kind} />);
      const svg = container.querySelector(`svg[data-illustration=${kind}]`)!;
      expect(svg.children.length).toBeGreaterThan(0);
      expect(container.querySelector("[fill]:not([fill=none])")).toBeNull();
      unmount();
    }
    const { container } = render(<EmptyState title="Plain" />);
    expect(container.querySelector("svg")).toBeNull();
  });
});

describe("ErrorNotice", () => {
  it("shows what, why and next as an alert, with the raw detail behind Details", () => {
    render(<ErrorNotice what="NerveCenter could not load this page." why="The connected platform rejected the access token." next={<button type="button">Try again</button>} detail="Databricks GET /api/2.2/jobs failed (403)" />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("NerveCenter could not load this page.");
    expect(alert).toHaveTextContent("The connected platform rejected the access token.");
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.getByText("Details")).toBeInTheDocument();
    expect(screen.getByText(/failed \(403\)/).closest("details")).not.toHaveAttribute("open");
  });

  it("leaves out Details when there is no raw message", () => {
    render(<ErrorNotice what="The ticket was not created." why="Jira rejected the request." />);
    expect(screen.queryByText("Details")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Jira rejected the request.");
  });
});

describe("SurfaceCard", () => {
  it("draws a label row and the body, and takes the amber border for a warning", () => {
    const { container, rerender } = render(<SurfaceCard label="Proposed change" note="Command" actions={<button type="button">Hide</button>}>body</SurfaceCard>);
    expect(screen.getByText("Proposed change")).toBeInTheDocument();
    expect(screen.getByText("Command")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hide" })).toBeInTheDocument();
    expect(container.firstElementChild).toHaveAttribute("data-tone", "default");
    expect(container.firstElementChild?.className).toContain("border-line");
    rerender(<SurfaceCard tone="warning">body</SurfaceCard>);
    expect(container.firstElementChild).toHaveAttribute("data-tone", "warning");
    expect(container.firstElementChild?.className).toContain("border-amber-300");
  });
});
