import { formatBytes, mergeFiles, uploadProblem } from "./documentUploads";

const doc = (name: string, size = 10) => new File([new Uint8Array(size)], name);

describe("document uploads", () => {
  it("formats sizes in plain units", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(3.5 * 1024 * 1024)).toBe("3.5 MB");
  });

  it("leaves out unsupported files and replaces a file chosen again under the same name", () => {
    const first = doc("SOP.docx", 5);
    const result = mergeFiles([first, doc("notes.md")], [doc("sop.DOCX", 9), doc("diagram.png"), doc("deck.pptx")]);
    expect(result.files.map((file) => file.name)).toEqual(["notes.md", "sop.DOCX", "deck.pptx"]);
    expect(result.skipped).toEqual(["diagram.png"]);
  });

  it("names the problem with a selection before anything is uploaded", () => {
    expect(uploadProblem([])).toBeNull();
    expect(uploadProblem([doc("a.md")])).toBeNull();
    expect(uploadProblem([doc("a.md", 0)])).toBe("a.md is empty.");
    expect(uploadProblem(Array.from({ length: 51 }, (_, index) => doc(`d${index}.md`)))).toMatch(/at most 50/);
    expect(uploadProblem([doc("big.pdf", 26 * 1024 * 1024)])).toMatch(/smaller batches/);
  });
});
