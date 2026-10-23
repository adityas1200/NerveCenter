import { execFileSync } from "node:child_process";

const stagedOnly = process.argv.includes("--staged");

function run(args: string[], cwd: string) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function safeRun(args: string[], cwd: string) {
  try {
    return run(args, cwd);
  } catch {
    return "";
  }
}

function repoRootFrom(cwd: string) {
  return run(["rev-parse", "--show-toplevel"], cwd);
}

function changedFiles(repoRoot: string) {
  const baseRef = process.env.GOVERNANCE_BASE_REF || "";
  const headRef = process.env.GOVERNANCE_HEAD_REF || "";
  const args = stagedOnly
    ? ["diff", "--name-only", "--diff-filter=ACMR", "--cached"]
    : baseRef && headRef
      ? ["diff", "--name-only", "--diff-filter=ACMR", `${baseRef}...${headRef}`]
      : ["diff", "--name-only", "--diff-filter=ACMR", "HEAD"];
  const raw = safeRun(args, repoRoot);
  if (!raw) return [];
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/\\/g, "/"))
    .filter(Boolean);
}

const BREAKAGE_RISK_PATHS = [
  "frontend/package.json",
  "frontend/package-lock.json",
  "frontend/vite.config.ts",
  "frontend/tailwind.config.js",
  "frontend/postcss.config.js",
  "frontend/eslint.config.js",
  "frontend/tsconfig.json",
  "frontend/tsconfig.node.json",
  "frontend/components.json",
  "frontend/src/types/",
  "frontend/src/data/",
  "frontend/src/store/",
  "frontend/src/lib/",
  "frontend/scripts/",
  "frontend/.husky/",
];

function isRisky(pathname: string) {
  return BREAKAGE_RISK_PATHS.some((prefix) => pathname === prefix || pathname.startsWith(prefix));
}

const repoRoot = repoRootFrom(process.cwd());
const files = changedFiles(repoRoot);
const riskyFiles = files.filter(isRisky);

if (riskyFiles.length === 0) {
  console.log("Breakage alert check passed. No high-risk files changed.");
  process.exit(0);
}

console.error("Breakage alert: high-risk files were modified.");
for (const pathname of riskyFiles) {
  console.error(`- ${pathname}`);
}

const confirmed = String(process.env.BREAKAGE_ALERT_ACK || "").toLowerCase() === "ack";
if (!confirmed) {
  console.error("\nConfirmation gate not satisfied.");
  console.error("Re-run with BREAKAGE_ALERT_ACK=ack after validating downstream impact.");
  process.exit(1);
}

console.log("Breakage alert acknowledged via BREAKAGE_ALERT_ACK=ack.");
process.exit(0);
