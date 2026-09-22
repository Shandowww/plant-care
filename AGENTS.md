# PlantCare working context

## Layout and runtime
- Repository root contains this file, README.md, repository.yaml, docs/, and plant-care/.
- plant-care/ is the Home Assistant add-on build context and Python package root.
- Backend: app/backend/plantcare/ (relative to plant-care/), Python 3.14,
  FastAPI, Pydantic, async SQLAlchemy/aiosqlite, httpx2, structlog.
- Frontend: app/frontend/, React 19 + TypeScript + Vite, plain CSS, lucide-react.
  App.tsx holds dialogs/views; components.tsx reusable UI; api.ts transport;
  types.ts mirrors backend schemas. Navigation uses URL hashes.
- main.py:create_app wires routes, lifespan, injected providers, sync, and static serving.
- models.py defines persistence; schemas.py defines API contracts; config.py settings.
- sync.py owns sensor ingestion and managed action transitions; care_profiles.py
  owns species guidance. home_assistant.py wraps Supervisor/HA APIs.
- plant_doctor.py owns Cloudflare requests, prompts, response normalization;
  photos.py normalizes private uploads. simulator.py is development/test only.
- Dockerfile builds frontend and Python runtime. rootfs/ holds startup, nginx,
  and supervisord config. config.yaml is Home Assistant add-on metadata/options.

## Storage and integration
- Production data stays in /data: SQLite plantcare.db and private photo storage.
- SQLite uses WAL; directory and sidecar write permissions matter, not just DB permissions.
- Alembic migrations live in app/migrations/versions/; startup runs upgrade head.
  Add migrations for schema changes; create_all is not an upgrade strategy.
- PLANTCARE_* environment settings; SUPERVISOR_TOKEN provides HA access.
  Cloudflare credentials come from add-on options/environment, never frontend or Git.
- Home Assistant entities are explicitly mapped per plant; areas and device metadata
  seed editable defaults. Polling persists normalized readings and updates plant state.
- Sensor-managed care actions are deduplicated and automatically closed on recovery.
  Do not replace confirmation/hysteresis with a single-reading decision.
- HA persistent notifications link to plant hashes through the ingress URL.
  Pending send/dismiss events are AppSetting notification.pending.* records written
  in the action transaction; delivery retries after commit under a delivery lock.
- Preserve notification IDs/deduplication and atomicity when changing sync behavior.
- Doctor calls require consent and a separate diagnostic photo, not the cover photo.
  AI recommendations require explicit user acceptance; history is stored locally.

## Deployment and security patterns
- nginx ingress listener 8099 trusts only the Supervisor gateway/loopback;
  LAN listener 8098 removes forwarded identity headers. Backend is loopback 8080.
- auth.py separates trusted ingress from password/session + CSRF LAN access.
  Never trust arbitrary client identity headers or disable production authentication.
- API routes are /api/v1. Frontend requests must stay ingress-relative (no leading /).
- Vite base is './'. Backend mounts /assets and /images, then serves SPA fallback.
  Import UI assets through Vite or use the mounted image directory; arbitrary public
  root files can otherwise return index.html instead of image bytes.
- SPA HTML is not cached; built assets are content-hashed. Test production paths,
  not only the permissive Vite server, when adding assets or routes.
- Keep AppArmor enabled. Production image supports amd64 and aarch64 (Pi).
- Never commit .env, tokens, /data, .local-data, databases, private photos, or logs.
- Preserve existing user edits and data. Do not reset simulator/production databases
  to make tests or migrations pass. Avoid logging secrets/provider payloads.

## Local commands (run from repository root)
```sh
python3.14 -m venv .venv
.venv/bin/python -m pip install -e './plant-care[dev]'
npm --prefix plant-care/app/frontend ci
PLANTCARE_ENV=development PLANTCARE_AUTH_MODE=disabled PLANTCARE_DATA_DIR=.local-data \
  .venv/bin/uvicorn plantcare.main:create_app --factory --app-dir plant-care/app/backend --reload
npm --prefix plant-care/app/frontend run dev
```
- Vite :5173 proxies /api to :8000. Disabled auth is local development only.
- Use the existing root .venv when available; don't change system Python.

## Verification
```sh
.venv/bin/ruff format --check plant-care/app/backend plant-care/tests
.venv/bin/ruff check plant-care/app/backend plant-care/tests
.venv/bin/mypy plant-care/app/backend
.venv/bin/pytest plant-care/tests/backend -q
npm --prefix plant-care/app/frontend run lint
npm --prefix plant-care/app/frontend run typecheck
npm --prefix plant-care/app/frontend test
npm --prefix plant-care/app/frontend run build
git diff --check
```
- Backend tests inject mock HA/AI providers and temporary storage; avoid real paid calls.
- Frontend tests use Vitest + Testing Library + jsdom in src/App.test.tsx.
- CI (.github/workflows/ci.yml) runs checks, npm audit, and both container architectures.
- Cover action lifecycle, failed provider responses, persistence, and ingress regressions.
- Keep Python strictly typed and Ruff-formatted; update API schemas and TS types together.
- Check narrow mobile dialogs, long text, nested button behavior, and image loading.
- Numeric soil-moisture thresholds are provisional sensor guidance, not air humidity
  or universally calibrated botanical targets. Preserve explicit unknown-species fallbacks.

## Releases and references
- For the Plant Doctor upgrade, read docs/plant-doctor-todo.md first; update its
  checklist and resume checkpoint after meaningful progress and before handoff.
- For authorized releases, synchronize config.yaml, Dockerfile BUILD_VERSION,
  pyproject.toml, backend __init__.py, frontend package.json/package-lock.json,
  version assertions in tests, and CHANGELOG.md.
- A push to main triggers CI; add-on is built from the repository on the HA host.
  Distinguish local tests, published source, completed CI, and actual Pi installation.
- README.md: local setup; plant-care/DOCS.md: HA operation;
  docs/architecture.md: design context. Read specific modules/tests before editing;
  this file intentionally omits individual feature details and transient work status.

## Development principles
- This is a shared-household plant monitoring and care app; center configuration
  and UI on individual plant profiles, with species defaults overridable per plant.
- Keep changes small and maintainable; reuse existing services, components, and
  HA mechanisms instead of parallel systems or unnecessary dependencies.
- Preserve existing data/API compatibility; avoid unrelated refactoring.
- Inspect relevant code, related tests, and data flow before edits. The repository,
  not this document, is the source of truth; avoid broad exploration unless needed.
- Maintain the established visual language, clear statuses, concise actionable text,
  and mobile layouts; avoid duplicating information already in the UI.
- Do not add notification channels (including Telegram/mobile push) unless requested.
- For features, state the approach, implement, update tests, and run relevant checks.
  Summarize changes, decisions, tests, remaining issues, and pre-existing failures.
- Ask about ambiguity that materially changes architecture or user-visible behavior;
  follow existing patterns for minor implementation decisions.
