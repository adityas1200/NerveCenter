# Bitbucket pull requests

Read repository instructions, default reviewers, branch permissions, merge checks, and required builds before creating a change. The same rules as [GitHub](github.md) apply: a focused branch from the approved base, the ticket reference by client convention, the exact commit SHA and base branch reported, no bypassed reviews or checks, and no merge or deploy.

## Credentials

Take the token and user from environment variables. Never put a token in a remote URL, `.git/config`, a file, a command you echo, or a log. Pass it to git through a one-off credential helper that reads the environment at run time:

```text
git -c credential.helper= \
    -c credential.helper='!f() { echo "username=$BITBUCKET_USER"; echo "password=$BITBUCKET_TOKEN"; }; f' \
    push origin <branch>
```

The single quotes keep the variables unexpanded in the command line.

## Bitbucket Cloud (REST 2.0)

- Git over HTTPS: an API token or repository, project, or workspace access token is the password. With an access token the username is `x-token-auth`; with an Atlassian API token it is your Bitbucket username or `x-bitbucket-api-token-auth`. Push needs write repository scope.
- REST: `Authorization: Bearer <token>` against `https://api.bitbucket.org/2.0`.
- Open the pull request:

```text
POST /2.0/repositories/{workspace}/{repo_slug}/pullrequests
{"title": "...", "description": "...",
 "source": {"branch": {"name": "<branch>"}},
 "destination": {"branch": {"name": "<base>"}},
 "close_source_branch": true}
```

- Read it back with `GET .../pullrequests/{id}` and report `links.html.href`, the id, and both branches. App passwords are being retired; use API tokens or access tokens.

## Bitbucket Data Center

- Git over HTTPS: an HTTP access token (personal, project, or repository) is the password for your username.
- REST: `Authorization: Bearer <token>` (project and repository tokens) or Basic auth with username and token, against `https://<host>/rest/api/latest`.
- Open the pull request:

```text
POST /rest/api/latest/projects/{projectKey}/repos/{repositorySlug}/pull-requests
{"title": "...", "description": "...",
 "fromRef": {"id": "refs/heads/<branch>"},
 "toRef": {"id": "refs/heads/<base>"}}
```

- Read it back and report the pull request id, its `links.self` URL, and both refs.

Confirm current endpoints and scopes with `research` before relying on them.

Official sources:

- [Bitbucket Cloud pull requests API](https://developer.atlassian.com/cloud/bitbucket/rest/api-group-pullrequests/)
- [Bitbucket Cloud API tokens](https://support.atlassian.com/bitbucket-cloud/docs/using-api-tokens/)
- [Bitbucket Cloud access tokens](https://support.atlassian.com/bitbucket-cloud/docs/using-access-tokens/)
- [Bitbucket Data Center HTTP access tokens](https://confluence.atlassian.com/bitbucketserver/http-access-tokens-939515499.html)
- [Bitbucket Data Center REST API](https://developer.atlassian.com/server/bitbucket/rest/)
