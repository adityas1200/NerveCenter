import { splitHeadline } from "./turnHeadline";

// SPEC-tasks-10 FR-6: the reply's first sentence becomes the turn's headline.
describe("splitHeadline", () => {
  it("takes the first sentence and keeps the rest", () => {
    expect(splitHeadline("The load is recovered. Run 900001223 loaded 11,982 rows.\n\nNext, run the DQ checks.")).toEqual({ headline: "The load is recovered.", rest: "Run 900001223 loaded 11,982 rows.\n\nNext, run the DQ checks." });
    expect(splitHeadline("The fix is `plan_type` as a nullable STRING; tests pass.")).toEqual({ headline: "The fix is `plan_type` as a nullable STRING; tests pass.", rest: "" });
    expect(splitHeadline("Contract v1.2 dropped e.g. the npi column. Nothing else changed.")?.headline).toBe("Contract v1.2 dropped e.g. the npi column.");
    expect(splitHeadline("Confirmed pipeline failure:\nIQVIA added a 14th column. The fix is a contract change.")?.headline).toBe("Confirmed pipeline failure: IQVIA added a 14th column.");
  });
  it("finds no headline when the reply opens with structure or is too short or long", () => {
    for (const text of ["## Summary\n\nAll good.", "- one\n- two", "| a | b |\n|---|---|", "```sql\nselect 1\n```", "> quoted", "Done.", "", `${"word ".repeat(80)}end.`, "Two things changed:\n- the contract\n- the job"]) expect(splitHeadline(text)).toBeNull();
  });
});
