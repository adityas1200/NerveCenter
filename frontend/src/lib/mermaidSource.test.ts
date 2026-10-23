import { sanitizeMermaidSource } from "./mermaidSource";

describe("sanitizeMermaidSource", () => {
  it("converts smart quotes to straight quotes, a common paste artifact that breaks Mermaid's parser", () => {
    expect(sanitizeMermaidSource('A["Cost: “high”"]')).toBe('A["Cost: "high""]');
    expect(sanitizeMermaidSource("A[‘low’]")).toBe("A['low']");
  });

  it("strips a stray leading/trailing code fence if one ever leaks through", () => {
    expect(sanitizeMermaidSource("```mermaid\nflowchart TD\nA --> B\n```")).toBe("flowchart TD\nA --> B");
    expect(sanitizeMermaidSource("```\nflowchart TD\nA --> B\n```")).toBe("flowchart TD\nA --> B");
  });

  it("replaces a non-breaking space with a plain one", () => {
    expect(sanitizeMermaidSource("flowchart TD\nA --> B")).toBe("flowchart TD\nA --> B");
  });

  it("escapes clock-time colons in a timeline so they are not read as the period/event separator", () => {
    const source = "timeline\n  title Run history\n  2026-09-30 10:34 : Run timed out at 10:34:12\n  2026-09-30 11:02 : Retry succeeded";
    expect(sanitizeMermaidSource(source)).toBe(
      "timeline\n  title Run history\n  2026-09-30 10∶34 : Run timed out at 10∶34∶12\n  2026-09-30 11∶02 : Retry succeeded",
    );
  });

  it("finds the timeline header after front matter and comments, and keeps accTitle and comments intact", () => {
    const source = "---\nconfig:\n  theme: neutral\n---\n%% note: x\ntimeline\n  accTitle: Runs\n  %% a:b\n  10:34 : Failed";
    expect(sanitizeMermaidSource(source)).toBe("---\nconfig:\n  theme: neutral\n---\n%% note: x\ntimeline\n  accTitle: Runs\n  %% a:b\n  10∶34 : Failed");
  });

  it("leaves colons alone in other diagram types", () => {
    expect(sanitizeMermaidSource('flowchart TD\nA["At 10:34"] --> B')).toBe('flowchart TD\nA["At 10:34"] --> B');
    expect(sanitizeMermaidSource("sequenceDiagram\nA->>B: ping at 10:34")).toBe("sequenceDiagram\nA->>B: ping at 10:34");
  });

  it("trims surrounding whitespace and leaves already-clean source untouched", () => {
    expect(sanitizeMermaidSource("  flowchart TD\nA --> B  \n")).toBe("flowchart TD\nA --> B");
  });
});
