import { plainSyncError, syncState } from "./knowledgeText";

describe("knowledgeText", () => {
  it("turns git errors into one sentence", () => {
    expect(plainSyncError("fatal: Authentication failed for 'https://github.com/acme/runbooks.git/'")).toBe("The repository rejected the access token.");
    expect(plainSyncError("fatal: repository 'https://github.com/acme/nope.git/' not found")).toBe("The repository or branch could not be found.");
    expect(plainSyncError("fatal: unable to access 'https://github.com/acme/runbooks.git/': Could not resolve host: github.com")).toBe("The repository could not be reached.");
    expect(plainSyncError("2 uncommitted files from the agent block the sync")).toBe("Sync is waiting until the agent's drafts are reviewed.");
    expect(plainSyncError("error: something odd happened\nmore lines")).toBe("something odd happened.");
    expect(plainSyncError("")).toBe("");
  });

  it("describes sync state from what the base carries", () => {
    expect(syncState({ kind: "git", lastSyncAt: null, lastError: null })).toMatchObject({ tone: "neutral", label: "Not synced yet" });
    expect(syncState({ kind: "git", lastSyncAt: new Date(Date.now() - 3_600_000).toISOString(), lastError: null })).toMatchObject({ tone: "ok", label: "Synced", text: "synced 1h ago" });
    expect(syncState({ kind: "git", lastSyncAt: "2026-09-24T09:00:00Z", lastError: "fatal: nope" })).toMatchObject({ tone: "bad", label: "Sync failed" });
    expect(syncState({ kind: "local", lastSyncAt: null, lastError: null })).toMatchObject({ tone: "neutral", label: "Local folder" });
  });
});
