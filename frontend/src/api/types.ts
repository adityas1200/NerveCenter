export type ApiList<T> = T[] | { items: T[] };

export interface UserIdentity {
  type?: "user" | "system";
  id: string;
  name?: string;
}

export interface TicketReference {
  ticketId: string;
  /** The ServiceNow or Jira number, when the ticket lives there; shown in place of the NerveCenter id. */
  number?: string | null;
  title?: string | null;
  status?: string;
  automationStatus?: string | null;
  /** The task working the ticket, when one is. */
  taskId?: string | null;
}

export interface PipelineRun {
  runId: string;
  pipelineId: string;
  name?: string;
  status: string;
  rawState?: string;
  rawLifecycleState?: string;
  startTime?: string;
  endTime?: string;
  durationMs?: number;
  failureSummary?: string | null;
  platform?: string;
  ticket?: TicketReference | null;
  ticketAction?: "create" | "view" | null;
  /** The task that looked at this run: the automatic investigation's, else its ticket's (SPEC-pipelines-01 FR-15). */
  taskId?: string | null;
  alertId?: string | null;
}

/** A scheduled start the detector judged (SPEC-automations-01 FR-41): missed (no run), overdue (newest slot, nothing yet) or late (started after the grace). */
export interface PipelineSlot { at: string; status: "missed" | "overdue" | "late"; runId?: string | null; startedAt?: string | null; taskId?: string | null; alertId?: string | null }

export interface PipelineRunPage { items: PipelineRun[]; total: number; slots: PipelineSlot[]; fetchedAt: string | null }

export interface Pipeline {
  pipelineId: string;
  name: string;
  dagId?: string;
  dagName?: string;
  platform?: string;
  kind?: string;
  database?: string;
  schema?: string;
  /** Cron text, or the structured form the Databricks Jobs API returns. */
  schedule?: string | { quartzCronExpression?: string | null; timezoneId?: string | null; pauseStatus?: string | null } | null;
  enabled?: boolean;
  status: string;
  summary?: string;
  owner?: string | null;
  lastRunId?: string;
  lastRunAt?: string | null;
  lastSuccessAt?: string | null;
  recentRuns?: PipelineRun[];
  /** The ticket that tracks the latest failure (raised for that run, or an open ticket naming the job). */
  ticket?: { ticketId: string; number?: string | null; title?: string; status?: string; source?: string | null } | null;
  /** "create" only when the latest run failed and no ticket tracks it. */
  ticketAction?: "create" | "view" | null;
  /** One word for the business user: healthy, failed, overdue (a scheduled run did not happen), running, paused, no_runs. */
  health?: PipelineHealth;
  /** Next scheduled start, when the schedule is known and not paused. */
  nextRunAt?: string | null;
  /** The scheduled start that was missed, when overdue. */
  dueAt?: string | null;
  /** Median duration of earlier successful runs in the period, once there are enough to call it usual. */
  typicalDurationMs?: number | null;
  /** Scheduled starts in the detector's lookback that never got a run, and ones that started late. */
  missedCount?: number;
  lateCount?: number;
  /** The open automatic alert on this pipeline, with the task investigating it. */
  alert?: { id: string; trigger: string; status: string; openedAt: string; taskId: string | null; ticketId: string | null; investigation: string | null } | null;
  /** What happens automatically when this pipeline fails or is late (Settings > Automations). */
  automation?: { pipelineFailed: string; pipelineLate: string } | null;
}

export type PipelineHealth = "healthy" | "failed" | "overdue" | "running" | "paused" | "no_runs" | "unknown";

export interface OverviewSummary {
  totalPipelines: number;
  latestRunsSucceeded: number;
  failedPipelines: number;
  failedMonitors?: number;
  runningPipelines: number;
  criticalTickets: number;
  pendingApprovals: number;
  openHumanTasks: number;
  activeWorkflows: number;
  activeInvestigations: number;
  scheduledPrevious12Hours: number;
  scheduledNext12Hours: number;
  /** Healthy includes pipelines that are running right now. */
  healthyPipelines?: number;
  overduePipelines?: number;
  pausedPipelines?: number;
}

export interface OverviewAttentionItem {
  id: string;
  kind: "approval" | "human_task" | "ticket" | "pipeline" | "monitor";
  title: string;
  detail: string;
  status: string;
  priority?: string | null;
  owner?: string | null;
  updatedAt?: string | null;
  href: string;
  ticketId?: string | null;
  pipelineId?: string | null;
  runId?: string | null;
  rank: number;
}

export interface OverviewPipelineFailure {
  pipelineId: string;
  name: string;
  platform?: string | null;
  status: string;
  summary?: string | null;
  owner?: string | null;
  lastRunAt?: string | null;
  runId?: string | null;
  ticketId?: string | null;
  investigationStatus:
    "unassigned" | "assigned" | "rca_running" | "rca_complete";
  updatedAt?: string | null;
}

export interface OverviewWorkflowRun {
  id: string;
  workflowId?: string | null;
  status: string;
  ticketId?: string | null;
  currentActivity?: string | null;
  createdAt: string;
  updatedAt?: string;
}

export interface OverviewUpcomingSchedule {
  workflowId: string;
  name: string;
  owner?: string | null;
  nextRunAt: string;
  due: boolean;
  schedule: string;
  timezone: string;
  triggerType: "once" | "interval" | "cron";
  executionStatus?: "active" | "configuration_required";
}

export interface OverviewScheduleWindow {
  from: string;
  to: string;
  lookbackHours: number;
  lookaheadHours: number;
  totalConfigured: number;
  recentRuns: OverviewWorkflowRun[];
  upcoming: OverviewUpcomingSchedule[];
}

export interface OverviewCapability {
  available: boolean;
  reason: string;
}

export type NotificationKind = "ticket.created" | "ticket.status" | "ticket.assigned" | "ticket.priority" | "approval.pending" | "pipeline.failed" | "dq.failed" | "automation" | "ticket.recurrence";

export interface NotificationItem {
  id: string;
  kind: NotificationKind | string;
  title: string;
  detail?: string | null;
  at: string;
  href: string;
  tone: "bad" | "warning" | "success" | "neutral";
  ticketId?: string | null;
  pipelineId?: string | null;
  /** System items (a connection that is down) stay at the top until fixed and never count as unread. */
  pinned?: boolean;
}

export interface NotificationsResponse {
  generatedAt: string;
  since: string | null;
  total: number;
  items: NotificationItem[];
  system?: NotificationItem[];
}

export interface OverviewResponse {
  generatedAt: string;
  capabilities: {
    pipelineMonitoring?: OverviewCapability;
    dqMonitoring: OverviewCapability;
    slaTracking: OverviewCapability;
    upcomingSchedules: OverviewCapability;
  };
  summary: OverviewSummary;
  attentionItems: OverviewAttentionItem[];
  pipelineFailures: OverviewPipelineFailure[];
  workflowSummary: {
    total: number;
    queued: number;
    running: number;
    completed: number;
    failed: number;
    waitingApproval: number;
    waitingHuman: number;
  };
  activeWorkflows: OverviewWorkflowRun[];
  /** "mine" when attentionItems are the caller's own work; "team" when nothing is assigned to them and the shared queue is shown instead. */
  attentionScope?: "mine" | "team";
  /** Echo of the requested reporting window, when one was supplied. */
  window?: { from: string | null; to: string | null } | null;
  /** Tickets the agent closed out after making a real change, in the window, by kind. */
  agentResolved?: { total: number; inWindow: number; pipelines: number; dataQuality: number; items: Array<{ ticketId: string; number?: string | null; title?: string; kind: string; closedAt: string }> };
  ticketSummary: {
    open: number;
    closed: number;
    /** Tickets created inside the reporting window (all time when no window). */
    raised?: number;
    /** Of the tickets raised in the window, how many are still open. */
    openFromWindow?: number;
    /** Tickets closed inside the reporting window. */
    closedInWindow?: number;
    byPriority: {
      p1: number;
      p2: number;
      p3: number;
      p4: number;
      other: number;
    };
  };
  criticalTickets: Ticket[];
  investigations: {
    active: number;
    unassigned: number;
    rcaRunning: number;
    rcaComplete: number;
  };
  scheduleWindow: OverviewScheduleWindow | null;
  monitors?: MonitorsResponse | null;
  pipelines: Pipeline[];
  recentRuns: PipelineRun[];
}

export type MonitorType = "data_quality";

export interface MonitorManifest {
  metadata: {
    id: string;
    name: string;
    origin: "system" | "custom";
    enabled?: boolean;
    owner?: string;
    tags?: string[];
  };
  spec: {
    type: MonitorType;
    description?: string;
    sensor: { toolId: string; input?: Record<string, unknown> };
    condition: { path: string; operator: string; value?: unknown };
    schedule?: { everySeconds?: number; cooldownSeconds?: number };
    policy?: string;
    ticket: { title: string; description?: string; category?: string; type?: string; priority?: string };
  };
}

export interface MonitorDefinition {
  definitionId: string;
  name: string;
  description?: string;
  type: MonitorType;
  origin: "system" | "custom";
  enabled: boolean;
  sensorToolId: string;
  investigation?: { mode: "agent"; id?: string };
  schedule?: { everySeconds?: number; cooldownSeconds?: number };
  manifest: MonitorManifest;
  checkId?: string;
  metric?: string;
  territoryId?: string;
  territoryName?: string;
  snapshot?: string;
  value?: number | null;
  expectedRows?: number;
  actualRows?: number;
  restatementId?: string;
  vendor?: string;
  percentChange?: number;
  thresholdPercent?: number;
  status: string;
  breach: boolean;
  reason?: string;
  source?: string;
  observedAt?: string;
  routing?: { ticketId?: string | null; runId?: string | null; skipped?: boolean; reason?: string } | null;
}

export interface MonitorsResponse {
  generatedAt: string;
  monitors: MonitorDefinition[];
  failed: number;
  passed: number;
  unavailable: number;
  disabled: number;
}

export interface MonitorResponse {
  items: Pipeline[];
  total?: number;
  workspaceTotal?: number;
  summary?: { succeeded: number; failed: number; missed: number; paused: number; idle: number; matchingIdle: number; platforms: string[]; statuses: string[] };
  recentRuns?: PipelineRun[];
  range?: string;
  from?: string | null;
  to?: string | null;
  fetchedAt?: string;
  automationControl?: IncidentAutomationControl;
  diagnostics?: {
    jobsFetched: number;
    runsFetched: number;
    ignoredRuns?: number;
    failedRuns: number;
    unreportedRuns: number;
    unreportedStates?: string[];
    truncated: boolean;
    /** Null when the page reads the stored run history, which has no run cap. */
    maxRuns: number | null;
    /** `ledger` when the page reads the stored history the background fetch keeps; `live` before the first fetch. */
    source?: "ledger" | "live";
    pageSize?: number;
    pipelineAccessScope?: string;
    providers?: Array<{ provider: string; jobsFetched: number; runsFetched: number; maxRuns?: number; error?: string }>;
    sources?: Array<{ provider?: string; id: string; status: "ok" | "unavailable" | "skipped"; count: number; reason?: string; note?: string }>;
  };
}

export interface DataQualityProvider {
  id: "databricks" | "snowflake" | string;
  name: string;
  source: "managed" | "deployment" | string;
  profileId?: string | null;
}

export interface DataQualityColumnMapping {
  checkId: string;
  status: string;
  executedAt: string;
  checkName?: string;
  dataset?: string;
  field?: string;
  rule?: string;
  failedRows?: string;
  message?: string;
  severity?: string;
  recommendedFix?: string;
}

export interface DataQualityConfiguration {
  /** Absent until the backend stores the table; one workspace can hold several result tables. */
  id?: string;
  /** Display name; the backend defaults it to the result table name. */
  name?: string;
  provider: string;
  catalog: string;
  schema: string;
  resultTable: string;
  ruleTable?: string | null;
  warehouseId?: string | null;
  mapping: DataQualityColumnMapping;
  enabled: boolean;
  updatedAt?: string;
  ddl?: string;
  ddlHash?: string;
  discoveredColumns?: DataQualityDdlColumn[];
}

export interface DataQualityDdlColumn {
  name: string;
  normalizedName: string;
  type: string;
  nullable: boolean;
  comment?: string | null;
}

export interface DataQualityAnalysis {
  provider: string;
  catalog: string;
  schema: string;
  resultTable: string;
  warehouseId?: string | null;
  columns: DataQualityDdlColumn[];
  mapping: DataQualityColumnMapping;
  candidates: Record<string, string[]>;
  issues: string[];
  missingRequired: string[];
  confidence: number;
  ddlHash: string;
  agent: { used: boolean; reason?: string | null };
  sample: { used: boolean; rowCount: number };
}

export interface DataQualityResult {
  id: string;
  checkId: string;
  name: string;
  status: string;
  severity: string;
  platform: string;
  /** Name and id of the result table the check came from. */
  table?: string;
  tableId?: string;
  executedAt: string;
  dataset: string;
  field: string;
  rule: string;
  failedRows: number;
  message: string;
  recommendedFix: string;
  ticketAction?: "create" | "view" | null;
  routing?: { ticketId: string | null; runId: string | null; sourceRef?: string } | null;
  ticket?: { ticketId: string; status?: string | null; automationStatus?: string | null } | null;
  reconciliationError?: string;
  /** The stored result's key, and the automatic investigation that looked at it (SPEC-automations-01 FR-42). */
  key?: string;
  taskId?: string | null;
  alertId?: string | null;
}

export interface DataQualityMonitorResponse {
  configured: boolean;
  configuration: DataQualityConfiguration | null;
  providers: DataQualityProvider[];
  range: string;
  from: string | null;
  items: DataQualityResult[];
  /** Results matching the filters across every page, when the server pages (SPEC-platform-11). */
  total?: number;
  offset?: number;
  limit?: number;
  summary: {
    total: number;
    passed: number;
    failed: number;
    warning: number;
    unreported: number;
  };
  source?: {
    mode: "configured" | "unconfigured" | "unavailable" | string;
    platform: string;
    label: string;
    reason: string;
  };
  /** Every configured result table (short form); `configuration` is the first enabled one. */
  tables?: DataQualityTableSummary[];
  /** Per enabled table: whether it was read. */
  sources?: Array<{ tableId: string; table: string; status: "ok" | "unavailable" | string; count: number; reason?: string }>;
  fetchedAt: string;
  reconciliationErrors?: Record<string, string>;
}

export interface DataQualityTableSummary {
  id: string;
  name: string;
  provider: string;
  catalog: string;
  schema: string;
  resultTable: string;
  enabled: boolean;
}

export interface IncidentAutomationControl {
  paused: boolean;
  active: boolean;
  hardDisabled?: boolean;
  updatedAt?: string | null;
  updatedBy?: string | null;
  cancelledIncidents?: number;
  cleanupRequired?: string[];
}

export interface TicketPermissions {
  canView?: boolean;
  canComment?: boolean;
  canRunRca?: boolean;
  canViewRca?: boolean;
  canAssign?: boolean;
  canApprove?: boolean;
  canCompleteHumanTask?: boolean;
  canClose?: boolean;
  canExecuteAction?: boolean;
  canArchive?: boolean;
}

export interface TicketActions {
  openWorkbench?: "open";
  rca?: "run" | "view" | null;
}

export interface ServiceNowIntegrationStatus {
  mode: "disabled" | "fixture" | "live" | string;
  configured: boolean;
  ready: boolean;
  instance?: string;
  source?: "fixture" | "servicenow" | string;
  reason?: string;
}

export interface ServiceNowReference {
  system: "servicenow" | string;
  sysId: string;
  number: string;
  url?: string;
}

export interface TicketKnowledgeReference {
  id: string;
  title: string;
  path?: string | null;
  version?: string | null;
  section?: string | null;
  reason?: string | null;
}

export interface TicketActionPlanStep {
  id: string;
  title: string;
  description?: string | null;
  kind: "validation" | "approval" | "tool" | "workflow" | "human-task" | "informational" | "verification" | "writeback" | string;
  status: string;
  risk?: string;
  toolId?: string | null;
  workflowId?: string | null;
  manual?: boolean;
  approvalRequired?: boolean;
}

export interface TicketAssessment {
  ticketId: string;
  version: number;
  runId?: string | null;
  intent: string;
  category: string;
  ticketType: string;
  confidence: number;
  reason: string;
  evidence?: string[];
  extractedFields?: Record<string, unknown>;
  missingFields?: string[];
  specialistAgent: string;
  recommendedQueue?: string | null;
  agentGoal: string;
  references?: TicketKnowledgeReference[];
  risk: string;
  approvalRequired: boolean;
  approvalReason?: string | null;
  approvalId?: string | null;
  humanReviewRequired?: boolean;
  reassignmentRecommended?: boolean;
  autoExecutable?: boolean;
  executionBlockedReason?: string | null;
  review?: {
    required: boolean;
    status: string;
    workItemId?: string | null;
    queue?: string | null;
    completedAt?: string | null;
    completedBy?: string | null;
  };
  actionPlan: {
    goal: string;
    status: string;
    approvalRequired: boolean;
    approvalStatus: string;
    steps: TicketActionPlanStep[];
  };
  createdAt: string;
}

export interface TicketResolution {
  ticketId: string;
  assessmentVersion: number;
  runId?: string | null;
  actionProposalId?: string | null;
  resolutionType: "knowledge_response" | string;
  summary: string;
  response: string;
  citations: string[];
  evidence?: string[];
  needsHumanReview: boolean;
  reviewReason?: string | null;
  status: string;
  verification?: { passed: boolean; reason?: string; evidence?: Record<string, unknown> } | null;
  createdAt: string;
  completedAt?: string | null;
}

export type TicketAppStatus = "open" | "in_progress" | "waiting_on_you" | "closed";

export type TicketLinkRelation = "recurrence_of" | "amends_fix_of" | "duplicate_of" | "related_to";
export interface TicketLink { relation: TicketLinkRelation; direction: "in" | "out"; ticketId: string; at?: string; auto?: boolean; by?: string }

export interface Ticket {
  ticketId: string;
  /** SPEC-projects-02 FR-20: project-wide, or private to its people and the project's admins. `operators` is an older name for project. */
  visibility?: "project" | "private" | "operators";
  sessionId?: string;
  pipelineId?: string;
  runId?: string;
  platform?: string;
  pipelineName?: string;
  category?: string;
  type?: string;
  tags?: string[];
  source?: string;
  sourceRef?: string;
  sourceKey?: string;
  externalReference?: ServiceNowReference;
  workflow?: string;
  collaborators?: UserIdentity[];
  failureSummary?: string;
  title?: string;
  description?: string;
  creator?: UserIdentity;
  requester?: UserIdentity | null;
  assignee?: UserIdentity | null;
  /** Who signs off on agent actions for this kind of ticket. Backend-routed, shown by name. */
  approver?: UserIdentity | null;
  priority?: string;
  status: string;
  createdAt?: string;
  updatedAt?: string;
  rcaStartedAt?: string | null;
  rcaRunId?: string | null;
  automationStartedAt?: string | null;
  automationRunId?: string | null;
  automationStatus?: string | null;
  automationCompletedAt?: string | null;
  closedAt?: string | null;
  /** The agent task for this ticket, when one exists. */
  taskId?: string | null;
  taskStatus?: string | null;
  agentSummary?: string | null;
  /** The reply's opening paragraphs, for the ticket panel. */
  agentReport?: string | null;
  taskFinishedAt?: string | null;
  /** Changes the agent made while working the ticket. */
  taskChanges?: number;
  /** NerveCenter's four statuses, the same for every source (see backend app/ticket-view.mjs). */
  appStatus?: TicketAppStatus;
  /** The state as the source system names it ("On Hold", "In Review"). */
  sourceStatus?: string | null;
  /** What the agent is doing about the ticket. */
  agent?: { state: "none" | "working" | "waiting" | "done" | "failed"; label: string; summary: string | null; report?: string | null; taskId: string | null; finishedAt?: string | null; changes?: number };
  /** Closed after the agent made at least one real change. */
  resolvedWithAgent?: boolean;
  kind?: "pipeline" | "data_quality" | "access" | "other";
  /** Other tickets this one is linked to; `out` was made from this ticket, `in` from the other. */
  links?: TicketLink[];
  /** Set when the same failure came back after an earlier ticket was resolved (the fix did not hold). */
  recurrence?: { ofTicketId: string; detectedAt?: string | null; auto?: boolean } | null;
  /** Returned by an update: what was written to ServiceNow or Jira. */
  sourceWrite?: { system: string; name: string; number: string; written: string[] } | null;
  waitingReason?:
    | "approval"
    | "human"
    | "external"
    | "time"
    | "input"
    | "workflow"
    | string
    | null;
  context?: Record<string, unknown>;
  resolutionSummary?: string | null;
  workflowIds?: string[];
  activeWorkflowRunId?: string | null;
  classification?: TicketAssessment | null;
  assessmentHistory?: TicketAssessment[];
  assessmentRunId?: string | null;
  assessmentStatus?: string | null;
  ticketResolution?: TicketResolution | null;
  executionStatus?: string | null;
  metadata?: {
    runStartTime?: string | null;
    runEndTime?: string | null;
    durationMs?: number | null;
    costUsd?: number | null;
    category?: string | null;
    source?: string | null;
    agent?: string | null;
    workflow?: string | null;
    rawState?: string | null;
    serviceNow?: {
      sysId: string;
      number: string;
      state?: string;
      priority?: string;
      requester?: string;
      assignedTo?: string;
      assignmentGroup?: string | null;
      category?: string;
    };
    [key: string]: unknown;
  };
  permissions?: TicketPermissions;
  actions?: TicketActions;
  capabilityGap?: {
    type: "CAPABILITY_GAP";
    ticketId: string;
    objective: string;
    missingCapabilityDescription: string;
    searchedCapabilities: Array<Record<string, unknown>>;
    createdAt: string;
  } | null;
}

export interface CreateTicketInput {
  pipelineId?: string;
  runId?: string;
  platform?: string;
  title?: string;
  description?: string;
  category?: string;
  type?: string;
  source?: string;
  sourceRef?: string;
  tags?: string[];
  context?: Record<string, unknown>;
  priority?: string;
  assignee?: UserIdentity;
}

export interface ConnectionProviderStatus extends ConnectionTemplate {
  configured: boolean;
  ready: boolean;
  verified: boolean | null;
  source: "managed" | "deployment" | null;
  profileId?: string | null;
  reason?: string;
  lastTest?: ConnectionProfile["lastTest"];
}

export interface ConnectionTemplateField {
  key: string;
  label: string;
  placeholder?: string;
  required?: boolean;
}

export interface ConnectionTemplate {
  id: "databricks" | "servicenow" | "atlassian" | "snowflake" | string;
  name: string;
  state: "available" | "planned" | string;
  icon?: string;
  description: string;
  fields: ConnectionTemplateField[];
}

export interface ConnectionProfile {
  id: string;
  provider: string;
  name: string;
  config: Record<string, string>;
  enabled: boolean;
  isDefault: boolean;
  credentialConfigured: boolean;
  secretSource: "direct" | "secret-manager" | string;
  secretRefLabel?: string;
  createdAt?: string;
  updatedAt?: string;
  lastTest?: {
    status: "connected" | "failed" | string;
    message: string;
    testedAt?: string;
  } | null;
}

export function listItems<T>(value: ApiList<T> | null | undefined): T[] {
  if (Array.isArray(value)) return value;
  return value?.items ?? [];
}
