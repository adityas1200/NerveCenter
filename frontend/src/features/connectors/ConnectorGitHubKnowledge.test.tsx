import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Connector } from "@/api/connectors";
import { ToastProvider } from "@/components/ui";
import { ConnectorDialog } from "./ConnectorDialogs";
import { createTestQueryClient, jsonResponse, renderWithClient } from "@/test/utils";

/**
 * The GitHub connector already asks for Repository, Default branch and a Personal access token -
 * exactly what a git-backed knowledge base needs too. "Use as a knowledge source too" reuses those
 * instead of sending someone to Knowledge's separate "Add knowledge base" flow to type the same
 * repository and token again.
 */

const github: Connector = {
  id: "github", name: "GitHub", description: "Keeps the code repository, pull requests, checks and Git-backed knowledge current.", kind: "catalog", connectionKind: "cli", configured: false, state: "not_connected",
  fields: [
    { key: "repository", label: "Repository", required: true, placeholder: "company/data-platform" },
    { key: "defaultBranch", label: "Default branch", required: false, placeholder: "main" },
  ],
  secrets: [{ key: "token", label: "Personal access token", env: "GITHUB_TOKEN", required: true }],
  settings: {}, secretsSet: [], mcp: null, hasMcpDefault: true,
};

function renderDialog(fetchMock: ReturnType<typeof vi.fn>, onSaved = vi.fn()) {
  vi.stubGlobal("fetch", fetchMock);
  return renderWithClient(<ToastProvider><ConnectorDialog connector={github} onOpenChange={vi.fn()} onSaved={onSaved} /></ToastProvider>);
}

describe("GitHub connector doubling as a knowledge source", () => {
  it("offers the toggle only while connecting GitHub for the first time, not editing an already-configured one", () => {
    renderDialog(vi.fn());
    expect(screen.getByLabelText("Use as a knowledge source too")).toBeInTheDocument();
  });

  it("does not offer the toggle for a connector that is not a git host", () => {
    const client = createTestQueryClient();
    const databricks: Connector = { ...github, id: "databricks", name: "Databricks", fields: [], secrets: [] };
    render(<QueryClientProvider client={client}><ToastProvider><ConnectorDialog connector={databricks} onOpenChange={vi.fn()} onSaved={vi.fn()} /></ToastProvider></QueryClientProvider>);
    expect(screen.queryByLabelText("Use as a knowledge source too")).not.toBeInTheDocument();
  });

  it("saves the connector and adds it as a whole-repository knowledge base when the toggle is on", async () => {
    const calls: Array<{ method: string; url: string; body?: unknown }> = [];
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input); const method = init?.method || "GET";
      calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.endsWith("/api/connectors/github") && method === "PUT") return jsonResponse({ ...github, configured: true, settings: { repository: "acme/widgets", defaultBranch: "main" }, secretsSet: ["GITHUB_TOKEN"] });
      if (url.endsWith("/api/knowledge") && method === "POST") return jsonResponse({ name: "github", title: "GitHub", files: 12 }, 201);
      return jsonResponse({ items: [] });
    });
    renderDialog(fetchMock);

    fireEvent.change(screen.getByLabelText(/^Repository/), { target: { value: "acme/widgets" } });
    fireEvent.change(screen.getByLabelText("Default branch"), { target: { value: "main" } });
    fireEvent.change(screen.getByLabelText(/Personal access token/), { target: { value: "tok-123" } });
    fireEvent.click(screen.getByLabelText("Use as a knowledge source too"));
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));

    await waitFor(() => expect(calls.some((call) => call.method === "POST" && call.url.endsWith("/api/knowledge"))).toBe(true));
    const knowledgeCall = calls.find((call) => call.method === "POST" && call.url.endsWith("/api/knowledge"))!;
    expect(knowledgeCall.body).toEqual({ title: "GitHub", url: "https://github.com/acme/widgets", branch: "main", token: "tok-123" });
  });

  it("does not touch Knowledge when the toggle stays off", async () => {
    const calls: Array<{ method: string; url: string }> = [];
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input); const method = init?.method || "GET";
      calls.push({ method, url });
      if (url.endsWith("/api/connectors/github") && method === "PUT") return jsonResponse({ ...github, configured: true, settings: { repository: "acme/widgets" }, secretsSet: ["GITHUB_TOKEN"] });
      return jsonResponse({ items: [] });
    });
    renderDialog(fetchMock);
    fireEvent.change(screen.getByLabelText(/^Repository/), { target: { value: "acme/widgets" } });
    fireEvent.change(screen.getByLabelText(/Personal access token/), { target: { value: "tok-123" } });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));

    await waitFor(() => expect(calls.some((call) => call.method === "PUT")).toBe(true));
    expect(calls.some((call) => call.url.endsWith("/api/knowledge"))).toBe(false);
  });
});
