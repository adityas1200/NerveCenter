import { useQuery } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { dataQualityApi } from "@/api/data-quality";
import { queryKeys } from "@/api/queryKeys";
import type { DataQualityConfiguration } from "@/api/types";
import { RESULT_TABLE_HELP } from "@/components/ops/MonitoringTableConfigurationDialog";
import { Pager } from "@/components/ops/Pager";
import { useResultTableEditor } from "@/components/ops/ResultTableEditor";
import { AlertDialog, Button, Skeleton, Switch } from "@/components/ui";
import { useAction } from "@/lib/useAction";
import { usePager } from "@/lib/usePager";
import { SettingsSection } from "./SettingsShell";
import { platformLabel } from "@/lib/platform";

/** Data quality: the result tables the Data Quality page reads. Add and edit open over Settings. */

const REFRESH_KEYS = [queryKeys.dataQuality.all, queryKeys.overview.all] as const;

const fullTableName = (table: Pick<DataQualityConfiguration, "catalog" | "schema" | "resultTable">) => `${table.catalog}.${table.schema}.${table.resultTable}`;

export function DataQualityTab() {
  const config = useQuery({ queryKey: queryKeys.dataQuality.config, queryFn: ({ signal }) => dataQualityApi.config(signal) });
  const providers = useQuery({ queryKey: queryKeys.dataQuality.providers, queryFn: ({ signal }) => dataQualityApi.providers(signal) });
  const { openNew, openEdit, editor } = useResultTableEditor();
  const [removing, setRemoving] = useState<DataQualityConfiguration | null>(null);
  const tables = config.data?.tables ?? (config.data?.configuration ? [config.data.configuration] : []);
  // Settings keeps its other params when the tab changes, so this list's page has its own name.
  const pager = usePager(tables.length, { prefix: "tables" });
  const toggle = useAction({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => dataQualityApi.save({ id, enabled }),
    invalidate: REFRESH_KEYS,
    success: (_data, variables) => (variables.enabled ? "Monitoring on" : "Monitoring paused"),
    error: "Not saved",
    errorDetail: String,
  });
  const remove = useAction({
    mutationFn: (id: string) => dataQualityApi.remove(id),
    invalidate: REFRESH_KEYS,
    success: "Result table removed",
    error: "Not removed",
    errorDetail: String,
  });
  const noProvider = providers.isSuccess && !providers.data.items.length;
  const add = <Button size="sm" variant="outline" className="border border-line" onClick={openNew}><Plus className="h-4 w-4" />Add result table</Button>;

  return (
    <SettingsSection title="Result tables" action={add}>
      <p className="-mt-2 text-[13.5px] text-ink-4">{RESULT_TABLE_HELP}</p>
      {config.isPending ? (
        <div role="status" aria-live="polite" className="mt-4 space-y-3"><span className="sr-only">Loading</span><Skeleton className="h-4 w-56" /><Skeleton className="h-4 w-72" /></div>
      ) : config.isError ? (
        <p role="alert" className="mt-4 text-[13.5px] text-rose-700">{config.error instanceof Error ? config.error.message : "Result tables could not be read"}</p>
      ) : tables.length ? (
        <ul className="mt-3 divide-y divide-line border-y border-line" aria-label="Result tables">
          {pager.slice(tables).map((table) => {
            const id = table.id || "";
            const name = table.name || table.resultTable;
            const path = fullTableName(table);
            return (
              <li key={id || path} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 py-3 sm:grid-cols-[minmax(0,1fr)_88px_auto_auto]">
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-semibold text-ink-1" title={name}>{name}</p>
                  <p className="truncate font-mono text-[12.5px] text-ink-4" title={path}>{path}</p>
                </div>
                <span className="hidden text-[13.5px] text-ink-3 sm:block">{platformLabel(table.provider) || table.provider}</span>
                <label className="flex items-center gap-2 text-[13px] text-ink-3">
                  <Switch aria-label={`Monitor ${name}`} checked={table.enabled !== false} disabled={!id || toggle.isPending} onCheckedChange={(enabled) => id && toggle.mutate({ id, enabled })} />
                  <span className="w-[52px]">{table.enabled !== false ? "On" : "Paused"}</span>
                </label>
                <div className="col-span-2 flex justify-end gap-1 sm:col-span-1">
                  <Button size="sm" variant="outline" className="border border-line" onClick={() => openEdit(table)} aria-label={`Edit ${name}`}><Pencil className="h-3.5 w-3.5" />Edit</Button>
                  <Button size="icon" variant="ghost" disabled={!id} onClick={() => setRemoving(table)} aria-label={`Remove ${name}`}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-4 text-[13.5px] text-ink-4">No result tables{noProvider ? <> · <Link to="/connectors" className="text-brand hover:underline">Connect Databricks or Snowflake</Link></> : null}</p>
      )}
      {tables.length ? <Pager {...pager.pagerProps} noun="result tables" className="border-t-0 px-0" /> : null}
      {editor}
      <AlertDialog
        open={Boolean(removing)}
        onOpenChange={(open) => { if (!open) setRemoving(null); }}
        destructive
        title={`Remove ${removing?.name || removing?.resultTable || "result table"}?`}
        description="Its checks disappear from the Data Quality page. The table itself is not touched."
        confirmLabel="Remove"
        onConfirm={async () => { if (removing?.id) await remove.mutateAsync(removing.id); setRemoving(null); }}
      />
    </SettingsSection>
  );
}
