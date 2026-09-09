# Changelog

## 0.5.0

- Move private photo add, replacement, and removal into the general Edit plant
  flow and remove the separate photo controls from cards and plant details.
- Replace the Plant Doctor demo with an optional Cloudflare Workers AI vision
  check using a current private photo and limited plant sensor context.
- Require explicit consent for every Plant Doctor request, show returned neuron
  usage, and never create care actions or change plant data from an AI result.
- Keep Cloudflare credentials in protected Home Assistant app options and make
  their configured/not-configured state visible without returning either secret.
- Downsize a temporary analysis copy to 1280 pixels; the retained local photo is
  unchanged and AI assessments are not persisted.

## 0.4.0

- Add authenticated local plant-photo upload, replacement, retrieval, and
  permanent deletion.
- Resize retained photos, convert them to safe JPEGs, and remove embedded image
  metadata before storing them under the Home Assistant app data directory.
- Automatically show a personal photo on plant cards and details, with the
  bundled species image retained as the fallback.
- Separate private photo management from the clearly labelled Plant Doctor demo.

## 0.3.1

- Replace free-text plant locations with Home Assistant area selectors during
  plant creation and editing.
- Allow illuminance readings to come from any Home Assistant sensor and suggest
  an available sensor in the plant's area when its own device has none.
- Show each sensor's Home Assistant area in entity selectors.

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
