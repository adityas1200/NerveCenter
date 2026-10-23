import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Markdown } from "@/components/ops/Markdown";

// Links in a task file in a subfolder open from that folder, not the task folder's root (T-1137: pipeline-and-dq/index.md -> l2-model.md).
describe("Markdown taskFilePath", () => {
  const renderFile = (body: string) => {
    const opened: string[] = [];
    render(<Markdown taskFilePath="pipeline-and-dq/index.md" onOpenFile={(path) => opened.push(path)} resolveAsset={(src) => `/raw?path=${src}`}>{body}</Markdown>);
    return opened;
  };

  it("resolves a bare or ./ link against the file's own folder", () => {
    const opened = renderFile("[L2](l2-model.md) [L1](./l1-standardization.md#rules)");
    fireEvent.click(screen.getByRole("button", { name: "L2" }));
    fireEvent.click(screen.getByRole("button", { name: "L1" }));
    expect(opened).toEqual(["pipeline-and-dq/l2-model.md", "pipeline-and-dq/l1-standardization.md"]);
  });

  it("keeps tasks/<id>/ and / links on the task folder, and climbs with ../", () => {
    const opened = renderFile("[Report](tasks/T-1137/report.md) [Root](/summary.md) [Up](../overview.md)");
    for (const name of ["Report", "Root", "Up"]) fireEvent.click(screen.getByRole("button", { name }));
    expect(opened).toEqual(["report.md", "summary.md", "overview.md"]);
  });

  it("does not offer a link above the task folder", () => {
    renderFile("[Out](../../secrets.md)");
    expect(screen.queryByRole("button", { name: "Out" })).toBeNull();
    expect(screen.getByText("Out")).toBeInTheDocument();
  });

  it("loads images from the file's folder", () => {
    renderFile("![Lineage](img/lineage.png)");
    expect(screen.getByRole("img", { name: "Lineage" })).toHaveAttribute("src", "/raw?path=pipeline-and-dq/img/lineage.png");
  });

  it("without taskFilePath, links stay task-folder paths as before", () => {
    const opened: string[] = [];
    render(<Markdown onOpenFile={(path) => opened.push(path)}>{"[L2](l2-model.md)"}</Markdown>);
    fireEvent.click(screen.getByRole("button", { name: "L2" }));
    expect(opened).toEqual(["l2-model.md"]);
  });
});
