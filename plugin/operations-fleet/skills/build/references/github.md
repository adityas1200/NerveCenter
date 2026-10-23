# GitHub pull requests

Read repository instructions, CODEOWNERS, branch protection or rulesets, required checks, and contribution conventions before creating a change.

- Authenticate `gh` and git with a token from the environment (for example `GH_TOKEN`); never put a token in a remote URL, a file, or a log.
- Create a focused branch from the approved base revision.
- Keep commits understandable and avoid rewriting unrelated history.
- Include the ticket or incident reference according to client convention.
- Report the exact commit SHA and base branch.
- Populate the pull-request summary, causal context, tests, risk, rollout, and rollback.
- Do not bypass required reviews, code-owner approval, signed commits, status checks, or environment protection.
- Re-check required checks after the final push because approvals or results can become stale.

Official sources:

- [About protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
- [Managing branch protection](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/managing-a-branch-protection-rule)
