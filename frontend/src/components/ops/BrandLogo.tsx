/* eslint-disable react-refresh/only-export-components */
import { siAtlassian, siConfluence, siDatabricks, siGit, siGithub, siJira, siSnowflake } from "simple-icons";
import { cn } from "@/lib/utils";

/**
 * Real brand marks for the systems NerveCenter connects to, in their brand colour. Brand logos are one
 * of the few places colour is allowed. Every other system gets a monochrome glyph from its caller.
 */

export interface BrandMark { path: string; hex: string; viewBox?: string }

// ServiceNow is not in simple-icons. This is the green "o" of the official ServiceNow wordmark (public
// domain, Wikimedia Commons "ServiceNow logo.svg"), the mark ServiceNow uses as its app icon, in the
// current brand green. The viewBox crops the wordmark's coordinates to that letter.
const SERVICENOW: BrandMark = {
  hex: "62D84E",
  viewBox: "95.3 5.06 15 15",
  path: "m102.8 5.762c-4.2 0-7.5 3.3-7.5 7.5 0 2.2 0.9 4.2 2.3 5.6 0.5 0.5 1.4 0.5 2 0.1 0.8-0.7 2-1.1 3.2-1.1 1.3 0 2.3 0.4 3.2 1.1 0.6 0.5 1.4 0.4 2-0.2 1.4-1.4 2.3-3.3 2.3-5.5-0.1-4.1-3.4-7.5-7.5-7.5m-0.1 11.4c-2.3 0-3.8-1.7-3.8-3.8s1.5-3.8 3.8-3.8 3.8 1.7 3.8 3.8-1.5 3.8-3.8 3.8",
};

const BRANDS: Record<string, BrandMark> = {
  databricks: siDatabricks,
  snowflake: siSnowflake,
  atlassian: siAtlassian,
  jira: siJira,
  servicenow: SERVICENOW,
  confluence: siConfluence,
  git: siGit,
  github: siGithub,
  gh: siGithub,
};

export function brandMark(id: string | undefined | null): BrandMark | undefined {
  return id ? BRANDS[id.toLowerCase()] : undefined;
}

/** The mark alone, sized by `className` (default 16px). Renders nothing for a system without a mark. */
export function BrandLogo({ brand, className, title }: { brand: string | undefined | null; className?: string; title?: string }) {
  const mark = brandMark(brand);
  if (!mark) return null;
  return (
    <svg viewBox={mark.viewBox ?? "0 0 24 24"} className={cn("h-4 w-4 shrink-0", className)} role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true} focusable="false" data-brand={brand?.toLowerCase()}>
      <path d={mark.path} fill={`#${mark.hex}`} fillRule="evenodd" />
    </svg>
  );
}

/** Menu-icon shaped wrappers, for places that take an icon component (menus, buttons). */
export const JiraLogo = ({ className }: { className?: string }) => <BrandLogo brand="jira" className={className} />;
export const ServiceNowLogo = ({ className }: { className?: string }) => <BrandLogo brand="servicenow" className={className} />;
