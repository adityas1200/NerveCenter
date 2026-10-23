import { Link } from "react-router-dom";
import { Button, Card } from "@/components/ui";

/** A panel whose source is missing. `status` is the two-word state: "Not connected" for a platform, "Not set up" for a table we read. */
export function DisconnectedRow({ status, text, actionLabel, to, srTitle }: { status: string; text: string; actionLabel: string; to: string; /** Screen-reader heading for the card. */ srTitle?: string }) {
  return (
    <Card className="flex flex-wrap items-center gap-3 px-4 py-4 text-[14px] text-ink-2">
      <span className="rounded-full border border-line bg-surface-subtle px-2.5 py-0.5 text-[12.5px] font-medium text-ink-3">{status}</span>
      {srTitle ? <h2 className="sr-only">{srTitle}</h2> : null}
      <span className="min-w-0 flex-1">{text}</span>
      <Button asChild size="sm"><Link to={to}>{actionLabel}</Link></Button>
    </Card>
  );
}
