#!/usr/bin/env node
import { execFileSync } from "node:child_process";

const PROTECTED_BRANCHES = new Set(["zs-sandbox", "zs-dev", "release", "main", "master"]);
const TEST_PATH_RE = /(^|\/)(__tests__|tests?)\/|(\.(test|spec)\.(js|jsx|ts|tsx|mts)$)/i;

function git(args, options = {}) {
  return execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  }).trim();
}

function safeGit(args) {
  try {
    return git(args);
  } catch {
    return "";
  }
}

function stagedEntries() {
  const raw = safeGit(["diff", "--cached", "--name-status", "--"]);
  if (!raw) return [];
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\t+/);
      return {
        status: parts[0] || "",
        paths: parts.slice(1).map((value) => value.replace(/\\/g, "/")),
      };
    });
}

function pathExistsInHead(pathname) {
  try {
    git(["cat-file", "-e", `HEAD:${pathname}`]);
    return true;
  } catch {
    return false;
  }
}

function isExistingTestEdit(entry) {
  const status = entry.status[0];
  if (status === "A") return false;
  return entry.paths.some((pathname) => TEST_PATH_RE.test(pathname) && pathExistsInHead(pathname));
}

function main() {
  const errors = [];
  const branch = safeGit(["branch", "--show-current"]);

  if (PROTECTED_BRANCHES.has(branch)) {
    errors.push(`Protected branch '${branch}' is not a development branch. Create a feature branch before committing.`);
  }

  const existingTestEdits = stagedEntries().filter(isExistingTestEdit);
  const testAck = String(process.env.AI_TEST_CHANGE_ACK || "").toLowerCase() === "ack";
  if (existingTestEdits.length > 0 && !testAck) {
    errors.push(
      [
        "Existing test files are staged. Existing tests are executable requirements.",
        "Set AI_TEST_CHANGE_ACK=ack only after a human confirms the intended behavior change.",
        ...existingTestEdits.flatMap((entry) => entry.paths.map((pathname) => `- ${pathname}`)),
      ].join("\n"),
    );
  }

  if (errors.length > 0) {
    console.error("AI guardrails check failed.");
    for (const error of errors) {
      console.error(`\n${error}`);
    }
    process.exit(1);
  }

  console.log("AI guardrails check passed.");
}

main();
