import { act, screen, waitFor } from "@testing-library/react";
import { useQuery } from "@tanstack/react-query";
import { afterEach, describe, expect, it } from "vitest";
import { apiClient } from "@/api/client";
import { projectQueryKeyHash, setCurrentProject } from "@/api/projects";
import { AppRouter } from "@/lib/appRouter";
import { ProjectProvider } from "@/lib/project";
import { useProject } from "@/lib/projectContext";
import { jsonResponse, mockFetch, renderWithClient } from "@/test/utils";

// SPEC-projects-01 FR-8, FR-14; SPEC-projects-03 FR-12, FR-14: the project comes from the URL.
const mine = { items: [{ id: "alpha", name: "Alpha", slug: "alpha", role: "developer", archived: false }, { id: "beta", name: "Beta", slug: "beta", role: "owner", archived: false }, { id: "commons", name: "Commons", slug: "commons", role: "open", archived: false }], all: false };

function Probe() {
  const { projectId, visitor, setProject } = useProject();
  const tickets = useQuery({ queryKey: ["tickets"], queryFn: () => apiClient.get<{ project: string }>("/api/tickets"), enabled: Boolean(projectId) });
  return (
    <div>
      <p>project:{projectId ?? "none"}</p>
      <p>data:{tickets.data?.project}</p>
      <p>visitor:{String(visitor)}</p>
      <p>path:{window.location.pathname}</p>
      <button onClick={() => setProject("beta")}>beta</button>
      <button onClick={() => void apiClient.get("/api/tickets/OPS-9").catch(() => {})}>link</button>
    </div>
  );
}

function headerOf(init?: RequestInit) {
  return new Headers(init?.headers).get("X-NerveCenter-Project");
}

function serve(projects: unknown = mine) {
  return mockFetch((url, init) => {
    if (url.endsWith("/api/me/projects")) return jsonResponse(projects);
    if (url.endsWith("/api/tickets/OPS-9")) return jsonResponse({ error: "You do not have access to this project.", projectId: "beta" }, 403);
    return jsonResponse({ project: headerOf(init) });
  });
}

function renderAt(path: string) {
  window.history.replaceState({}, "", path);
  const view = renderWithClient(<AppRouter><ProjectProvider><Probe /></ProjectProvider></AppRouter>);
  view.client.setDefaultOptions({ queries: { retry: false, queryKeyHashFn: projectQueryKeyHash } });
  return view;
}

afterEach(() => { localStorage.clear(); setCurrentProject(null); window.history.replaceState({}, "", "/"); });

describe("ProjectProvider", () => {
  it("FR-14: the project in the URL is the header on every call, and is remembered", async () => {
    serve();
    renderAt("/p/beta/tickets");
    expect(await screen.findByText("data:beta")).toBeInTheDocument();
    expect(localStorage.getItem("nc-project")).toBe("beta");
  });

  it("FR-14: a project the person cannot open shows the same page whether or not it exists", async () => {
    serve();
    renderAt("/p/gone");
    expect(await screen.findByText("This project isn't shared with you.")).toBeInTheDocument();
    expect(screen.queryByText(/project:/)).not.toBeInTheDocument();
  });

  it("FR-14: switching keeps the page, moves the URL, drops the old project's data and refetches under the new header", async () => {
    const fetchMock = serve();
    renderAt("/p/alpha/tickets/OPS-1");
    await screen.findByText("data:alpha");
    act(() => screen.getByText("beta").click());
    expect(await screen.findByText("data:beta")).toBeInTheDocument();
    expect(screen.getByText("path:/p/beta/tickets")).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/api/tickets")).map(([, init]) => headerOf(init))).toEqual(["alpha", "beta"]);
  });

  it("FR-14 (projects-01): a link into another of the person's projects switches to it", async () => {
    serve();
    renderAt("/p/alpha");
    await screen.findByText("data:alpha");
    act(() => screen.getByText("link").click());
    await waitFor(() => expect(screen.getByText("project:beta")).toBeInTheDocument());
  });

  it("FR-12: an open project the person is not in opens as a visitor", async () => {
    serve();
    renderAt("/p/commons");
    expect(await screen.findByText("visitor:true")).toBeInTheDocument();
    expect(await screen.findByText("data:commons")).toBeInTheDocument();
  });
});

describe("outside a project", () => {
  it("FR-16: home has no project and sends no project header", async () => {
    serve();
    renderAt("/");
    expect(await screen.findByText("project:none")).toBeInTheDocument();
  });

  it("FR-14 (amended 2026-10-06): there is no All view; /p/all is a project like any other", async () => {
    serve({ items: [], all: true });
    renderAt("/p/all/tickets");
    expect(await screen.findByText("This project isn't shared with you.")).toBeInTheDocument();
  });
});
