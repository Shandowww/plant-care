# Plant Doctor upgrade — resumable checklist

## Resume checkpoint

- Current follow-up (v0.11.2, published as 6dc0931): Gemini 503 now retries once
  after one second within the existing overall deadline, then gives a specific
  service-unavailable message. No retries of other errors or unconsented fallback.
  Photo normalization now accepts MPO multi-picture JPEG and AVIF, with picker
  filters updated. Regression tests use generated images, no private uploads.
  The user's exact gallery format remains unconfirmed without the original file.
  Google dashboard confirms upstream 503; a local fix cannot resolve its outage.
- Verification: 137 backend + 27 frontend tests; Ruff, mypy, ESLint, TypeScript,
  production build and diff check pass. No live AI calls or real iPhone QA.
  Version references synchronized to 0.11.2. Release checks also corrected a
  flaky scroll-reset test to await the React effect; all checks then passed.
  CI is in progress: https://github.com/Shandowww/plant-care/actions/runs/35855178560
  Next: confirm CI (0.11.1's prior run was cancelled).
  After HA update, owner retries gallery upload
  and Gemini diagnosis; obtain original rejected photo privately if still failing.

- Follow-up 2026-09-23: Gemini setup verification button and specific diagnosis
  timeout errors published as v0.11.1 (a416768). All 122 backend and 27 frontend
  tests pass, as do Ruff, mypy, ESLint, TypeScript, build and diff checks. The button
  lives in PlantCare Settings, not Home Assistant's schema-rendered config form;
  it requests model metadata only, never sends plant data or generates an assessment.
  Original live failure remains unconfirmed until verification/logs from the Pi.
  CI: https://github.com/Shandowww/plant-care/actions/runs/35819478053 (queued at handoff).
  Next: confirm CI; owner updates, saves
  credentials/restarts and uses Settings → Verify Gemini setup. No real key used
  in local verification, and no diagnostic quota consumed by these tests.
- Status: v0.11.1 published; owner setup verification and live assessment pending.
- Verified baseline: `de8dba8`, version `0.10.7`.
- Current work: prepared version 0.11.0 with Gemini transport/selection, explicit
  fallback consent, structured care plans, symptom/history context, migration 0009,
  provider errors/deadlines, updated result rendering and operating documentation.
- Next action: verify push/CI, then configure the owner's Gemini key privately and
  run docs/plant-doctor-evaluation.md on the Home Assistant installation.
- Blockers: none for local implementation. Live Gemini verification needs the
  user's configured API key and an appropriate diagnostic photo. Never put either
  in this document, Git, test fixtures, or logs.
- Verification: backend/frontend suites, Ruff, mypy, ESLint, TypeScript and production
  build pass; see milestone log for counts. Migration from 0008 preserves old visits.
- Release state: v0.11.0 pushed to main as 57cc5c4; installation unconfirmed.
- CI: https://github.com/Shandowww/plant-care/actions/runs/35751444412
  completed successfully (v0.11.0). Follow-up v0.11.1 CI is linked above.

## How to resume

1. Read `AGENTS.md`, this checkpoint, and `git status --short` / latest commit.
2. Preserve unfinished edits; inspect the diff before repeating any work.
3. Start at the first incomplete step, using the checkpoint for partial progress.
4. Update this file after each meaningful milestone, not only at turn end.
5. Before stopping, record exact next action, changed files, tests and outcomes,
   unresolved decisions, and commit/push/CI/install state in the checkpoint.
6. A usage reset does not itself run work. Resume when the user continues the task;
   do not create background monitoring or schedules unless requested.

## Accepted scope and corrections

- Add Gemini as the preferred configurable Doctor provider; retain Cloudflare.
  Keep existing installations working until Gemini credentials are configured.
- Separate plant identity confidence from diagnosis/care confidence. Uncertain
  identity must not erase useful symptom observations and appropriate next steps.
- A clear identity mismatch requires confirmation before using the saved species
  and its sensor readings for the pictured plant. Do not silently rename a plant.
- Add optional user context: what changed, onset, recent watering/movement/treatment.
- Produce a practical care plan: urgency, likely causes and evidence, immediate
  steps, things to avoid, expected improvement, and when to reassess.
- Use sensor freshness, moisture trends, recent watering, drying history, and prior
  Doctor outcomes when supported by available data; explicitly handle missing data.
- Keep provider fallback optional and transparent, consistent with consent.
- Preserve explicit acceptance before adding AI recommendations to the care queue.
- Show provider-specific usage; Gemini tokens/quotas are not Cloudflare neurons.
- Select and verify an available Gemini model at implementation time. Prior chat
  model names and quality/pricing claims are not a substitute for current docs.
- The screenshot comparison demonstrates usefulness, not a verified diagnosis or
  a general model benchmark. Gemini was given a 24-hour onset detail that our UI
  did not collect. Do not assume wilting alone proves a need for more water.
- Existing mocked tests verify application behavior, not live model quality.

## Implementation checklist

- [x] Review the current identity gate and agree on revised scope.
- [x] Save durable work tracking and link it from `AGENTS.md`.
- [x] Inspect the relevant code paths and document any material design decisions.
- [x] Verify Gemini image input, structured output, model availability, error
  responses, free-tier limits, and data-use terms against official documentation.
- [x] Define the shared diagnosis contract and compatibility for historical visits.
- [x] Implement provider selection and server-only Gemini credentials through
  settings, Home Assistant add-on options, and startup environment wiring.
- [x] Implement Gemini image assessment with validated structured responses,
  bounded timeouts, and useful authentication/quota/service/format errors.
- [x] Revise prompts and result processing so identity uncertainty permits useful
  symptom guidance; remove the blanket clearing of care steps where appropriate.
- [x] Update action acceptance checks to match the revised identity rules; keep
  mismatch safeguards consistent between API, stored history, and frontend.
- [x] Add optional symptom/onset text through UI, transport, API, prompt, and
  local history as appropriate. Add migrations if persisted schema changes.
- [x] Include existing relevant sensor/drying/history context with freshness and
  limitations; avoid inventing observations or calibrated moisture targets.
- [x] Render urgency, evidence, immediate steps, avoidance, and follow-up clearly
  in mobile Doctor results. Keep existing history readable.
- [x] Make Cloudflare fallback explicit/configurable; show the actual provider and
  usage, and update consent to reflect which services may receive the photo/context.
- [x] Update setup and operating documentation, including credentials and limits.

## Verification and release checklist

- [x] Add focused backend coverage for Gemini success, malformed/truncated output,
  authentication, quota, timeout, fallback, and compatibility with existing visits.
- [x] Cover uncertain identity with helpful advice, clear mismatch, conflicting
  sensor evidence, and accepted/declined recommendation behavior.
- [x] Cover symptom input, provider/consent labels, useful results and existing flows
  in frontend tests.
- [x] Inspect narrow mobile layout and production ingress paths in a browser
  using the built app under a simulated ingress prefix (not a live HA host).
- [x] Define evaluation cases: wilted plant with dry substrate, wilted plant with
  wet substrate, clear wrong plant, healthy plant, and possible pest damage.
  Record expected behaviors, not rigid wording or unsupported diagnoses.
- [ ] Run an authorized live end-to-end Gemini assessment and evaluate output
  quality. Keep private photos/results out of Git. If unavailable, state this
  explicitly and do not describe mocked success as live verification.
- [x] Run required checks from `AGENTS.md` once changes are ready; record outcomes.
- [x] Review diff for compatibility, secrets, unrelated changes, and release scope.
- [x] Choose the next version from repository state and synchronize all version
  references listed in `AGENTS.md`; update the changelog.
- [x] Commit/push the authorized release (57cc5c4).
- [ ] Confirm final CI result for run 35751444412 (running at handoff).
- [ ] Record Home Assistant installation and real diagnostic outcome when the
  user confirms them. Do not infer installation from a successful push.

## Milestone log

- Planning checkpoint: baseline `0.10.7` has Cloudflare Vision plus a text
  normalizer. The parser replaces uncertain/mismatched assessments with a fixed
  message and empty care steps; action acceptance also checks identity. These
  linked behaviors must change together. No Gemini implementation exists yet.
- 2026-09-22 implementation: new doctor_providers.py, migration 0009, shared care
  plan schema, UI/context/consent and private add-on credential wiring completed.
  Official Gemini 3.6 Flash model and REST structured-output support checked;
  provider model remains configurable. No numeric Gemini free quota is assumed.
- Verification: 107 backend tests and 26 frontend tests; format/lint, mypy,
  TypeScript, production build, shell syntax and diff whitespace checks pass.
  Mocked provider failures and per-request secondary consent are covered; old
  database visits retain decisions/text after upgrade. No real AI calls made.
- Deliberate behavior: primary deadline 50 seconds without fallback; consented
  fallback budgets 20 seconds Gemini + 25 seconds Cloudflare, below ingress timeout.
  Missing/malformed identity stays guarded; explicit uncertainty can retain advice.
  Fallback consent resets on a new check. No credentials or private photos added.
- Release QA: production bundle tested at 390px phone width through a local
  /api/hassio_ingress/qa/ prefix, with isolated synthetic data and mock provider.
  Photo picker, symptom entry, consent, saved result, gardener image and wrapping
  verified; no horizontal overflow. Fixed retained dialog scroll after diagnosis,
  with a regression assertion. This does not validate iOS Safari or live HA ingress.
- Final checks: 107 backend + 26 frontend tests, format/lint/type checks, production
  build and diff check pass. npm audit high-severity gate passes; two pre-existing
  moderate Vitest/mocker advisories remain. No dependency upgrade included.
