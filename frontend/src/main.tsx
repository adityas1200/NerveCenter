import { manualQueryDefaults } from "@/api/queryPolicy";
import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthGate } from "./auth";
import { AppErrorBoundary } from "@/components/ops/AppErrorBoundary";
import { ConfirmDialogHost } from "@/components/ui/confirm-dialog";
import { ToastProvider } from "@/components/ui/toast";
import { SessionNotice } from "@/components/ops/SessionNotice";
import { TooltipProvider } from "@/components/ui/tooltip";
import { projectQueryKeyHash } from "@/api/projects";
import { ProjectProvider } from "@/lib/project";
import { AppRouter } from "@/lib/appRouter";
import { Root } from "./Root";
import "./index.css";

const queryClient = new QueryClient({ defaultOptions: { queries: { queryKeyHashFn: projectQueryKeyHash, ...manualQueryDefaults } } });
const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("OPS UI bootstrap failed: #root element is missing.");
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AppRouter>
          <ToastProvider>
            <SessionNotice />
            <AuthGate>
              <ProjectProvider>
                <TooltipProvider delayDuration={150}>
                  <Root />
                  <ConfirmDialogHost />
                </TooltipProvider>
              </ProjectProvider>
            </AuthGate>
          </ToastProvider>
        </AppRouter>
      </QueryClientProvider>
    </AppErrorBoundary>
  </React.StrictMode>,
);
