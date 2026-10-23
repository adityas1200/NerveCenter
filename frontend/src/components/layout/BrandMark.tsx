import { cn } from "@/lib/utils";

const logoSrc = `${import.meta.env.BASE_URL}nervecenter-logo.svg`;

/** The NerveCenter mark: a blue-to-violet loop with a folded ribbon, served from `public/nervecenter-logo.svg`. */
export function BrandMark({ className, size = 32 }: { className?: string; size?: number }) {
  return <img src={logoSrc} width={size} height={size} alt="NerveCenter" className={cn("shrink-0 select-none", className)} draggable={false} />;
}
