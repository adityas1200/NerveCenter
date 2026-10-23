import { Box, Database, FileText, LayoutDashboard, Plug, Table2, Workflow, type LucideIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { FlowGraph, type FlowNode, type FlowTone } from "@/components/ops/FlowGraph";
import { cn } from "@/lib/utils";
import { AgentCard } from "./AgentCard";
import type { Card, LineageNodeKind, LineageStatus } from "./cards";

/**
 * The lineage Sonic found, as a graph: where the data comes from and what reads it. The broken node is
 * red, what it affects is amber, the rest stays neutral, so the blast radius reads at a glance. Picking
 * a node shows its owner and note under the graph.
 */

const KIND_ICON: Record<LineageNodeKind, LucideIcon> = { source: Plug, table: Table2, view: Table2, job: Workflow, pipeline: Workflow, model: Box, file: FileText, dashboard: LayoutDashboard, board: LayoutDashboard, report: FileText, api: Plug, other: Database };
const STATUS_TONE: Record<LineageStatus, FlowTone> = { ok: "neutral", failed: "bad", stale: "warning", affected: "warning", unknown: "neutral" };
const STATUS_WORD: Record<LineageStatus, string | null> = { ok: null, failed: "Failed", stale: "Stale", affected: "Affected", unknown: null };

export function LineageCard({ card, compact = false, className }: { card: Extract<Card, { kind: "lineage" }>; compact?: boolean; className?: string }) {
  const [picked, setPicked] = useState<string | null>(card.focus);
  const nodes = useMemo<FlowNode[]>(() => card.nodes.map((node) => ({
    id: node.id,
    title: node.label,
    subtitle: [node.system, node.note].filter(Boolean).join(" · ") || node.kind,
    tone: node.status === "ok" || node.status === "unknown" ? (node.id === card.focus ? "focus" : "neutral") : STATUS_TONE[node.status],
    icon: KIND_ICON[node.kind],
    badge: STATUS_WORD[node.status],
  })), [card.nodes, card.focus]);
  const edges = useMemo(() => card.edges.map((edge) => { const target = card.nodes.find((node) => node.id === edge.to); return { from: edge.from, to: edge.to, tone: target && (target.status === "failed" || target.status === "affected" || target.status === "stale") ? STATUS_TONE[target.status] : undefined }; }), [card.edges, card.nodes]);
  const counts = (["failed", "stale", "affected"] as const).map((status) => [status, card.nodes.filter((node) => node.status === status).length] as const).filter(([, n]) => n > 0);
  const node = card.nodes.find((item) => item.id === picked) ?? null;
  return (
    <AgentCard title={card.title} note={counts.length ? counts.map(([status, n]) => `${n} ${status}`).join(" · ") : `${card.nodes.length} ${card.nodes.length === 1 ? "node" : "nodes"}`} compact={compact} className={className}>
      <FlowGraph nodes={nodes} edges={edges} selected={picked} onSelect={(id) => setPicked((current) => (current === id ? null : id))} label={`${card.title}: ${card.nodes.length} data assets`} className={cn(compact ? "-mx-1" : "")} />
      {node ? (
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border-t border-line pt-3 text-[13px]">
          <dt className="text-ink-4">Asset</dt><dd className="min-w-0 break-all font-mono text-[12.5px] text-ink-1">{node.id}</dd>
          <dt className="text-ink-4">Kind</dt><dd className="text-ink-2">{[node.kind, node.system].filter(Boolean).join(" · ")}</dd>
          {node.owner ? <><dt className="text-ink-4">Owner</dt><dd className="text-ink-2">{node.owner}</dd></> : null}
          {node.note ? <><dt className="text-ink-4">Note</dt><dd className="text-ink-2">{node.note}</dd></> : null}
        </dl>
      ) : null}
      {card.note ? <p className="mt-2 text-[12.5px] text-ink-4">{card.note}</p> : null}
    </AgentCard>
  );
}
