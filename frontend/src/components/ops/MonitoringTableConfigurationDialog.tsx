import type { DataQualityAnalysis, DataQualityColumnMapping, DataQualityConfiguration, DataQualityProvider } from "@/api/types";
import type { ReactNode } from "react";
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Textarea } from "@/components/ui";

/** One line that says what a result table is; shown wherever result tables are configured. */
export const RESULT_TABLE_HELP = "The table your data quality jobs write check results to. NerveCenter reads it; it never writes.";

const fields: Array<{ key: keyof DataQualityColumnMapping; label: string; required?: boolean }> = [
  { key: "checkId", label: "Check ID", required: true },
  { key: "status", label: "Status", required: true },
  { key: "executedAt", label: "Executed at", required: true },
  { key: "checkName", label: "Check name" },
  { key: "dataset", label: "Dataset" },
  { key: "field", label: "Field" },
  { key: "rule", label: "Rule expression" },
  { key: "failedRows", label: "Failed rows" },
  { key: "message", label: "Message" },
  { key: "severity", label: "Severity" },
  { key: "recommendedFix", label: "Recommended fix" },
];

export type DraftField = "name" | "provider" | "catalog" | "schema" | "resultTable" | "ruleTable" | "warehouseId" | "ddl";

export function MonitoringTableConfigurationDialog({ open, onOpenChange, mode = "add", draft, providers, analysis, pending, analyzing, error, allowDataSample, onDraftChange, onAllowDataSampleChange, onAnalyze, onMappingChange, onSave }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode?: "add" | "edit";
  draft: DataQualityConfiguration;
  providers: DataQualityProvider[];
  analysis: DataQualityAnalysis | null;
  pending: boolean;
  analyzing: boolean;
  error: unknown;
  allowDataSample: boolean;
  onDraftChange: (key: DraftField, value: string) => void;
  onAllowDataSampleChange: (value: boolean) => void;
  onAnalyze: () => void;
  onMappingChange: (key: keyof DataQualityColumnMapping, value: string) => void;
  onSave: () => void;
}) {
  const canSave = Boolean(analysis && !analysis.missingRequired.length && !analysis.issues.some(issue => /does not match|duplicate|unexpected type|not in the DDL/i.test(issue)));
  const snowflake = draft.provider === "snowflake";
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{mode === "edit" ? "Edit result table" : "Add result table"}</DialogTitle>
        <DialogDescription>{RESULT_TABLE_HELP} Paste its DDL to map the columns.</DialogDescription>
      </DialogHeader>
      <div className="grid min-w-0 gap-4 px-5 pb-2 sm:grid-cols-2">
        {!providers.length ? <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[12.5px] text-amber-800 sm:col-span-2">Connect and verify Snowflake or Databricks on Connectors first.</div> : null}
        <DqField label="Name" hint="Shown on the Data Quality page"><Input aria-label="Result table name" value={draft.name || ""} onChange={(event) => onDraftChange("name", event.target.value)} placeholder={draft.resultTable || "Commercial checks"} /></DqField>
        <DqField label="Platform" required><Select value={draft.provider} onValueChange={(value) => onDraftChange("provider", value)}><SelectTrigger aria-label="Monitoring provider"><SelectValue placeholder="Select platform" /></SelectTrigger><SelectContent>{providers.map((provider) => <SelectItem key={provider.id} value={provider.id}>{provider.name}</SelectItem>)}</SelectContent></Select></DqField>
        <DqField label={snowflake ? "Database" : "Catalog"} required><Input aria-label={snowflake ? "Monitoring database" : "Monitoring catalog"} value={draft.catalog} onChange={(event) => onDraftChange("catalog", event.target.value)} placeholder="analytics" /></DqField>
        <DqField label="Schema" required><Input aria-label="Monitoring schema" value={draft.schema} onChange={(event) => onDraftChange("schema", event.target.value)} placeholder="data_quality" /></DqField>
        <DqField label="Result table" required><Input aria-label="Monitoring result table" value={draft.resultTable} onChange={(event) => onDraftChange("resultTable", event.target.value)} placeholder="dq_results" /></DqField>
        <DqField label="Rule table" hint="Optional. Adds rule text and fix guidance"><Input aria-label="Monitoring rule table" value={draft.ruleTable || ""} onChange={(event) => onDraftChange("ruleTable", event.target.value)} placeholder="dq_rules" /></DqField>
        {draft.provider === "databricks" ? <DqField label="SQL warehouse ID" required><Input aria-label="Monitoring SQL warehouse ID" value={draft.warehouseId || ""} onChange={(event) => onDraftChange("warehouseId", event.target.value)} placeholder="abc123" /></DqField> : null}
        <div className="min-w-0 sm:col-span-2"><DqField label="Table DDL" required hint="Paste one CREATE TABLE or CREATE VIEW statement to enable analysis. Read as metadata, never executed"><Textarea aria-label="Monitoring table DDL" rows={10} className="resize-y bg-slate-950 font-mono text-[11.5px] leading-5 text-slate-100 placeholder:text-slate-500" value={draft.ddl || ""} onChange={(event) => onDraftChange("ddl", event.target.value)} placeholder={'CREATE TABLE QUALITY.DQ_RESULTS (\n  CHECK_ID VARCHAR,\n  STATUS VARCHAR,\n  EXECUTED_AT TIMESTAMP_TZ\n);'} /></DqField></div>
        <label className="flex items-start gap-2 rounded-xl border border-line p-3 text-[12.5px] font-normal text-ink-3 sm:col-span-2"><input type="checkbox" checked={allowDataSample} onChange={(event) => onAllowDataSampleChange(event.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-violet-600" /><span className="min-w-0"><span className="font-semibold text-ink-2">Allow a 5-row sample if the DDL is unclear.</span> Sonic reads the rows to resolve an unclear column. Leave off for sensitive data.</span></label>
        {analysis ? <AnalysisReview analysis={analysis} onMappingChange={onMappingChange} /> : <div className="rounded-xl border border-dashed border-line-strong p-4 text-[13px] text-ink-4 sm:col-span-2">Analyze the DDL to see the column mapping</div>}
        {error ? <p role="alert" className="break-words rounded-xl border border-rose-200 bg-rose-50 p-3 text-[13px] text-rose-800 sm:col-span-2">{error instanceof Error ? error.message : "Configuration failed"}</p> : null}
      </div>
      <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="outline" disabled={analyzing || pending || !providers.length || !draft.ddl?.trim()} onClick={onAnalyze}>{analyzing ? "Analyzing" : "Analyze DDL"}</Button><Button variant="primary" disabled={pending || analyzing || !canSave} onClick={onSave}>{pending ? "Saving" : "Save"}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

function AnalysisReview({ analysis, onMappingChange }: { analysis: DataQualityAnalysis; onMappingChange: (key: keyof DataQualityColumnMapping, value: string) => void }) {
  const issueText = analysis.issues.filter((issue, index, issues) => issues.indexOf(issue) === index);
  return <section className="min-w-0 space-y-3 rounded-xl border border-line bg-raised p-4 sm:col-span-2" aria-label="DDL mapping review">
    <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h3 className="font-display text-[14.5px] font-semibold text-ink-1">Column mapping</h3><p className="mt-1 text-[12.5px] text-ink-4">{analysis.columns.length} columns · mapping confidence is {Math.round(analysis.confidence * 100)}%</p></div><span className="shrink-0 rounded-full border border-line bg-surface-subtle px-2 py-1 text-[11px] font-semibold text-ink-3">{analysis.agent.used ? "Claude reviewed" : "Name matching"}</span></div>
    {analysis.sample.used ? <p className="rounded-lg border border-line p-2.5 text-[11.5px] text-ink-3">Sonic used {analysis.sample.rowCount} read-only sample rows.</p> : null}
    {issueText.length ? <div role="alert" className="space-y-1 break-words rounded-lg border border-amber-200 bg-amber-50 p-3 text-[12.5px] text-amber-900">{issueText.map(issue => <p key={issue}>{issue}</p>)}</div> : null}
    <div className="overflow-x-auto rounded-lg border border-line"><table className="w-full min-w-[520px] table-fixed text-left"><colgroup><col className="w-[34%]" /><col /><col className="w-[22%]" /></colgroup><thead className="bg-surface-subtle text-[11px] uppercase tracking-[0.05em] text-ink-5"><tr><th className="px-3 py-2">DQ field</th><th className="px-3 py-2">Source column</th><th className="px-3 py-2">Type</th></tr></thead><tbody>{fields.map(field => { const options = analysis.columns.filter(column => !analysis.candidates[field.key]?.length || analysis.candidates[field.key].includes(column.name) || column.name === analysis.mapping[field.key]); const type = analysis.columns.find(column => column.name === analysis.mapping[field.key])?.type || "—"; return <tr key={field.key} className="border-t border-line"><td className="px-3 py-2 text-[13px] font-semibold text-ink-2">{field.label}{field.required ? <span className="ml-1 text-rose-600">*</span> : null}</td><td className="min-w-0 px-3 py-2"><Select value={analysis.mapping[field.key] || "__none__"} onValueChange={value => onMappingChange(field.key, value === "__none__" ? "" : value)}><SelectTrigger aria-label={`${field.label} source column`} className="h-8 text-[12.5px]"><SelectValue placeholder="Not mapped" /></SelectTrigger><SelectContent><SelectItem value="__none__">Not mapped</SelectItem>{options.map(column => <SelectItem key={column.name} value={column.name}>{column.name}</SelectItem>)}</SelectContent></Select></td><td className="truncate px-3 py-2 font-mono text-[11px] text-ink-4" title={type}>{type}</td></tr>; })}</tbody></table></div>
  </section>;
}

function DqField({ label, required = false, hint, children }: { label: string; required?: boolean; hint?: string; children: ReactNode }) { return <label className="grid min-w-0 gap-1.5 text-[13px] font-semibold text-ink-3"><span>{label}{required ? <span className="ml-1 text-rose-600">*</span> : null}</span>{children}{hint ? <span className="text-[11.5px] font-normal text-ink-5">{hint}</span> : null}</label>; }
