import path from 'node:path';
import { repositoryParts, safeSourcePath } from '../sync/integration-sync.mjs';
import { clean } from '../lib/util.mjs';

// What a task needs to raise a pull request: git and gh authenticated with the GitHub connector's token,
// and the repository, base branch and source mirror named in the agent's context.


/**
 * Env that lets `git push` and `gh pr create` authenticate with the connector's token. gh reads GH_TOKEN;
 * git gets an Authorization header scoped to github.com through GIT_CONFIG_*, so the token is never
 * written into a remote URL, a credential file or the repository's config. Empty without a token.
 */
export function githubGitEnv(env = {}) {
  const token = clean(env.GH_TOKEN || env.GITHUB_TOKEN);
  if (!token) return {};
  return {
    GH_TOKEN: token,
    GH_PROMPT_DISABLED: '1',
    GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'http.https://github.com/.extraHeader',
    GIT_CONFIG_VALUE_0: `Authorization: Basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`,
  };
}

/** The GitHub source control from operations.yaml, or null when none is configured or it is unreadable. */
export function githubSource(operations, workspaceDir) {
  const source = operations?.source_control || {};
  if (clean(source.platform).toLowerCase() !== 'github' || !clean(source.repository)) return null;
  try {
    const repository = repositoryParts(source.repository);
    const mirror = path.relative(workspaceDir, safeSourcePath({ dir: workspaceDir }, clean(source.path), repository.folder)).replaceAll('\\', '/');
    return { slug: repository.slug, remote: repository.remote, base: clean(source.default_branch) || 'main', mirror };
  } catch { return null; }
}

/** The agent's instructions for raising a pull request, or nothing when there is no GitHub repository to raise it on. */
export function pullRequestLines({ source, relativeTaskDir, authenticated, agentName, appTools }) {
  if (!source) return [];
  const branchHint = `${agentName.toLowerCase()}/<ticket-or-task-id>-<short-topic>`;
  return [
    `Pull requests: the code repository is ${source.slug} on GitHub (base branch ${source.base}); a read-only mirror of ${source.base} is at ${source.mirror}/ for reading code. ${authenticated ? 'git and gh are already signed in to GitHub with the connector\'s token.' : 'No GitHub token is set on the GitHub connector, so you cannot push or open a pull request: say so and ask the person to add one in Connectors.'}`,
    ...(authenticated ? [
      `- When a fix belongs in code, SQL, a notebook or config in that repository, raise a pull request for it (follow the build skill). Never commit to ${source.base}, never change the mirror, never merge, never force-push.`,
      `- Work in your own clone: git clone --quiet --filter=blob:none --branch ${source.base} ${source.remote} ${relativeTaskDir}/repo, then git -C ${relativeTaskDir}/repo switch -c ${branchHint}.`,
      `- Commit with a clear message, push with git -C ${relativeTaskDir}/repo push -u origin <branch>, then open it with gh pr create --repo ${source.slug} --base ${source.base} --head <branch> --title "…" --body-file ${relativeTaskDir}/pr-body.md. Write the body first: problem, evidence, change, tests, risk, rollback, and the ticket id. Open it as a draft (--draft) unless the person asked for a ready one.`,
      '- Pushing and opening the pull request may pause for a person\'s approval; that is expected. Run gh pr view <number> --repo ' + source.slug + ' --json number,url,state,isDraft,title,headRefName to read it back.',
      ...(appTools ? ['- Then call show_pull_request with what gh returned so NerveCenter shows it as a card, and, for ticket work, comment_on_ticket with the link.'] : []),
    ] : []),
  ];
}
