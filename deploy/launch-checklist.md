# Launch checklist — fvf-viewer.com (issue #22)

Execution order; every gate is pass/fail before the DNS switch. The Stage 5
launch gates (E2E suite, performance validation, Wasm conformance) shipped
green in v0.8.0, and Stages 2–3 are merged — the gate condition for the
public cutover is satisfied.

## 1. Cloud Run service is live (done in 0.7.0, re-verified per release)

- [x] `gcloud run services describe fvf-viewer --region=europe-west3`
      reports ready with the current image.
- [x] `https://fvf-viewer-<hash>-<project>.a.run.app/api/health` returns
      200 with the released `version`.

## 2. Custom domain + TLS (owner action — GCP console / gcloud)

- [ ] Cloud Run custom domain mapping `fvf-viewer.com` (and decide
      `www.` redirect) created; Google-managed certificate issued
      (provisioning can take ~15–90 minutes after DNS verification).
- [ ] Registrar DNS: `A`/`AAAA` (or `CNAME` for www) records pointed at
      the mapping targets shown by `gcloud run domain-mappings describe`.

## 3. Email records (owner action — registrar DNS)

- [ ] MX for `fvf-viewer.com` (or explicit "no mail" Null MX `0 .` if the
      domain never sends/receives).
- [ ] SPF (`v=spf1 -all` for no-send, or the sending service's include).
- [ ] DKIM key published if any mail is sent.
- [ ] DMARC policy published (`v=DMARC1; p=reject; ...` with rua if
      desired).
- [ ] mail-tester (or equivalent) ≥ passing when mail is enabled.

## 4. Production smoke test (automated — after DNS cutover)

```sh
FVF_E2E_BASE_URL=https://fvf-viewer.com pnpm test:e2e
```

- [ ] All 28 specs green against the live deployment (health version,
      SPA shell, JSON 404, CSP compliance, UI flows).
- [ ] Manual pass: load page → drop fixture → export CSV/PNG at least
      once on the live URL.

## 5. DNS cutover bookkeeping

- [ ] Record the cutover date + resolved IP/mapping in this file.
- [ ] Post-cutover watch: Cloud Run metrics (latency, 5xx, instance
      count) and budget alerts for the first 48 h.
- [ ] Rollback path: remove the domain mapping (traffic falls back to the
      `a.run.app` URL) per `deploy/README.md`.

## Open-source surface (done in v0.8.1)

- [x] Public repository `openscope-ai/fvf-viewer` live (MIT, snapshot
      history) with green CI on `main` and `v0.8.1`.
- [x] In-app GitHub links point at the public repository.
- [ ] Enable deploy keys for the public repo in the organization settings
      (or add a fine-grained PAT secret `PUBLIC_REPO_DEPLOY_KEY`), then
      `gh workflow enable "Publish public snapshot"` so future release
      tags publish automatically (v0.8.1 was published manually).
