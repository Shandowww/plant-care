# Changelog

## 0.3.0

- Add sensor-first plant onboarding with atomic plant and entity mapping.
- Prefill editable plant names and locations from Home Assistant entity, device,
  and area metadata.
- Automatically select companion readings exposed by the same sensor device.
- Resolve frontend API and image requests correctly under Home Assistant ingress.

## 0.2.7

- Resolve API and plant-image requests relative to the Home Assistant ingress
  URL instead of escaping to the Home Assistant origin root.

## 0.2.6

- Permit the standard privilege-drop capabilities Nginx needs when initializing
  worker-owned runtime directories under AppArmor.

## 0.2.5

- Permit Nginx to initialize each pre-created temporary directory under the
  confined Home Assistant runtime.

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
