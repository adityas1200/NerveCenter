# NerveCenter deployment

One codebase, two platforms. The application lives at the repository root and is the same for both:

```
frontend/  backend/  plugin/  .env.defaults      shared by every platform
deploy/
  buildspec.yml        the single CI entry point; DEPLOY_PLATFORM picks the folder below
  ci-test.sh           tests phase, run by buildspec.yml before every deploy (RUN_TESTS=0 skips)
  aws/                 EC2 + Docker Compose: Dockerfile, compose, nginx, ec2/, ci-deploy*.sh
  databricks/          Databricks App: databricks.yml, app.yaml, build.sh, ci-deploy.sh
```

| `DEPLOY_PLATFORM` | Runs | Uses from the root | Uses from `deploy/` | Guide |
|---|---|---|---|---|
| `aws` (default) | `aws/ci-deploy.sh`, or `aws/ci-deploy-git.sh` with `AWS_DEPLOY_MODE=git` | `frontend/`, `backend/`, `plugin/`, `.env.defaults` | `aws/Dockerfile`, `aws/docker-compose.yml`, `aws/nginx.conf`, `aws/ec2/` | [aws/README.md](aws/README.md) |
| `databricks` | `databricks/ci-deploy.sh` | `frontend/`, `backend/`, `plugin/` | `databricks/databricks.yml`, `databricks/app.yaml`, `databricks/build.sh` | [databricks/README.md](databricks/README.md) |

Every CodeBuild project points at `deploy/buildspec.yml`; only its environment variables differ.
The backend picks its platform adapters at runtime from `OPS_PLATFORM` (auto-detected inside a
Databricks App, `aws` otherwise), so the same `backend/` runs on both.
