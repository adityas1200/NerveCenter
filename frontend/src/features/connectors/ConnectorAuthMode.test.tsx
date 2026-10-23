import { fireEvent, screen, waitFor } from "@testing-library/react";
import type { Connector } from "@/api/connectors";
import { fieldApplies, withFieldDefaults } from "@/api/connectors";
import { ToastProvider } from "@/components/ui";
import { ConnectorDialog } from "./ConnectorDialogs";
import { mockFetch, renderWithClient } from "@/test/utils";

/**
 * Databricks can be reached as a person (a personal access token) or as a service principal
 * (a client ID and an OAuth secret). The form asks for one or the other, never both.
 */

const databricks: Connector = {
  id: "databricks", name: "Databricks", description: "Pipelines, data quality and RCA read the jobs and SQL APIs.", kind: "catalog", configured: false, state: "not_connected",
  fields: [
    { key: "host", label: "Workspace URL", required: true, env: "DATABRICKS_HOST" },
    { key: "authMode", label: "Authenticate as", required: false, default: "pat", choices: [{ value: "pat", label: "A person (access token)" }, { value: "service_principal", label: "A service principal (OAuth)" }] },
    { key: "clientId", label: "Client ID", required: true, env: "DATABRICKS_CLIENT_ID", when: { authMode: "service_principal" } },
    { key: "warehouseId", label: "SQL warehouse ID", required: false, env: "DATABRICKS_WAREHOUSE_ID" },
  ],
  secrets: [
    { key: "token", label: "Personal access token", env: "DATABRICKS_TOKEN", required: true, when: { authMode: "pat" } },
    { key: "clientSecret", label: "Client secret (OAuth)", env: "DATABRICKS_CLIENT_SECRET", required: true, when: { authMode: "service_principal" } },
  ],
  settings: {}, secretsSet: [], mcp: null, hasMcpDefault: true,
};

function renderDialog(onSaved = vi.fn()) {
  return renderWithClient(<ToastProvider><ConnectorDialog connector={databricks} onOpenChange={vi.fn()} onSaved={onSaved} /></ToastProvider>);
}

describe("connector fields that belong to one way of connecting", () => {
  it("only applies a field while its settings hold, and fills in defaults", () => {
    const pat = { authMode: "pat" };
    expect(fieldApplies({ when: { authMode: "service_principal" } }, pat)).toBe(false);
    expect(fieldApplies({ when: { authMode: "pat" } }, pat)).toBe(true);
    expect(fieldApplies({}, pat)).toBe(true);
    expect(fieldApplies({ when: { authMode: "pat" } }, {})).toBe(false);
    expect(withFieldDefaults(databricks.fields!, { host: "https://adb-1.net" })).toEqual({ host: "https://adb-1.net", authMode: "pat" });
    expect(withFieldDefaults(databricks.fields!, { authMode: "service_principal" }).authMode).toBe("service_principal");
  });

  it("asks for the access token by default and swaps to the client ID and secret for a service principal", async () => {
    renderDialog();
    expect(await screen.findByLabelText(/Personal access token/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Client ID/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Client secret/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("combobox", { name: "Authenticate as" }));
    fireEvent.click(await screen.findByRole("option", { name: "A service principal (OAuth)" }));

    await waitFor(() => expect(screen.getByLabelText(/Client ID/)).toBeInTheDocument());
    expect(screen.getByLabelText(/Client secret/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Personal access token/)).not.toBeInTheDocument();
    // The SQL warehouse belongs to neither, so it stays put.
    expect(screen.getByLabelText(/SQL warehouse ID/)).toBeInTheDocument();
  });

  it("sends only the chosen way of connecting, so the other credential is never saved alongside it", async () => {
    const saved: Array<Record<string, unknown>> = [];
    mockFetch((url, init) => {
      if (init?.body) saved.push(JSON.parse(String(init.body)));
      return Promise.resolve(new Response(JSON.stringify({ ...databricks, configured: true, state: "connected" }), { status: 200, headers: { "content-type": "application/json" } }));
    });
    renderDialog();

    fireEvent.change(await screen.findByLabelText(/Workspace URL/), { target: { value: "https://adb-1.azuredatabricks.net" } });
    // Type an access token first, then change your mind: it must not travel with the service principal.
    fireEvent.change(screen.getByLabelText(/Personal access token/), { target: { value: "dapi-person-token" } });
    fireEvent.click(screen.getByRole("combobox", { name: "Authenticate as" }));
    fireEvent.click(await screen.findByRole("option", { name: "A service principal (OAuth)" }));
    fireEvent.change(await screen.findByLabelText(/Client ID/), { target: { value: "sp-client" } });
    fireEvent.change(screen.getByLabelText(/Client secret/), { target: { value: "dose-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));

    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]).toEqual({
      settings: { host: "https://adb-1.azuredatabricks.net", authMode: "service_principal", clientId: "sp-client" },
      secrets: { clientSecret: "dose-secret" },
    });
  });

  it("does not block Connect on a credential the chosen way of connecting never asked for", async () => {
    renderDialog();
    fireEvent.change(await screen.findByLabelText(/Workspace URL/), { target: { value: "https://adb-1.azuredatabricks.net" } });
    expect(screen.getByRole("button", { name: "Connect" })).toBeDisabled(); // the access token is still missing

    fireEvent.click(screen.getByRole("combobox", { name: "Authenticate as" }));
    fireEvent.click(await screen.findByRole("option", { name: "A service principal (OAuth)" }));
    fireEvent.change(await screen.findByLabelText(/Client ID/), { target: { value: "sp-client" } });
    fireEvent.change(screen.getByLabelText(/Client secret/), { target: { value: "dose-secret" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Connect" })).toBeEnabled());
  });
});
