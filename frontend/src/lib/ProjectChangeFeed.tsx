import type { ReactNode } from "react";
import { ProjectChangeFeedContext } from "@/lib/projectChangeFeedContext";

/** SPEC-platform-manual-refresh FR-1: explicit actions refresh page data. */
export function ProjectChangeFeed({ children }: { children: ReactNode }) {
  return <ProjectChangeFeedContext.Provider value={false}>{children}</ProjectChangeFeedContext.Provider>;
}
