import { createContext, useContext } from "react";

export const ProjectChangeFeedContext = createContext(false);

export function useProjectChangeFeedConnected(): boolean {
  return useContext(ProjectChangeFeedContext);
}
