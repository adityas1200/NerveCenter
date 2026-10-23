import { queryKeys } from "@/api/queryKeys";
import { ticketsApi } from "@/api/tickets";
import { useMe } from "@/auth/rbac";
import { useAction } from "@/lib/useAction";

/** "Assign to me" on a ticket row: patches the assignee to the signed-in user and refreshes the ticket and overview data. */
export function useAssignToMe(detail: (ticketId: string) => string = (ticketId) => ticketId) {
  const me = useMe();
  return useAction({
    mutationFn: (id: string) => ticketsApi.update(id, { assignee: { id: me.data?.user?.id || "", name: me.data?.user?.name || "" } }),
    invalidate: [queryKeys.tickets.all, ["overview", "tickets"], ["overview", "work"]],
    success: (ticket) => ["Assigned to you", detail(ticket.ticketId)],
    error: "Could not assign",
  });
}
