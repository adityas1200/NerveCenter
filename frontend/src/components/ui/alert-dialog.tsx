import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { AlertTriangle, HelpCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export interface AlertDialogProps {
  /** Controlled open state. Omit to let the dialog manage its own state. */
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Element that opens the dialog, rendered through `asChild`. */
  trigger?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Uses the destructive tone for the icon and confirm button. */
  destructive?: boolean;
  confirmDisabled?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel?: () => void;
  /** Optional extra body content rendered between the header and the footer. */
  children?: React.ReactNode;
  className?: string;
}

function AlertDialog({
  open,
  defaultOpen = false,
  onOpenChange,
  trigger,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  confirmDisabled = false,
  onConfirm,
  onCancel,
  children,
  className,
}: AlertDialogProps) {
  const isControlled = open !== undefined;
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState<boolean>(defaultOpen);
  const [pending, setPending] = React.useState<boolean>(false);
  const [confirmError, setConfirmError] = React.useState(false);
  const isOpen = isControlled ? open : uncontrolledOpen;

  const setOpen = React.useCallback(
    (next: boolean) => {
      if (!next) setConfirmError(false);
      if (!isControlled) setUncontrolledOpen(next);
      onOpenChange?.(next);
    },
    [isControlled, onOpenChange],
  );

  const handleOpenChange = React.useCallback(
    (next: boolean) => {
      if (!next) onCancel?.();
      setOpen(next);
    },
    [onCancel, setOpen],
  );

  const handleCancel = React.useCallback(() => {
    onCancel?.();
    setOpen(false);
  }, [onCancel, setOpen]);

  const handleConfirm = React.useCallback(async () => {
    setPending(true);
    setConfirmError(false);
    try {
      await onConfirm();
      setOpen(false);
    } catch {
      setConfirmError(true);
    } finally {
      setPending(false);
    }
  }, [onConfirm, setOpen]);

  const Icon = destructive ? AlertTriangle : HelpCircle;
  // Radix warns when its generated `aria-describedby` target is missing, so the
  // attribute is dropped entirely when no description is supplied.
  const describedByProps: { "aria-describedby"?: undefined } = description
    ? {}
    : { "aria-describedby": undefined };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Content
          role="alertdialog"
          {...describedByProps}
          onPointerDownOutside={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
          className={cn(
            "dialog-pop fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-[440px] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl border border-line bg-raised shadow-[0_32px_80px_-24px_rgba(8,13,26,0.45),0_0_0_1px_rgba(8,13,26,0.04)] focus:outline-none",
            className,
          )}
        >
          {/* Thin tone strip: rose for a destructive action, brand for everything else. */}
          <div
            aria-hidden="true"
            className={cn(
              "h-1 w-full bg-gradient-to-r",
              destructive ? "from-rose-500 via-rose-400 to-orange-400" : "from-brand via-brand-violet to-brand-cyan",
            )}
          />
          <div className="flex items-start gap-4 px-6 pb-5 pt-6">
            <span
              className={cn(
                "dialog-icon-pop flex h-11 w-11 shrink-0 items-center justify-center rounded-full ring-[6px]",
                destructive ? "bg-rose-100 text-rose-600 ring-rose-50" : "bg-brand-soft text-brand ring-indigo-50/60",
              )}
            >
              <Icon className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0 pt-0.5">
              <DialogTitle className="text-[16px] leading-6">{title}</DialogTitle>
              {description ? (
                <DialogDescription className="mt-1.5 text-[13.5px] leading-[1.6]">{description}</DialogDescription>
              ) : null}
            </div>
          </div>
          {children ? (
            <div className="px-6 pb-5 pl-[84px] text-[13.5px] leading-5 tracking-normal text-ink-3">
              {children}
            </div>
          ) : null}
          {confirmError ? <p role="alert" className="px-6 pb-4 text-[13px] text-rose-700">The action could not be completed. Try again.</p> : null}
          <div className="flex flex-col-reverse gap-2 border-t border-line bg-surface-tint px-6 py-3.5 sm:flex-row sm:justify-end">
            <Button
              variant="outline"
              size="sm"
              className="border border-line bg-raised px-4 text-ink-2 hover:border-line-strong"
              onClick={handleCancel}
              disabled={pending}
            >
              {cancelLabel}
            </Button>
            <Button
              variant={destructive ? "destructive" : "primary"}
              size="sm"
              className={cn(
                "min-w-[96px] px-4 shadow-sm transition-[background-color,box-shadow,transform] active:scale-[0.98]",
                destructive ? "hover:shadow-[0_6px_16px_-6px_rgba(220,38,38,0.6)]" : "hover:shadow-[0_6px_16px_-6px_rgba(99,102,241,0.6)]",
              )}
              disabled={pending || confirmDisabled}
              onClick={() => {
                void handleConfirm();
              }}
            >
              {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
              {confirmLabel}
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}
AlertDialog.displayName = "AlertDialog";

export { AlertDialog };
