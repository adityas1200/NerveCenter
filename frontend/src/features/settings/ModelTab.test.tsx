import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ToastProvider } from "@/components/ui";
import { SettingsPage } from "./SettingsPage";
import { jsonResponse, meResponse, mockFetch, renderWithClient, testUsers } from "@/test/utils";

type Call = { url: string; method: string; body: unknown };

function mockApi(agent?: Record<string, unknown>) {
  const calls: Call[] = [];
  const operations = { team: { name: "Data Operations", timezone: "Asia/Kolkata" }, policy: {}, connections: {}, ...(agent ? { agent } : {}) };
  mockFetch((url, init) => {
    const method = init?.method || "GET";
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url.includes("/api/me")) return meResponse(testUsers.operator, "admin");
    if (url.includes("/api/settings/") && method === "PUT") return jsonResponse({ section: "agent", value: {}, validation: { errors: [], warnings: [] } });
    if (url.includes("/api/settings")) return jsonResponse({ operations, validation: { errors: [], warnings: [] }, mcp: { mcpServers: {} } });
    return jsonResponse({ items: [] });
  });
  return calls;
}

function renderModelTab() {
  return renderWithClient(<MemoryRouter initialEntries={["/settings?tab=model"]}><ToastProvider><Routes><Route path="/settings" element={<SettingsPage />} /></Routes></ToastProvider></MemoryRouter>);
}

describe("Settings, Model", () => {
  it("starts on Sonnet at high effort when operations.yaml has no agent block, and saves a new choice", async () => {
    const calls = mockApi();
    renderModelTab();
    const models = await screen.findByRole("radiogroup", { name: "Model" });
    expect(within(models).getAllByRole("radio").map((radio) => radio.querySelector("span span")?.textContent)).toEqual(["Fable", "Opus", "Sonnet", "Haiku"]);
    expect(within(models).getByRole("radio", { name: /Sonnet/ })).toHaveAttribute("aria-checked", "true");
    const effort = screen.getByRole("radiogroup", { name: "Effort" });
    expect(within(effort).getAllByRole("radio").map((radio) => radio.textContent)).toEqual(["Low", "Medium", "High", "Extra high", "Max"]);
    expect(within(effort).getByRole("radio", { name: "High" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

    await userEvent.click(within(models).getByRole("radio", { name: /Opus/ }));
    await userEvent.click(within(effort).getByRole("radio", { name: "Max" }));
    expect(screen.getByTestId("effort-help")).toHaveTextContent("Thinks as long as it needs");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls.find((call) => call.method === "PUT")).toMatchObject({ url: expect.stringContaining("/api/settings/agent"), body: { model: "opus", effort: "max" } }));
  });

  it("rests the effort control while Haiku is selected", async () => {
    mockApi({ model: "haiku", effort: "medium" });
    renderModelTab();
    const models = await screen.findByRole("radiogroup", { name: "Model" });
    expect(within(models).getByRole("radio", { name: /Haiku/ })).toHaveAttribute("aria-checked", "true");
    const effort = screen.getByRole("radiogroup", { name: "Effort" });
    expect(effort).toHaveAttribute("aria-disabled", "true");
    for (const radio of within(effort).getAllByRole("radio")) expect(radio).toBeDisabled();
    expect(screen.getByTestId("effort-help")).toHaveTextContent("Haiku runs without effort levels");
    await userEvent.click(within(models).getByRole("radio", { name: /Sonnet/ }));
    expect(within(effort).getByRole("radio", { name: "Medium" })).toBeEnabled();
  });
});
