/* eslint-disable react-refresh/only-export-components */
import * as React from "react";
import { AlertDialog } from "@/components/ui/alert-dialog";

/**
 * One app-wide confirm dialog in place of the browser's `window.confirm`, which renders as a bare
 * system box pinned to the top of the window. `confirmAction` resolves true when the person confirms
 * and false when they cancel or press Escape. `ConfirmDialogHost` is mounted once at the app root;
 * without it (unit tests rendering a single page) the call falls back to `window.confirm`.
 */

export interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Rose icon, strip and button for removing or deleting something. */
  destructive?: boolean;
}

type ConfirmRequest = ConfirmOptions & { resolve: (ok: boolean) => void };

let showConfirm: ((request: ConfirmRequest) => void) | null = null;

export function confirmAction(options: ConfirmOptions): Promise<boolean> {
  if (!showConfirm) {
    const text = options.description ? `${options.title}\n\n${options.description}` : options.title;
    return Promise.resolve(Boolean(window.confirm(text)));
  }
  const show = showConfirm;
  return new Promise((resolve) => show({ ...options, resolve }));
}

export function ConfirmDialogHost() {
  const [request, setRequest] = React.useState<ConfirmRequest | null>(null);
  const [open, setOpen] = React.useState(false);
  const current = React.useRef<ConfirmRequest | null>(null);

  const settle = React.useCallback((ok: boolean) => {
    current.current?.resolve(ok);
    current.current = null;
  }, []);

  React.useEffect(() => {
    showConfirm = (next) => {
      // A second confirm while one is open cancels the first, so no caller waits forever.
      settle(false);
      current.current = next;
      setRequest(next);
      setOpen(true);
    };
    return () => {
      showConfirm = null;
      settle(false);
    };
  }, [settle]);

  if (!request) return null;
  return (
    <AlertDialog
      open={open}
      onOpenChange={setOpen}
      title={request.title}
      description={request.description}
      confirmLabel={request.confirmLabel ?? "Confirm"}
      cancelLabel={request.cancelLabel ?? "Cancel"}
      destructive={request.destructive}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  );
}
