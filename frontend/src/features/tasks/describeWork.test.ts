import { becauseOf } from "./describeWork";

describe("becauseOf", () => {
  it("turns the agent's reason into a 'because' clause once", () => {
    expect(becauseOf("The repair run succeeded.")).toBe("because the repair run succeeded");
    expect(becauseOf("Because the mart is fresh")).toBe("because the mart is fresh");
    expect(becauseOf("  ")).toBeNull();
    expect(becauseOf(null)).toBeNull();
  });
});
