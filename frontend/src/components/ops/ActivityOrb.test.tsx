import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ActivityOrb } from "./ActivityOrb";

describe("ActivityOrb", () => {
  it("is decorative when a text label sits beside it", () => {
    const { container } = render(<span><ActivityOrb activity="system" />Querying Databricks</span>);
    const box = container.querySelector("[data-activity=system]");
    expect(box).not.toBeNull();
    expect(box?.querySelector("canvas")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("carries the label when it stands alone", () => {
    render(<ActivityOrb activity="ran" label="In progress" />);
    expect(screen.getByLabelText("In progress")).toBeInTheDocument();
  });

  it("defaults to generic work", () => {
    const { container } = render(<ActivityOrb />);
    expect(container.querySelector("[data-activity=tool]")).not.toBeNull();
  });
});
