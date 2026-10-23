import { createContext, useContext } from "react";

/**
 * What a component in the thread may do (SPEC-tasks-10 FR-18): send a message as the reader, open a task file.
 * Components never write; a message is the same as typing it, so any write Sonic then makes goes through the
 * approval gate. `canAsk` is false while the task runs, waits on the reader or is stopped, and for viewers.
 */
export interface TaskActions {
  ask?: (text: string) => void;
  canAsk: boolean;
  /** Why asking is off, for the button's title. */
  askBlocked?: string;
  openFile?: (path: string) => void;
  taskId?: string;
}

export const TaskActionsContext = createContext<TaskActions>({ canAsk: false });
export const useTaskActions = () => useContext(TaskActionsContext);

/** The message "Send" sends: Sonic is asked to send exactly this, so the send itself still goes through approval. */
export function sendEmailPrompt(email: { to: string[]; cc: string[]; subject: string; body: string }): string {
  return [`Send this email exactly as written.`, "", `To: ${email.to.join(", ")}`, email.cc.length ? `Cc: ${email.cc.join(", ")}` : null, `Subject: ${email.subject}`, "", email.body].filter((line) => line !== null).join("\n");
}
