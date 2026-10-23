import type { InboxItem } from "@/api/inbox";

/** Approvals and questions still waiting on a person. */
export const needsAction = (item: InboxItem) => item.status === "pending" && (item.kind === "approval" || item.kind === "question");
