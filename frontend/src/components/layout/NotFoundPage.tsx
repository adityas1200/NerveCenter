import { Link } from "react-router-dom";
import { PageHeader } from "@/components/ops/PageHeader";
import { Card } from "@/components/ui";

/** The catch-all route. Quiet: one line and a way back, no redirect that hides a bad link. */
export function NotFoundPage() {
  return (
    <>
      <PageHeader title="Page not found" />
      <Card className="flex flex-col items-start gap-2 px-5 py-6">
        <p className="text-[14.5px] font-medium text-ink-1">This page does not exist</p>
        <p className="text-[13.5px] text-ink-4">The link may be old or mistyped.</p>
        <Link to="/" className="mt-1 text-[13.5px] font-semibold text-brand hover:text-brand-hover">Go to Overview</Link>
      </Card>
    </>
  );
}
