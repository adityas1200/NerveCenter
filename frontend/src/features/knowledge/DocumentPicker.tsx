import { FileText, Upload, X } from "lucide-react";
import { useId, useRef, useState } from "react";
import { UPLOAD_LIMITS } from "@/api/library";
import { cn } from "@/lib/utils";
import { formatBytes, mergeFiles, uploadProblem } from "./documentUploads";

/**
 * Choose documents for a knowledge base built from uploads: drop them or browse, see what is chosen,
 * remove one. The limits mirror the backend so a person hears about a problem before uploading.
 */

export function DocumentPicker({ files, onChange, disabled = false }: { files: File[]; onChange: (files: File[]) => void; disabled?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const [over, setOver] = useState(false);
  const [skipped, setSkipped] = useState<string[]>([]);
  const add = (incoming: File[]) => { const result = mergeFiles(files, incoming); setSkipped(result.skipped); onChange(result.files); };
  const total = files.reduce((sum, file) => sum + file.size, 0);
  const problem = uploadProblem(files);
  return (
    <div className="space-y-2">
      <label
        htmlFor={id}
        onDragOver={(event) => { event.preventDefault(); if (!disabled) setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => { event.preventDefault(); setOver(false); if (!disabled) add(Array.from(event.dataTransfer.files)); }}
        className={cn("flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed px-4 py-5 text-center transition-colors", over ? "border-brand bg-violet-50" : "border-line-strong bg-raised hover:border-ink-3", disabled && "cursor-not-allowed opacity-60")}
      >
        <Upload className="h-5 w-5 text-ink-4" aria-hidden="true" />
        <span className="text-[13.5px] font-medium text-ink-2">Drop documents here or <span className="text-brand">browse</span></span>
        <span className="text-[12px] text-ink-5">Word, PowerPoint, Excel, PDF, HTML, markdown, text or CSV · up to {UPLOAD_LIMITS.files} files, {formatBytes(UPLOAD_LIMITS.bytes)}</span>
        <input id={id} ref={input} type="file" multiple accept={UPLOAD_LIMITS.accept} className="sr-only" aria-label="Documents" disabled={disabled}
          onChange={(event) => { add(Array.from(event.target.files || [])); event.target.value = ""; }} />
      </label>
      {files.length ? (
        <ul className="max-h-[180px] divide-y divide-line overflow-y-auto rounded-xl border border-line bg-raised" aria-label="Chosen documents">
          {files.map((file) => (
            <li key={file.name} className="flex h-9 items-center gap-2 px-3 text-[13px]">
              <FileText className="h-3.5 w-3.5 shrink-0 text-ink-4" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate text-ink-1" title={file.name}>{file.name}</span>
              <span className="shrink-0 tabular-nums text-ink-5">{formatBytes(file.size)}</span>
              <button type="button" className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-5 hover:text-ink-1" aria-label={`Remove ${file.name}`} disabled={disabled} onClick={() => onChange(files.filter((item) => item !== file))}>
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {files.length ? <p className="text-[12.5px] text-ink-4">{files.length} {files.length === 1 ? "document" : "documents"} · {formatBytes(total)}</p> : null}
      {skipped.length ? <p className="text-[12.5px] text-amber-700">Left out, not a supported document: {skipped.join(", ")}</p> : null}
      {problem ? <p className="text-[12.5px] text-rose-700" role="alert">{problem}</p> : null}
    </div>
  );
}
