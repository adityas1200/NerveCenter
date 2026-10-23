// SPEC-platform-manual-refresh FR-2: existing Overview task-summary definitions.
const PIPELINE_WORDS = /\b(pipeline|pipelines|job|jobs|run|runs|dag|workflow run|databricks)\b/i;
const DQ_WORDS = /\b(data[- ]quality|dq|quality checks?|failing checks?|failed checks?|freshness|null rate|schema drift)\b/i;
function inWindow(task, bounds) {
    const at = Date.parse(task.updatedAt || task.createdAt);
    if (Number.isNaN(at))
        return true;
    if (bounds.from && at < Date.parse(bounds.from))
        return false;
    if (bounds.to && at > Date.parse(bounds.to))
        return false;
    return true;
}
function wording(task) {
    return [task.title, task.summary, task.context?.routine?.objective].filter(Boolean).join(" ");
}
export function domainOf(task) {
    if (task.type === "ticket")
        return "tickets";
    const page = String(task.context?.page?.name || "").toLowerCase();
    if (page === "pipelines")
        return "pipelines";
    if (page === "data quality")
        return "dataQuality";
    if (page === "tickets")
        return "tickets";
    const text = wording(task);
    if (DQ_WORDS.test(text))
        return "dataQuality";
    if (PIPELINE_WORDS.test(text))
        return "pipelines";
    return null;
}
/** A ticket task also counts for Pipelines or Data quality when the ticket is about one of them. */
export function domainsOf(task) {
    const primary = domainOf(task);
    if (task.type !== "ticket")
        return primary ? [primary] : [];
    const ticket = task.context?.ticket;
    const text = [task.title, ticket?.title, ticket?.category, ...(Array.isArray(ticket?.tags) ? ticket?.tags : [])].filter(Boolean).join(" ");
    const extra = DQ_WORDS.test(text) ? "dataQuality" : PIPELINE_WORDS.test(text) || /failed|failure|load/i.test(text) && /daily|job|load|refresh|sync/i.test(text) ? "pipelines" : null;
    return extra ? ["tickets", extra] : ["tickets"];
}
const EMPTY = {
    tickets: "No ticket investigations in this window.",
    pipelines: "No pipeline investigations in this window.",
    dataQuality: "No data quality investigations in this window.",
};
const LINKS = { tickets: "/tasks?type=ticket", pipelines: "/tasks", dataQuality: "/tasks" };
export function agentLine(domain, tasks, bounds) {
    const mine = tasks.filter((task) => domainsOf(task).includes(domain) && inWindow(task, bounds)).sort((a, b) => Date.parse(b.updatedAt || b.createdAt) - Date.parse(a.updatedAt || a.createdAt));
    if (!mine.length)
        return { text: EMPTY[domain], to: LINKS[domain], live: false, latestAt: null };
    const count = (statuses) => mine.filter((task) => statuses.includes(task.status)).length;
    const done = count(["done"]);
    const running = count(["queued", "running"]);
    const waiting = count(["waiting"]);
    const failed = count(["failed"]);
    const noun = domain === "tickets" ? "ticket" : "task";
    const parts = [];
    if (done)
        parts.push(`${done} ${noun}${done === 1 ? "" : "s"} ${domain === "tickets" ? "investigated" : "finished"}`);
    if (running)
        parts.push(`${running} running`);
    if (waiting)
        parts.push(`${waiting} waiting on you`);
    if (failed)
        parts.push(`${failed} failed`);
    const latest = mine[0];
    const routine = latest.type === "routine" && latest.context?.routine ? `Routine "${latest.title.replace(/ · test run$/, "")}" ran last` : null;
    const text = [parts.join(", "), routine].filter(Boolean).join(" · ") || `${mine.length} task${mine.length === 1 ? "" : "s"}`;
    return { text, to: LINKS[domain], live: running > 0 || waiting > 0, latestAt: latest.updatedAt || latest.createdAt };
}
export function agentLines(tasks, bounds) {
    return { tickets: agentLine("tickets", tasks, bounds), pipelines: agentLine("pipelines", tasks, bounds), dataQuality: agentLine("dataQuality", tasks, bounds) };
}
export function agentToday(tasks, bounds) {
    const mine = tasks.filter((task) => inWindow(task, bounds)).sort((a, b) => Date.parse(b.updatedAt || b.createdAt) - Date.parse(a.updatedAt || a.createdAt));
    return {
        finished: mine.filter((task) => task.status === "done").length,
        working: mine.filter((task) => task.status === "queued" || task.status === "running").length,
        total: mine.length,
        last: mine[0] ?? null,
    };
}
