import { describe, expect, it } from "vitest";
import { activityOf } from "./stepLabels";

describe("activityOf", () => {
  it.each([
    ["Read", "read"],
    ["Glob", "search"],
    ["Grep", "search"],
    ["Bash", "ran"],
    ["PowerShell", "ran"],
    ["WebSearch", "web"],
    ["WebFetch", "web"],
    ["Write", "writing"],
    ["Edit", "writing"],
    ["TodoWrite", "plan"],
    ["mcp__nervecenter__propose_plan", "plan"],
    ["mcp__nervecenter__update_plan", "plan"],
    ["mcp__nervecenter__list_tickets", "search"],
    ["mcp__nervecenter__comment_on_ticket", "tool"],
    ["mcp__nervecenter__show_table", "tool"],
    ["mcp__databricks__execute_sql", "system"],
    ["mcp__servicenow-mcp__get_incident", "system"],
    ["Task", "tool"],
    ["", "tool"],
    [null, "tool"],
  ])("maps %s to %s", (name, expected) => {
    expect(activityOf(name)).toBe(expected);
  });
});
