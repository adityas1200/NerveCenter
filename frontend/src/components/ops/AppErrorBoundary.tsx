import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Catches a crash anywhere below it and shows one clean, on-brand dialog instead of a blank page or
 * the browser/dev-tool default (a raw red overlay with a stack trace dumped at the top of the
 * screen - the "amateur, this-is-a-localhost-project" look). Wraps the whole app in main.tsx, above
 * every provider, and is deliberately self-contained: plain Tailwind classes and native elements
 * only, no app providers or components it would need to trust, since the crash it is catching could
 * be anywhere below it - including inside one of those providers.
 *
 * Covers two different kinds of failure:
 * - A React render/lifecycle error, via the class component's own componentDidCatch/
 *   getDerivedStateFromError (the only way to catch those in React).
 * - A runtime error or unhandled promise rejection outside React's render cycle (a bad fetch
 *   handler, a stray `.then` with no `.catch`), via window-level listeners added in componentDidMount.
 */

interface Props { children: ReactNode }
interface State { error: Error | null }

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[AppErrorBoundary] Unhandled render error", error, info.componentStack);
  }

  componentDidMount() {
    window.addEventListener("error", this.onWindowError);
    window.addEventListener("unhandledrejection", this.onUnhandledRejection);
  }

  componentWillUnmount() {
    window.removeEventListener("error", this.onWindowError);
    window.removeEventListener("unhandledrejection", this.onUnhandledRejection);
  }

  private onWindowError = (event: ErrorEvent) => {
    if (this.state.error) return;
    console.error("[AppErrorBoundary] Unhandled error", event.error || event.message);
    this.setState({ error: event.error instanceof Error ? event.error : new Error(String(event.message || "Unknown error")) });
  };

  private onUnhandledRejection = (event: PromiseRejectionEvent) => {
    if (this.state.error) return;
    const reason = event.reason;
    console.error("[AppErrorBoundary] Unhandled promise rejection", reason);
    this.setState({ error: reason instanceof Error ? reason : new Error(String(reason)) });
  };

  private reload = () => window.location.reload();

  private copyDetails = () => {
    const { error } = this.state;
    const text = [error?.message, error?.stack].filter(Boolean).join("\n\n");
    void navigator.clipboard?.writeText(text).catch(() => {});
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="fixed inset-0 z-[999] flex items-center justify-center bg-[#0B1220]/50 p-4">
        <div className="w-full max-w-md rounded-2xl border border-line-strong bg-raised p-5 shadow-[0_24px_64px_rgba(8,13,26,0.24)]">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-rose-50 text-rose-600">
              <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5" aria-hidden="true"><path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l6.28 11.18c.75 1.334-.213 2.987-1.744 2.987H3.72c-1.53 0-2.493-1.653-1.744-2.987l6.28-11.18ZM10 6a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 6Zm0 8a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clipRule="evenodd" /></svg>
            </span>
            <div className="min-w-0">
              <h1 className="text-[15.5px] font-semibold text-ink-1">Something went wrong</h1>
              <p className="mt-1 text-[13.5px] leading-5 text-ink-3">NerveCenter hit an unexpected error and can&apos;t continue on this page. Reloading usually fixes it; your work up to now is unaffected.</p>
            </div>
          </div>
          <details className="mt-3 rounded-xl border border-line bg-surface-subtle px-3 py-2">
            <summary className="cursor-pointer select-none text-[12.5px] font-medium text-ink-4">Technical details</summary>
            <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[11.5px] leading-[16px] text-ink-4">{error.message}{error.stack ? `\n\n${error.stack}` : ""}</pre>
          </details>
          <div className="mt-4 flex items-center justify-end gap-2">
            <button type="button" onClick={this.copyDetails} className="inline-flex h-9 items-center rounded-xl px-3 text-[13.5px] font-semibold text-ink-3 transition-colors hover:bg-surface-subtle hover:text-ink-1">Copy details</button>
            <button type="button" onClick={this.reload} className="inline-flex h-9 items-center rounded-xl bg-brand px-4 text-[13.5px] font-semibold text-white shadow-sm transition-colors hover:bg-brand-hover">Reload page</button>
          </div>
        </div>
      </div>
    );
  }
}
