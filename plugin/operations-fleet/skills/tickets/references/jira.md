# Jira notes

Confirm current Jira behavior through official Atlassian documentation before relying on API details.

## Reading work

- Use JQL or a saved filter for repeatable queue definitions.
- Resolve `currentUser()` or the authenticated account rather than guessing a display name.
- Request the fields required for the decision; some fields and expansions are not returned by default.
- Paginate until the requested scope is complete. Do not assume the first page is the full queue.
- Preserve issue key and numeric ID when available.
- Treat custom-field names and IDs as client configuration because they vary by site.

## Writing work

- Refresh the issue, edit metadata, and available transitions immediately before writing.
- Use the transition ID available for that issue, not a memorized status label.
- Jira Cloud REST v3 uses Atlassian Document Format for several rich-text fields.
- Some operations are asynchronous. Follow the provider task record rather than treating acceptance as completion.
- Read back changed fields, comments, links, and status.

Official sources:

- [JQL advanced search](https://support.atlassian.com/jira-software-cloud/docs/use-advanced-search-with-jira-query-language-jql/)
- [Jira Cloud REST API v3](https://developer.atlassian.com/cloud/jira/platform/rest/v3/)
- [Issue operations](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/)
