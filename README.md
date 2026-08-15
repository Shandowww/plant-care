# Plant Care Dashboard

Plant Care Dashboard is a local-first Home Assistant app that turns mapped plant
sensor readings into cautious, plant-specific care guidance. The project is in
active development; the local simulator now provides a navigable dashboard,
plant details and creation, a persistent care queue, diagnostics, authentication,
and the Home Assistant packaging foundation.

See [plant-care/DOCS.md](plant-care/DOCS.md) for Home Assistant installation
notes and [docs/architecture.md](docs/architecture.md) for the system design.

## Local development

Prerequisites: Python 3.14, Node.js 22+, npm, and Docker. The local runtime and
production image use the same Python release.

Run every command in this guide from the repository root: the directory that
contains this `README.md` and the `plant-care` directory. For example:

```bash
git clone https://github.com/Shandowww/plant-care.git
cd plant-care
```

On macOS, confirm the current interpreter:

```bash
python3 --version  # must print Python 3.14.x
```

Create the virtual environment with that interpreter:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install --upgrade pip
.venv/bin/python -m pip install -e './plant-care[dev]'
npm --prefix ./plant-care/app/frontend ci
```

Run the API and simulator:

```bash
PLANTCARE_ENV=development PLANTCARE_AUTH_MODE=disabled \
  PLANTCARE_DATA_DIR=.local-data \
  .venv/bin/uvicorn plantcare.main:create_app --factory \
  --app-dir plant-care/app/backend --reload
```

In another terminal, run the frontend:

```bash
npm --prefix plant-care/app/frontend run dev
```

The frontend development server proxies `/api` to `http://127.0.0.1:8000`.

The simulator portal supports dashboard filters and sorting, plant detail and
photo-flow previews, manual plant creation/edit/archive, care-action
snooze/complete/undo and visible history,
portal preferences, and live diagnostics. Start with `#dashboard`, `#actions`,
`#plants`, `#settings`, or `#help`; navigation updates the hash automatically.

Plant identity and care settings belong to PlantCare; Home Assistant is the
source of live sensor readings. A removed or unavailable HA entity will be
treated as a broken mapping, not as permission to erase the plant or its history.
The simulator's **Simulate confirmed watering** control demonstrates automatic
completion of a low-moisture action after confirmed recovery.

## Validation

```bash
.venv/bin/ruff check plant-care/app/backend plant-care/tests
.venv/bin/mypy plant-care/app/backend
.venv/bin/pytest plant-care/tests
npm --prefix plant-care/app/frontend run lint
npm --prefix plant-care/app/frontend run typecheck
npm --prefix plant-care/app/frontend test
npm --prefix plant-care/app/frontend run build
docker build -t plant-care:dev plant-care
```

Credentials, Home Assistant entity IDs, notification targets, and provider keys
must never be committed. Runtime data belongs under `/data`.

### Python installation error

The supported dependency set provides Python 3.14 wheels on macOS ARM, so a
normal install does not need Rust. If pip attempts a `pydantic-core` source
build, verify the checked-out `pyproject.toml` requires Pydantic 2.13.4 and run
`.venv/bin/python -m pip install --upgrade pip` before installing again.

The npm `whatwg-encoding` deprecation notice comes from the development-only DOM
test environment and does not enter the production bundle. Approved install
scripts are pinned in `package.json`; `esbuild` installs its platform binary and
`fsevents` provides native macOS file watching.

## License

PlantCare is available under the [MIT License](LICENSE). Image asset provenance
is recorded in the
[image attributions](plant-care/app/frontend/public/images/plants/ATTRIBUTIONS.md).
