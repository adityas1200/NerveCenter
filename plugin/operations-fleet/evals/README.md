# Plugin evaluations

These cases test two things:

1. **Activation** - the request loads the right skill.
2. **Value** - the skill produces a materially better, safer, and more useful result than the no-plugin baseline.

The suite covers direct requests, indirect requests, incomplete inputs, untrusted content, changing public facts, provider edge cases, and multi-skill coordination.

Run from the plugin root with a Claude Code version that supports plugin evaluations:

```bash
claude plugin eval .
```

Review the `WITH`, `W/OUT`, and delta scores. A skill that does not improve realistic cases should be simplified, rewritten, or removed. Add sanitized client-specific cases after live MCP integrations are available; never commit secrets or production data to an eval fixture.
