import { inboxKeys } from "@/api/inbox";
import { queryKeys } from "@/api/queryKeys";
import { settingsKeys } from "@/api/settings";
import { taskKeys } from "@/api/tasks";

// Keys moved out of components keep their exact values: cached data and refreshes by prefix depend on them.

const startsWith = (key: readonly unknown[], prefix: readonly unknown[]) => prefix.every((part, index) => key[index] === part);

describe("query keys", () => {
  it("keep the values the components used inline", () => {
    const selection = { range: "24h" };
    expect(queryKeys.overview.group("tickets", selection)).toEqual(["overview", "tickets", selection]);
    expect(queryKeys.overview.group("data-quality", selection)).toEqual(["overview", "data-quality", selection]);
    expect(queryKeys.overview.work).toEqual(["overview", "work"]);
    expect(queryKeys.access).toEqual(["access"]);
    expect(queryKeys.auth.grantableNew).toEqual(["auth", "grantable-new"]);
    expect(queryKeys.auth.people("ali")).toEqual(["auth", "people", "ali"]);
    expect(queryKeys.projectMembers("p1")).toEqual(["projects", "settings", "p1", "members"]);
    expect(queryKeys.templates.presets).toEqual(["templates", "presets"]);
    expect(queryKeys.dataPlatform.tables("ord")).toEqual(["data-platform", "tables", { search: "ord" }]);
    expect(queryKeys.serviceNow.preview({ limit: 5 })).toEqual(["integrations", "servicenow", "preview", { limit: 5 }]);
    expect(queryKeys.jira.preview({ project: "OPS" })).toEqual(["integrations", "jira", "preview", { project: "OPS" }]);
    expect(settingsKeys.all).toEqual(["settings"]);
    expect(inboxKeys.all).toEqual(["inbox"]);
    expect(taskKeys.all).toEqual(["tasks"]);
  });

  it("sit under the prefixes that refreshes target", () => {
    expect(startsWith(queryKeys.overview.group("agent", null), queryKeys.overview.all)).toBe(true);
    expect(startsWith(queryKeys.overview.work, queryKeys.overview.all)).toBe(true);
    expect(startsWith(queryKeys.serviceNow.preview({}), queryKeys.serviceNow.all)).toBe(true);
    expect(startsWith(queryKeys.jira.preview({}), queryKeys.jira.all)).toBe(true);
    expect(startsWith(taskKeys.detail("T-1"), taskKeys.all)).toBe(true);
  });
});
