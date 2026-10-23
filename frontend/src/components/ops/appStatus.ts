import type { TicketAppStatus } from "@/api/types";

/** NerveCenter's four ticket statuses in words, with one line each on what they mean. */
export const APP_STATUS_LABEL: Record<TicketAppStatus, string> = { open: "Open", in_progress: "In progress", waiting_on_you: "Waiting on you", closed: "Closed" };
export const APP_STATUS_HELP: Record<TicketAppStatus, string> = {
  open: "Nobody owns it and Sonic is not working on it.",
  in_progress: "A person owns it, the source says work started, or Sonic is working on it.",
  waiting_on_you: "Sonic paused on it for your approval or answer.",
  closed: "Resolved or closed, here or in the source system.",
};
