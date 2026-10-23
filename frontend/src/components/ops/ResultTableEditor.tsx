import { useMutation, useQuery } from "@tanstack/react-query";
import { useCallback, useState, type ReactNode } from "react";
import { connectionsApi } from "@/api/connections";
import { dataQualityApi } from "@/api/data-quality";
import { queryKeys } from "@/api/queryKeys";
import type { ConnectionProfile, DataQualityAnalysis, DataQualityColumnMapping, DataQualityConfiguration } from "@/api/types";
import { MonitoringTableConfigurationDialog, type DraftField } from "@/components/ops/MonitoringTableConfigurationDialog";
import { useAction } from "@/lib/useAction";

/**
 * Add or edit one data quality result table in a dialog over the current page. Settings and the
 * Data Quality page both use it, so configuring a table never navigates away from where you are.
 */

const DEFAULT_MAPPING: DataQualityColumnMapping = { checkId: "check_id", checkName: "check_name", status: "status", executedAt: "executed_at", dataset: "dataset", field: "field_name", rule: "rule_expression", failedRows: "failed_rows", message: "message", severity: "severity", recommendedFix: "recommended_fix" };
const REQUIRED: Array<keyof DataQualityColumnMapping> = ["checkId", "status", "executedAt"];
/** Changing any of these makes the column mapping stale, so it has to be analysed again. */
const SHAPE_FIELDS: DraftField[] = ["provider", "catalog", "schema", "resultTable", "ddl"];

function blankTable(provider = "", connection?: ConnectionProfile | null): DataQualityConfiguration {
  return { name: "", provider, catalog: String(connection?.config.database || ""), schema: String(connection?.config.schema || ""), resultTable: "", ruleTable: "", warehouseId: "", mapping: { ...DEFAULT_MAPPING }, enabled: true };
}

/** A stored table already carries its reviewed mapping; show it so a rename does not need a new analysis. */
function storedAnalysis(table: DataQualityConfiguration): DataQualityAnalysis | null {
  if (!table.ddl || !table.discoveredColumns?.length) return null;
  return { provider: table.provider, catalog: table.catalog, schema: table.schema, resultTable: table.resultTable, warehouseId: table.warehouseId, columns: table.discoveredColumns, mapping: table.mapping, candidates: {}, issues: [], missingRequired: REQUIRED.filter((key) => !table.mapping[key]), confidence: 1, ddlHash: table.ddlHash || "", agent: { used: false }, sample: { used: false, rowCount: 0 } };
}

interface Session { mode: "add" | "edit"; draft: DataQualityConfiguration; analysis: DataQualityAnalysis | null; allowDataSample: boolean }

export function useResultTableEditor(): { openNew: () => void; openEdit: (table: DataQualityConfiguration) => void; editor: ReactNode } {
  const [session, setSession] = useState<Session | null>(null);
  const providers = useQuery({ queryKey: queryKeys.dataQuality.providers, queryFn: ({ signal }) => dataQualityApi.providers(signal) });
  const connections = useQuery({ queryKey: queryKeys.connections.all, queryFn: ({ signal }) => connectionsApi.list(signal) });
  const snowflake = connections.data?.items.find((item) => item.provider === "snowflake" && item.isDefault) || connections.data?.items.find((item) => item.provider === "snowflake") || null;
  const firstProvider = providers.data?.items[0]?.id;

  const save = useAction({
    mutationFn: (table: DataQualityConfiguration) => dataQualityApi.save(table),
    invalidate: [queryKeys.dataQuality.all, queryKeys.overview.all],
    success: "Result table saved",
    onSuccess: () => setSession(null),
  });
  const analyze = useMutation({
    mutationFn: (draft: DataQualityConfiguration & { allowDataSample: boolean }) => dataQualityApi.analyze({ provider: draft.provider, catalog: draft.catalog, schema: draft.schema, resultTable: draft.resultTable, warehouseId: draft.warehouseId, ddl: draft.ddl || "", allowDataSample: draft.allowDataSample }),
    onSuccess: (result) => setSession((current) => (current ? { ...current, analysis: result } : current)),
  });

  const { reset: resetSave } = save;
  const { reset: resetAnalyze } = analyze;
  const reset = useCallback(() => { resetSave(); resetAnalyze(); }, [resetSave, resetAnalyze]);
  const openNew = useCallback(() => {
    const provider = firstProvider || (snowflake ? "snowflake" : "");
    reset();
    setSession({ mode: "add", draft: blankTable(provider, provider === "snowflake" ? snowflake : null), analysis: null, allowDataSample: false });
  }, [firstProvider, snowflake, reset]);
  const openEdit = useCallback((table: DataQualityConfiguration) => {
    reset();
    setSession({ mode: "edit", draft: { ...table, mapping: { ...DEFAULT_MAPPING, ...table.mapping } }, analysis: storedAnalysis(table), allowDataSample: false });
  }, [reset]);

  const updateDraft = (key: DraftField, value: string) => setSession((current) => current ? { ...current, draft: { ...current.draft, [key]: value }, analysis: SHAPE_FIELDS.includes(key) ? null : current.analysis } : current);
  const updateMapping = (key: keyof DataQualityColumnMapping, value: string) => setSession((current) => {
    if (!current?.analysis) return current;
    const mapping = { ...current.analysis.mapping, [key]: value };
    return { ...current, analysis: { ...current.analysis, mapping, missingRequired: REQUIRED.filter((required) => !mapping[required]) } };
  });
  const onSave = () => {
    if (!session?.analysis) return;
    const { draft, analysis } = session;
    save.mutate({ ...draft, name: String(draft.name || "").trim(), ddl: draft.ddl || "", ddlHash: analysis.ddlHash, discoveredColumns: analysis.columns, mapping: analysis.mapping });
  };

  const editor = session ? (
    <MonitoringTableConfigurationDialog
      open
      onOpenChange={(open) => { if (!open) setSession(null); }}
      mode={session.mode}
      draft={session.draft}
      providers={providers.data?.items || []}
      analysis={session.analysis}
      pending={save.isPending}
      analyzing={analyze.isPending}
      error={save.error || analyze.error}
      allowDataSample={session.allowDataSample}
      onDraftChange={updateDraft}
      onAllowDataSampleChange={(value) => setSession((current) => (current ? { ...current, allowDataSample: value } : current))}
      onAnalyze={() => analyze.mutate({ ...session.draft, allowDataSample: session.allowDataSample })}
      onMappingChange={updateMapping}
      onSave={onSave}
    />
  ) : null;

  return { openNew, openEdit, editor };
}
