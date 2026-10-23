import type { NotificationItem } from "@/api/types";

/** Approvals and questions are decided in the Inbox; the bell only tells people what happened. */
export const isNotification = (item: NotificationItem) => !/^agent\.(approval|question)$/.test(String(item.kind)) && item.kind !== "approval.pending";
