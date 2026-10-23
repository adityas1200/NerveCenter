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
  let args = ["diff", "--name-only", "--diff-filter=ACMR", "HEAD"];
  if (stagedOnly) {
    args = ["diff", "--name-only", "--diff-filter=ACMR", "--cached"];
  } else {
    const baseRef = process.env.GOVERNANCE_BASE_REF || "";
    const headRef = process.env.GOVERNANCE_HEAD_REF || "";
    if (baseRef && headRef) {
      args = ["diff", "--name-only", "--diff-filter=ACMR", `${baseRef}...${headRef}`];
    }
  }

  const raw = safeRun(args, repoRoot);
  if (!raw) return [];
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/\\/g, "/"))
    .filter(Boolean);
}

const FRONTEND_PREFIX = "frontend/";
const SHOULD_HAVE_DOCS = [
  "src/",
  "package.json",
  "package-lock.json",
  "vite.config.ts",
  "tailwind.config.js",
  "postcss.config.js",
  "eslint.config.js",
  "tsconfig.json",
  "tsconfig.node.json",
  "components.json",
  "scripts/",
  ".husky/",
];

const DOC_PATHS = ["README.md", "STYLE_GUIDE.md"];

function isPolicyRelevant(pathname: string) {
  const relative = pathname.startsWith(FRONTEND_PREFIX) ? pathname.slice(FRONTEND_PREFIX.length) : pathname;
  return SHOULD_HAVE_DOCS.some((prefix) => relative === prefix || relative.startsWith(prefix));
}

function isDocsFile(pathname: string) {
  return DOC_PATHS.some((prefix) => pathname === `${FRONTEND_PREFIX}${prefix}` || pathname === prefix);
}

const repoRoot = repoRootFrom(process.cwd());
const files = changedFiles(repoRoot);
const policyRelevantChanges = files.filter(isPolicyRelevant);

if (policyRelevantChanges.length === 0) {
  console.log("Docs update check passed. No policy-relevant file changes detected.");
  process.exit(0);
}

if (files.some(isDocsFile)) {
  console.log("Docs update check passed. Policy-relevant changes include at least one docs update.");
  process.exit(0);
}

console.error("Docs update check failed.");
console.error("Policy-relevant files changed, but no approved docs file was updated.");
console.error("\nChanged files requiring docs review:");
for (const pathname of policyRelevantChanges) {
  console.error(`- ${pathname}`);
}
console.error("\nUpdate at least one of:");
for (const pathname of DOC_PATHS) {
  console.error(`- ${pathname}`);
}
console.error("\nIf this is a no-behavior/no-contract change, add a short note to README.md or STYLE_GUIDE.md.");
process.exit(1);
