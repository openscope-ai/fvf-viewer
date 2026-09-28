# Deployment — Container, Cloud Build & Cloud Run

Production hosting for the FVF Viewer (ADR 0002 slice): a
multi-stage Docker image served by Cloud Run in `europe-west3`, scaling to zero
when idle, with a hard `max-instances=5` cost ceiling.

| File                                 | Purpose                                                                          |
| :----------------------------------- | :------------------------------------------------------------------------------- |
| [`Dockerfile`](Dockerfile)           | Multi-stage build: wasm-pack → pnpm (server `tsc` + Vite) → minimal Node runtime |
| [`cloudbuild.yaml`](cloudbuild.yaml) | Cloud Build pipeline: build → push (Artifact Registry) → deploy (Cloud Run)      |

## Build order (why multi-stage)

The Vite SPA imports the compiled Wasm package (`crates/fvf-wasm/pkg`) via the
`@fvf/fvf-wasm` workspace package, so the artifacts and generated `.d.ts` must
exist before Vite compiles. The Dockerfile enforces the topology:

1. **wasm-builder** (`rust:1.98-slim-bookworm`): `rustup target add
wasm32-unknown-unknown`, wasm-pack 0.13.1 (version asserted in the layer),
   `cargo fetch --locked` for a cacheable dependency layer, then
   `wasm-pack build crates/fvf-wasm --target web`.
2. **site-builder** (`node:22-bookworm-slim`): workspace manifests copied and
   `pnpm install --frozen-lockfile` before any source (cache-friendly), the
   Wasm `pkg/` copied from stage 1, then `pnpm --filter @fvf/server build &&
pnpm --filter @fvf/web build`, and finally a prod-only prune install so the
   runtime copies carry no dev tooling.
3. **runtime** (`node:22-bookworm-slim`): only `apps/server` (compiled), the
   `apps/web` build output, production `node_modules`, `USER node`,
   `PORT=8080`, and a `HEALTHCHECK` hitting `/api/health`.

`.dockerignore` keeps the build context clean and, critically, excludes
`test-data/` (empirical captures are local-only and must never enter an image),
plus `.git`, `node_modules`, `target`, and stale `dist`/`pkg` output.

## Prerequisites (one-time project setup)

```sh
gcloud auth login
gcloud config set project PROJECT_ID
gcloud services enable cloudbuild.googleapis.com \
                       run.googleapis.com \
                       artifactregistry.googleapis.com

# Artifact Registry docker repository (region must match _REGION)
gcloud artifacts repositories create fvf-viewer \
  --repository-format=docker --location=europe-west3

# Let Cloud Build push images and deploy Cloud Run services in this project
gcloud projects add-iam-policy-binding PROJECT_ID \
  --member serviceAccount:PROJECT_NUMBER@cloudbuild.gserviceaccount.com \
  --role roles/run.admin
gcloud projects add-iam-policy-binding PROJECT_ID \
  --member serviceAccount:PROJECT_NUMBER@cloudbuild.gserviceaccount.com \
  --role roles/artifactregistry.writer

# Required for `gcloud run deploy` from Cloud Build: lets the build act as the
# runtime service account (otherwise the deploy step fails with an actAs denial).
gcloud projects add-iam-policy-binding PROJECT_ID \
  --member serviceAccount:PROJECT_NUMBER@cloudbuild.gserviceaccount.com \
  --role roles/iam.serviceAccountUser
```

## Local container verification

```sh
docker build -f deploy/Dockerfile -t fvf-viewer .
docker run --rm -p 8080:8080 fvf-viewer
curl -s http://127.0.0.1:8080/api/health   # {"status":"ok","version":"...","uptimeSeconds":...}
curl -sI http://127.0.0.1:8080/            # HSTS + CSP + nosniff header spot-check
docker stop $(docker ps -qf ancestor=fvf-viewer)
```

The first build compiles the Wasm crate and installs toolchains (several
minutes); subsequent builds reuse the dependency layers.

## Deploy via Cloud Build

From the repository root:

```sh
# COMMIT_SHA is passed explicitly: image tags must always resolve, and
# gcloud's automatic git detection does not populate it on every setup.
gcloud builds submit --config deploy/cloudbuild.yaml \
  --substitutions=COMMIT_SHA=$(git rev-parse HEAD) .
```

The pipeline tags images `${COMMIT_SHA}` and `latest`, pushes them to Artifact
Registry, and deploys the exact `${COMMIT_SHA}` image.

> If the deploy step warns `Setting IAM policy failed` on the **first** deploy,
> grant public access once (it persists across later deploys):
> `gcloud run services add-iam-policy-binding fvf-viewer --region=europe-west3 --member=allUsers --role=roles/run.invoker`

## Cloud Run service configuration

| Setting       | Value                      | Rationale                                                                                                                                     |
| :------------ | :------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------- |
| Region        | `europe-west3` (Frankfurt) | Owner decision 2026-09-20: operator based in Germany; single-region deployment. Revisit a US region only if measured US load-time complaints. |
| Max instances | `5`                        | Hard cost ceiling; documented budget cap below.                                                                                               |
| Min instances | `0`                        | Scale to zero when idle — a personal-scale viewer pays nothing at rest.                                                                       |
| Concurrency   | `80`                       | Requests per instance (static serving; default-class setting).                                                                                |
| CPU / Memory  | `1` / `512Mi`              | Static file serving + on-the-fly brotli/gzip of ~160 KB wasm is comfortably within this envelope.                                             |
| Port          | `8080`                     | Matches `PORT` in the image; Cloud Run injects `PORT` on the container.                                                                       |
| Ingress       | `--allow-unauthenticated`  | Public viewer. No user data, no uploads (captures are processed client-side).                                                                 |

## Budget alert setup (required by issue 4.2)

1. Find your billing account: `gcloud billing accounts list`.
2. Create an alert (example: 5 EUR/month ceiling, notify at 50/90/100 %).
   `--filter-projects` needs the numeric project number, and the threshold
   dict syntax uses `percent=`:

```sh
gcloud billing budgets create \
  --billing-account=BILLING_ACCOUNT_ID \
  --display-name="fvf-viewer monthly cap" \
  --budget-amount=5EUR \
  --threshold-rule=percent=0.5 \
  --threshold-rule=percent=0.9 \
  --threshold-rule=percent=1.0 \
  --filter-projects=projects/PROJECT_NUMBER
```

3. Attach notification email addresses (or a Pub/Sub topic for programmatic
   alerts) in the console: **Billing → Budgets & alerts → fvf-viewer monthly
   cap → Manage notifications**.

The alert informs; `max-instances=5` plus scale-to-zero enforces the ceiling.

## Operational notes

- **Custom domain / TLS / launch gate:** see `deploy/launch-checklist.md` — not part of this
  configuration.
- **Rollback:** redeploy a prior image tag (full Artifact Registry path —
  `europe-west3-docker.pkg.dev/PROJECT_ID/fvf-viewer/fvf-viewer:<commit-sha>`):
  `gcloud run deploy fvf-viewer --image <full-image-path>:<commit-sha> --region europe-west3`.
- **Teardown:** `gcloud run services delete fvf-viewer --region europe-west3`
  and delete the Artifact Registry repo when retiring the project.
