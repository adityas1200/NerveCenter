import { useQuery } from "@tanstack/react-query";
import { Check, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { fileToBase64 } from "@/api/library";
import type { Operations } from "@/api/settings";
import { TEMPLATE_FORMATS, TEMPLATE_FORMAT_ACCEPT, TEMPLATE_FORMAT_LABEL, templatesApi, type TemplateChoice, type TemplateFormat, type TemplatePresets } from "@/api/templates";
import { Skeleton, useToast } from "@/components/ui";
import { cn } from "@/lib/utils";
import { GroupHeading, SaveFooter, SettingsSection } from "./SettingsShell";
import { isDirty, useSaveSection } from "./useSaveSection";
import { FRESH } from "@/api/queryPolicy";
import { queryKeys } from "@/api/queryKeys";

/**
 * Templates: which starting file Sonic uses for a Word, PowerPoint or HTML document it builds for
 * a client, saved to operations.yaml `documents.templates`. Each format picks a built-in preset or
 * an uploaded file; whichever is active applies to every document of that format, everywhere Sonic
 * builds one. Having Sonic actually start from the active file is a later step - this only stores
 * the choice and keeps the uploaded file.
 */

type Draft = Partial<Record<TemplateFormat, TemplateChoice>>;

const draftOf = (operations: Operations): Draft => ({ ...(operations.documents?.templates || {}) });

export function TemplatesTab({ operations }: { operations: Operations }) {
  const save = useSaveSection();
  const presets = useQuery({ queryKey: queryKeys.templates.presets, queryFn: ({ signal }) => templatesApi.presets(signal), staleTime: FRESH.session });
  const [draft, setDraft] = useState<Draft>(() => draftOf(operations));
  useEffect(() => { setDraft(draftOf(operations)); }, [operations]);
  const onSave = () => save.mutate({ section: "documents", value: { ...(operations.documents || {}), templates: draft } });

  return (
    <SettingsSection title="Templates" footer={<SaveFooter pending={save.isPending} disabled={!isDirty(draft, draftOf(operations))} onSave={onSave} />}>
      <p className="-mt-2 text-[13.5px] text-ink-4">
        Pick the file Sonic starts from for each format. Whichever one is active here is used everywhere in chat, until it changes.
      </p>
      {presets.isPending ? (
        <div className="mt-5 space-y-5">{TEMPLATE_FORMATS.map((format) => <Skeleton key={format} className="h-32 w-full rounded-xl" />)}</div>
      ) : presets.data ? (
        <div className="mt-5 space-y-6">
          {TEMPLATE_FORMATS.map((format) => (
            <FormatPicker
              key={format}
              format={format}
              presets={presets.data.presets[format] ?? []}
              choice={draft[format]}
              onChange={(choice) => setDraft((current) => ({ ...current, [format]: choice }))}
            />
          ))}
        </div>
      ) : null}
    </SettingsSection>
  );
}

function FormatPicker({ format, presets, choice, onChange }: { format: TemplateFormat; presets: TemplatePresets[TemplateFormat]; choice: TemplateChoice | undefined; onChange: (choice: TemplateChoice) => void }) {
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const selectedPreset = choice?.kind === "preset" ? choice.id : presets[0]?.id;
  const isCustom = choice?.kind === "custom";

  const pickFile = () => inputRef.current?.click();
  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const fileBase64 = await fileToBase64(file);
      const result = await templatesApi.upload(format, fileBase64, file.name);
      onChange({ kind: "custom", fileName: result.fileName, originalName: result.originalName });
      toast.success(`${file.name} uploaded`, `Used for every ${TEMPLATE_FORMAT_LABEL[format]} document now.`);
    } catch (error) {
      toast.error("Not uploaded", error instanceof Error ? error.message : "Try again.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      <GroupHeading>{TEMPLATE_FORMAT_LABEL[format]}</GroupHeading>
      <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" role="radiogroup" aria-label={`${TEMPLATE_FORMAT_LABEL[format]} template`}>
        {presets.map((preset) => {
          const selected = !isCustom && selectedPreset === preset.id;
          return (
            <button
              key={preset.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange({ kind: "preset", id: preset.id })}
              className={cn(
                "flex flex-col rounded-xl border bg-raised p-3.5 text-left transition duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/25",
                selected ? "border-brand shadow-card ring-1 ring-brand" : "border-line hover:border-line-strong",
              )}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="text-[14px] font-semibold text-ink-1">{preset.name}</span>
                <Check className={cn("h-4 w-4 shrink-0", selected ? "text-brand" : "text-transparent")} aria-hidden="true" />
              </span>
              <span className="mt-1 text-[12.5px] leading-4 text-ink-4">{preset.description}</span>
            </button>
          );
        })}
        <button
          type="button"
          role="radio"
          aria-checked={isCustom}
          onClick={pickFile}
          disabled={uploading}
          className={cn(
            "flex flex-col items-start rounded-xl border bg-raised p-3.5 text-left transition duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/25 disabled:opacity-60",
            isCustom ? "border-brand shadow-card ring-1 ring-brand" : "border-dashed border-line hover:border-line-strong",
          )}
        >
          <span className="flex w-full items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-[14px] font-semibold text-ink-1"><Upload className="h-3.5 w-3.5" aria-hidden="true" />Upload your own</span>
            <Check className={cn("h-4 w-4 shrink-0", isCustom ? "text-brand" : "text-transparent")} aria-hidden="true" />
          </span>
          <span className="mt-1 truncate text-[12.5px] leading-4 text-ink-4">
            {uploading ? "Uploading…" : isCustom && choice?.kind === "custom" ? (choice.originalName || choice.fileName) : `A ${TEMPLATE_FORMAT_ACCEPT[format]} file`}
          </span>
        </button>
        <input ref={inputRef} type="file" accept={TEMPLATE_FORMAT_ACCEPT[format]} className="sr-only" aria-label={`Upload a ${TEMPLATE_FORMAT_LABEL[format]} template`} onChange={(event) => { void onFile(event.target.files?.[0]); event.target.value = ""; }} />
      </div>
    </div>
  );
}
