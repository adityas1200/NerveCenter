import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

export function ViewAllLink({ to, children = "View all" }: { to: string; children?: ReactNode }) {
  return (
    <Link to={to} className="group inline-flex items-center gap-1 text-[13px] font-semibold text-brand transition-colors hover:text-brand-hover">
      {children}
      <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
    </Link>
  );
}
