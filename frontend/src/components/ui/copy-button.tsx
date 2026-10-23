/* eslint-disable react-refresh/only-export-components */
import * as React from "react";
import { Check, Copy } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type CopyStatus = "idle" | "copied" | "error";

/** Copies text using the async clipboard API, falling back to a hidden textarea. */
export async function copyTextToClipboard(value: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // Clipboard permission denied or unavailable; fall back to the legacy path.
    }
  }

  if (typeof document === "undefined") return false;

  try {
    const area = document.createElement("textarea");
    area.value = value;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "0";
    area.style.left = "-9999px";
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(area);
    return copied;
  } catch {
    // Legacy fallback is unavailable in this environment.
    return false;
  }
}

export interface CopyButtonProps extends Omit<ButtonProps, "children" | "value"> {
  /** Text placed on the clipboard. */
  value: string;
  /** Accessible label in the idle state. */
  label?: string;
  copiedLabel?: string;
  errorLabel?: string;
  /** Renders the label as visible text next to the icon. */
  showLabel?: boolean;
  /** How long the success state stays visible, in milliseconds. */
  timeoutMs?: number;
  onCopied?: (value: string) => void;
}

const CopyButton = React.forwardRef<HTMLButtonElement, CopyButtonProps>(
  (
    {
      className,
      value,
      label = "Copy to clipboard",
      copiedLabel = "Copied",
      errorLabel = "Copy failed",
      showLabel = false,
      timeoutMs = 2000,
      onCopied,
      onClick,
      variant = "ghost",
      size,
      ...props
    },
    ref,
  ) => {
    const [status, setStatus] = React.useState<CopyStatus>("idle");
    const timerRef = React.useRef<number | null>(null);

    React.useEffect(
      () => () => {
        if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      },
      [],
    );

    const handleClick = React.useCallback(
      async (event: React.MouseEvent<HTMLButtonElement>) => {
        onClick?.(event);
        const copied = await copyTextToClipboard(value);
        if (copied) onCopied?.(value);
        setStatus(copied ? "copied" : "error");
        if (timerRef.current !== null) window.clearTimeout(timerRef.current);
        timerRef.current = window.setTimeout(() => setStatus("idle"), timeoutMs);
      },
      [onClick, onCopied, timeoutMs, value],
    );

    const activeLabel = status === "copied" ? copiedLabel : status === "error" ? errorLabel : label;

    return (
      <Button
        ref={ref}
        variant={variant}
        size={size ?? (showLabel ? "sm" : "icon")}
        aria-label={activeLabel}
        title={activeLabel}
        onClick={(event) => {
          void handleClick(event);
        }}
        className={cn(!showLabel && "h-7 w-7", className)}
        {...props}
      >
        {status === "copied" ? (
          <Check className="h-3.5 w-3.5 text-emerald-500" aria-hidden="true" />
        ) : (
          <Copy className="h-3.5 w-3.5" aria-hidden="true" />
        )}
        {showLabel ? <span className="text-[13.5px] font-semibold">{activeLabel}</span> : null}
        <span aria-live="polite" className="sr-only">
          {status === "idle" ? "" : activeLabel}
        </span>
      </Button>
    );
  },
);
CopyButton.displayName = "CopyButton";

export { CopyButton };
