/* eslint-disable react-refresh/only-export-components */
import * as React from "react";
import * as ToastPrimitives from "@radix-ui/react-toast";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

type ToastLevel = "info" | "success" | "warning" | "error";

interface ToastMessage {
  id: string;
  title: string;
  description?: string;
  level: ToastLevel;
}

interface ToastApi {
  notify: (message: Omit<ToastMessage, "id">) => void;
  info: (title: string, description?: string) => void;
  success: (title: string, description?: string) => void;
  warning: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
}

const ToastContext = React.createContext<ToastApi | null>(null);

const ICONS = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: AlertTriangle,
};

const TONES = {
  info: "border-blue-200 bg-blue-50 text-blue-900",
  success: "border-emerald-200 bg-emerald-50 text-emerald-900",
  warning: "border-amber-200 bg-amber-50 text-amber-900",
  error: "border-rose-200 bg-rose-50 text-rose-900",
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [messages, setMessages] = React.useState<ToastMessage[]>([]);

  const remove = React.useCallback((id: string) => {
    setMessages((current) => current.filter((item) => item.id !== id));
  }, []);

  const notify = React.useCallback((message: Omit<ToastMessage, "id">) => {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setMessages((current) => [...current, { ...message, id }]);
  }, []);

  const api = React.useMemo<ToastApi>(
    () => ({
      notify,
      info: (title, description) => notify({ title, description, level: "info" }),
      success: (title, description) => notify({ title, description, level: "success" }),
      warning: (title, description) => notify({ title, description, level: "warning" }),
      error: (title, description) => notify({ title, description, level: "error" }),
    }),
    [notify],
  );

  return (
    <ToastContext.Provider value={api}>
      <ToastPrimitives.Provider swipeDirection="right" duration={5000}>
        {children}
        {messages.map((message) => (
          <ToastItem key={message.id} message={message} onOpenChange={(open) => !open && remove(message.id)} />
        ))}
        <ToastPrimitives.Viewport className="fixed bottom-4 right-4 z-[100] flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2 outline-none" />
      </ToastPrimitives.Provider>
    </ToastContext.Provider>
  );
}

function ToastItem({
  message,
  onOpenChange,
}: {
  message: ToastMessage;
  onOpenChange: (open: boolean) => void;
}) {
  const Icon = ICONS[message.level];
  return (
    <ToastPrimitives.Root
      className={cn("grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 rounded-xl border px-3 py-3 shadow-lg", TONES[message.level])}
      duration={message.level === "error" ? 9000 : undefined}
      onOpenChange={onOpenChange}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0">
        <ToastPrimitives.Title className="text-[13.5px] font-semibold">{message.title}</ToastPrimitives.Title>
        {message.description ? (
          <ToastPrimitives.Description className="mt-1 break-words text-[12.5px] leading-[18px] opacity-90">
            {message.description}
          </ToastPrimitives.Description>
        ) : null}
      </div>
      <ToastPrimitives.Close className="rounded-md p-0.5 opacity-70 transition hover:bg-raised/60 hover:opacity-100">
        <X className="h-3.5 w-3.5" />
        <span className="sr-only">Dismiss</span>
      </ToastPrimitives.Close>
    </ToastPrimitives.Root>
  );
}

export function useToast() {
  const ctx = React.useContext(ToastContext);
  if (!ctx) {
    return {
      notify: () => undefined,
      info: () => undefined,
      success: () => undefined,
      warning: () => undefined,
      error: () => undefined,
    } satisfies ToastApi;
  }
  return ctx;
}
