import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { joinResource, splitResource, type Operations } from "@/api/settings";
import { ToastProvider } from "@/components/ui";
import { PolicyTab } from "./PolicyTab";
import { createTestQueryClient, mockFetch, renderWithClient } from "@/test/utils";

/**
 * Exceptions narrow or widen one policy answer for particular resources, the way a statement in an
 * IAM policy document does. The four dropdowns build the `system:environment:type:name` pattern so
 * what lands in operations.yaml is always well formed.
 */

const operations: Operations = {
  team: { name: "Data Operations", timezone: "UTC" },
  platforms: [
    { name: "commercial-databricks", type: "databricks", environments: { prod: { workspace: "https://adb-prod.net" }, dev: { workspace: "https://adb-dev.net" } } },
    { name: "warehouse", type: "snowflake", environments: { prod: { account: "acme.eu" } } },
  ],
  policy: { default_write: "allow", production_changes: "ask" },
};

function renderPolicy(ops: Operations = operations) {
  const calls: unknown[] = [];
  mockFetch((url, init) => {
    if (init?.body) calls.push(JSON.parse(String(init.body)));
    return Promise.resolve(new Response(JSON.stringify({ categories: [] }), { status: 200, headers: { "content-type": "application/json" } }));
  });
  renderWithClient(<ToastProvider><PolicyTab operations={ops} /></ToastProvider>);
  return calls;
}

describe("policy exceptions", () => {
  it("splits and rejoins a resource, dropping the trailing wildcards that add nothing", () => {
    expect(splitResource("databricks:prod:job:customer_*")).toEqual({ system: "databricks", environment: "prod", type: "job", name: "customer_*" });
    expect(splitResource("databricks")).toEqual({ system: "databricks", environment: "*", type: "*", name: "*" });
    expect(splitResource("")).toEqual({ system: "*", environment: "*", type: "*", name: "*" });
    expect(joinResource({ system: "databricks", environment: "prod", type: "*", name: "*" })).toBe("databricks:prod");
    expect(joinResource({ system: "*", environment: "*", type: "*", name: "*" })).toBe("*");
    expect(joinResource({ system: "*", environment: "*", type: "recipient", name: "*@x.com" })).toBe("*:*:recipient:*@x.com");
  });

  it("says plainly that nothing is scoped when there are no exceptions", () => {
    renderPolicy();
    expect(screen.getByText("No exceptions. The answers above apply everywhere.")).toBeInTheDocument();
  });

  it("offers the environments configured in operations.yaml, not a fixed list", async () => {
    renderPolicy();
    await userEvent.click(screen.getByRole("button", { name: "Add exception" }));
    await userEvent.click(screen.getByRole("combobox", { name: "Exception 1 environment" }));
    const names = (await screen.findAllByRole("option")).map((option) => option.textContent);
    expect(names).toEqual(["Any environment", "prod", "dev"]);
  });

  it("builds the resource pattern from the dropdowns and shows what will be saved", async () => {
    const calls = renderPolicy();
    await userEvent.click(screen.getByRole("button", { name: "Add exception" }));

    const pick = async (label: string, option: string) => {
      await userEvent.click(screen.getByRole("combobox", { name: label }));
      await userEvent.click(await screen.findByRole("option", { name: option }));
    };
    await pick("Exception 1 system", "Databricks");
    await pick("Exception 1 environment", "prod");
    await pick("Exception 1 kind", "Job");
    // The box starts empty because the stored pattern is `*`: every job.
    expect(screen.getByRole("textbox", { name: "Exception 1 name pattern" })).toHaveValue("");
    await userEvent.type(screen.getByRole("textbox", { name: "Exception 1 name pattern" }), "customer_*");
    await userEvent.type(screen.getByRole("textbox", { name: "Exception 1 reason" }), "never in production");

    expect(screen.getByText("databricks:prod:job:customer_*")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(calls.at(-1)).toMatchObject({
      default_write: "allow",
      production_changes: "ask",
      rules: [{ effect: "deny", action: "production_changes", resource: "databricks:prod:job:customer_*", description: "never in production" }],
    });
  });

  it("hides the name box while the rule covers every kind of object", async () => {
    renderPolicy();
    await userEvent.click(screen.getByRole("button", { name: "Add exception" }));
    expect(screen.queryByRole("textbox", { name: "Exception 1 name pattern" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("combobox", { name: "Exception 1 kind" }));
    await userEvent.click(await screen.findByRole("option", { name: "Table" }));
    expect(screen.getByRole("textbox", { name: "Exception 1 name pattern" })).toBeInTheDocument();
  });

  it("removes an exception without touching the others", async () => {
    const ops: Operations = { ...operations, policy: { ...operations.policy, rules: [
      { effect: "deny", action: "production_changes", resource: "databricks:prod" },
      { effect: "allow", action: "production_changes", resource: "databricks:dev" },
    ] } };
    const calls = renderPolicy(ops);
    expect(screen.getByText("databricks:prod")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Remove exception 1" }));
    expect(screen.queryByText("databricks:prod")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(calls.at(-1)).toMatchObject({ rules: [{ effect: "allow", resource: "databricks:dev" }] });
  });

  it("shows exceptions to a member but gives them no controls", () => {
    const ops: Operations = { ...operations, policy: { ...operations.policy, rules: [{ effect: "deny", action: "production_changes", resource: "databricks:prod" }] } };
    render(<QueryClientProvider client={createTestQueryClient()}><ToastProvider><PolicyTab operations={ops} readOnly /></ToastProvider></QueryClientProvider>);
    const row = screen.getByText("databricks:prod").closest("div")!;
    expect(within(row).queryByRole("button", { name: /Remove exception/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add exception" })).not.toBeInTheDocument();
  });
});
