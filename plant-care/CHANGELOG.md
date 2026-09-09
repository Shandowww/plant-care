# Changelog

## 0.2.4

- Pre-create Nginx log and temporary directories with worker ownership.
- Route Nginx's early error log to stderr and allow its runtime directory roots
  through AppArmor.

## 0.2.3

- Allow Python and native-extension shared libraries to be read and mapped by
  the confined runtime.

## 0.2.2

- Permit the complete startup process tree and its read-only runtime files in
  the Home Assistant AppArmor profile.

## 0.2.1

- Allow the root-level startup script through the Home Assistant AppArmor
  profile and preserve its executable file mode.

## 0.2.0

- Synchronize mapped Home Assistant entities on a guarded background interval.
- Normalize and persist moisture, temperature, battery, and illuminance history.
- Ignore invalid sensor states without replacing the last known good reading.
- Deduplicate readings by plant, metric, entity, and Home Assistant update timestamp.
- Refresh the open dashboard and plant details as live values change.

## 0.1.0

- Add persisted per-plant Home Assistant sensor mappings, live entity discovery
  through the Supervisor API, and a deterministic local entity catalog.
- Replace the static dashboard shell with routed Dashboard, Care queue, All
  plants, Settings, and Help/diagnostics views.
- Add persisted simulator plant creation plus care-action snooze, completion,
  and undo endpoints with audit events.
- Add interactive plant details, photo-flow preview, header menus, settings,
  live health diagnostics, and regression coverage for the new workflows.
- Use Python 3.14 throughout local development, CI, and production packaging.
- Update the backend dependency set to releases with native Python 3.14 support.
- Add Home Assistant app packaging for amd64 and aarch64.
- Add separate ingress and LAN proxy surfaces.
- Add FastAPI, SQLite, migrations, simulator, shared-password primitives, and health checks.
- Add responsive nine-plant dashboard shell.
