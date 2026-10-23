import type { ReactNode } from "react";
import { PageHeader, type PageHeaderProps } from "@/components/ops/PageHeader";

export function OpsPage({ children, ...header }: PageHeaderProps & { children: ReactNode }) {
  return (
    <>
      <PageHeader {...header} />
      {children}
    </>
  );
}
