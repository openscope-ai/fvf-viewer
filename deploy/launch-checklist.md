# Launch checklist — fvf-viewer.com (issue #22)

Execution order; every gate is pass/fail before the DNS switch. The Stage 5
launch gates (E2E suite, performance validation, Wasm conformance) shipped
green in v0.8.0, and Stages 2–3 are merged — the gate condition for the
public cutover is satisfied.

## 1. Cloud Run service is live (done in 0.7.0, re-verified per release)

- [x] `gcloud run services describe fvf-viewer --region=us-central1`
      reports ready with the current image.
- [x] `https://fvf-viewer-<hash>-<project>.a.run.app/api/health` returns
      200 with the released `version`.

## 2. Custom domain + TLS (owner action — GCP console / gcloud)

- [x] Cloud Run custom domain mapping `fvf-viewer.com` + `www.fvf-viewer.com`
      created (us-central1); Google-managed certificate issued
      (provisioning can take ~15–90 minutes after DNS verification).
- [x] Registrar DNS (Cloudflare, DNS-only): `A`/`AAAA` apex + `www` CNAME
      pointed at the mapping targets.

## 3. Email records (owner action — registrar DNS)

- [x] Null MX `0 .` (no mail on this domain).
- [x] SPF `v=spf1 -all`.
- [ ] DKIM key published if any mail is sent.
- [x] DMARC `p=reject`.
- [x] n/a — domain locked down for no mail (owner-verified in Cloudflare).

## 4. Production smoke test (automated — after DNS cutover)

```sh
FVF_E2E_BASE_URL=https://fvf-viewer.com pnpm test:e2e
```

- [x] All 28 specs green against the live deployment (2026-09-28:
      health version 0.8.1, SPA shell, JSON 404, CSP compliance, UI flows).
- [x] Manual pass: load page → drop fixture → export CSV/PNG at least
      once on the live URL (owner-confirmed 2026-09-28: capture renders
      correctly, performance feels instant despite US hosting).

## 5. DNS cutover bookkeeping

- [x] Cutover executed 2026-09-28 ~17:16 UTC; certificate Google Trust Services
      (WR3), SANs fvf-viewer.com + www; service us-central1.
- [ ] Post-cutover watch: Cloud Run metrics (latency, 5xx, instance
      count) and budget alerts for the first 48 h.
- [ ] Rollback path: remove the domain mapping (traffic falls back to the
      `a.run.app` URL) per `deploy/README.md`.

## Open-source surface (done in v0.8.1)

- [x] Public repository `openscope-ai/fvf-viewer` live (MIT, snapshot
      history) with green CI on `main` and `v0.8.1`.
- [x] In-app GitHub links point at the public repository.
- [x] Deploy keys enabled; publish workflow active; v0.8.1 snapshot
      published (history consolidated to a single release commit).
