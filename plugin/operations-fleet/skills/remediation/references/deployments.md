# Deployment discipline

- Identify the exact approved commit, image digest, package checksum, notebook bundle, or release artifact.
- Promote the same artifact between environments. Do not rebuild an unspecified equivalent.
- Confirm target environment, current deployed version, configuration, dependencies, data migrations, and change window.
- Define smoke checks, health signals, business verification, stop conditions, and rollback before execution.
- Use a bounded rollout such as dev, canary, or staged deployment when supported.
- Record deployment ID, artifact identity, initiator, timestamps, and provider state.
- Separate delivery success from application health and business recovery.
- Treat a provider timeout as ambiguous until current deployment state is read.
- Do not bypass protected environments or required reviewers.

GitHub environment protections can require reviewers and other conditions before a deployment proceeds:
[GitHub deployment environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments).
