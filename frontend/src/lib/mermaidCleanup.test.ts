import { sweepOrphanedMermaidElements } from "./mermaidCleanup";

describe("sweepOrphanedMermaidElements", () => {
  afterEach(() => { document.body.innerHTML = ""; });

  it("removes a mermaid error wrapper stuck directly on document.body", () => {
    const wrapper = document.createElement("div");
    wrapper.id = "dnc-mermaid-3";
    wrapper.innerHTML = "<svg><path class=\"error-icon\"></path></svg>";
    document.body.appendChild(wrapper);
    sweepOrphanedMermaidElements();
    expect(document.getElementById("dnc-mermaid-3")).toBeNull();
  });

  it("removes any body child bearing mermaid's error fingerprint, even without the id prefix", () => {
    const stray = document.createElement("svg");
    stray.innerHTML = "<path class=\"error-icon\"></path>";
    document.body.appendChild(stray);
    sweepOrphanedMermaidElements();
    expect(document.body.contains(stray)).toBe(false);
  });

  it("leaves ordinary app elements (like a Radix dialog portal) alone", () => {
    const root = document.createElement("div");
    root.id = "root";
    document.body.appendChild(root);
    const portal = document.createElement("div");
    portal.setAttribute("role", "dialog");
    portal.innerHTML = "<p>Some dialog content</p>";
    document.body.appendChild(portal);
    sweepOrphanedMermaidElements();
    expect(document.body.contains(root)).toBe(true);
    expect(document.body.contains(portal)).toBe(true);
  });
});
