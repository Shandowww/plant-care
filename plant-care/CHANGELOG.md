# Changelog

## 0.10.7

- Recover malformed Vision-model replies through a structured-output text
  normalizer while preserving identity uncertainty and care safeguards.
- Include fallback processing in the reported neuron usage.

## 0.10.6

- Stop requesting unsupported JSON Mode from the Cloudflare Vision model while
  retaining strict plain-JSON assessment validation.
- Replace the diagnostic-photo overlay label with a single mobile-safe file
  chooser button.

## 0.10.5

- Use Cloudflare Workers AI JSON mode for Plant Doctor and accept its structured
  object response, reducing malformed-model-response failures.
- Distinguish an unusable AI response from network/service availability without
  recording the diagnostic photo, token, or model text in logs.

## 0.10.4

- Replace the fixed 24-hour wet alert with per-pot drying-cycle learning,
  likely-watering labels, optional wet-duration overrides, and a 14-day review backstop.
- Show an early non-notifying "Still very wet" status after 72 hours without a
  meaningful decline, while learning or tracking a pot's normal dry-down.
- Explain drying status on cards and details; keep dry-soil watering alerts unchanged.
- Use Home Assistant report freshness for moisture sensor warnings so constant
  moisture readings alone do not imply sensor failure.
- Add migration 0008 for drying status and per-plant duration settings.

## 0.10.3

- Bundle the gardener illustration so it loads behind Home Assistant ingress.
- Require an explicit AI photo-identity assessment; withhold care instructions and
  prevent accepting visit recommendations when identity is mismatched or uncertain.
- Reject malformed provider replies instead of displaying raw Markdown; retain the
  full diagnostic photo and improve warning readability.
- Add compact repository working context in AGENTS.md.

## 0.10.2

- Refresh Plant Doctor results with a gardener illustration, personalized heading,
  bulleted actions, quoted recommendations, and more readable mobile typography.

- Lead confirmed low-moisture actions and notifications with “Water plant” and
  plant-specific watering technique instead of routine manual soil checks.
- Refresh existing active action wording during sensor sync without duplicating alerts.
- Ask Plant Doctor to prioritize watering technique and reserve manual checks for
  conflicting evidence or symptoms; retain confirmation and recovery thresholds.

## 0.10.1

- Clear unavailable sensor values and create recoverable sensor warnings.
- Evaluate the full moisture history window so frequent readings do not suppress prolonged-wet alerts.
- Persist pending Home Assistant notification sends and dismissals, retrying failed delivery after syncs and restarts.
- Match LAN session cookie security to the request transport, supporting the bundled HTTP listener and HTTPS proxies.

## 0.10.0

- Connect live Home Assistant moisture readings to production care actions instead
  of leaving species guidance display-only.
- Treat profile values as separate provisional watering-check and prolonged-wet
  triggers, with optional per-plant overrides in **Edit plant**.
- Confirm low moisture across three fresh readings, warn after moisture remains
  above the wet trigger for 24 hours, and use five-point recovery hysteresis to
  prevent alert flapping.
- Create deduplicated Home Assistant notifications that deep-link to the plant,
  then complete the action and dismiss its notification automatically after
  recovery.
- Add automatic low-battery actions below 20%, recovered at 25%, and keep
  temperature ranges explicitly informational.
- Move temperature and moisture profile interpretation to the backend so every
  client receives the same thresholds and provenance.

## 0.9.1

- Prevent Home Assistant's embedded iOS browser from retaining a previous PlantCare frontend after an app update.
- Ensure the SPA entry page is always revalidated while retaining content-hashed static assets.

## 0.9.0

- Add an optional precise position alongside each Home Assistant area, so plants
  can be identified as, for example, “Balcony · right side” without encoding the
  position in their name.
- Give Plant Doctor a bounded seven-day soil-moisture summary, including trend
  and supported current wet/dry duration, without sending raw Home Assistant
  entity history.
- Return a structured, species-aware watering plan with a provisional alert
  point, multi-spot root-zone checks, watering method, and evidence-gated drying
  advice. Save that guidance in the local patient history.

## 0.8.5

- Return to Home Assistant's maintained default AppArmor policy instead of
  replacing it with an incomplete app-specific policy. AppArmor remains enabled,
  while SQLite can use the persistent `/data` volume and its WAL sidecar files.
- Verify a real SQLite write transaction during startup so PlantCare cannot
  report ready when its database is readable but not writable.

## 0.8.4

- Commit valid Home Assistant readings before the optional stale-sensor action
  and notification phase, so a later monitoring storage failure cannot erase
  newly synchronized plant values.
- Report whether a database failure happened during reading ingestion or sensor
  monitoring, alongside the underlying SQLite reason.
- Grant explicit AppArmor access to the `/data` directory itself as well as its
  contents, allowing SQLite to manage journal and shared-memory sidecar files.

## 0.8.3

- Configure SQLite WAL mode once during startup instead of whenever the
  connection pool opens a connection, avoiding an exclusive-lock race that
  could prevent all Home Assistant sensor synchronization.
- Wait longer for short SQLite write contention and retry transient locked/busy
  synchronization failures before abandoning the refresh.
- Include the safe underlying database-driver message in synchronization logs
  so future storage failures are actionable rather than reported only as
  `OperationalError`.

## 0.8.2

- Make Plant Doctor assessments explicitly species-aware: the prompt now treats
  the saved common/scientific name as the working identity, requires the plant
  to be named in the summary, and asks the model to flag a photo/name mismatch.
- Send the Doctor the same species temperature range and starting soil-moisture
  sensor band shown by PlantCare so it can interpret available readings in
  context rather than returning purely general tips.
- Display the assessed plant identity above every Doctor result and distinguish
  a sensor-specific moisture band from a universal horticultural percentage.
- Audit and extend temperature profiles for Monstera, snake plant, peace lily,
  devil's backbone, Madagascar jewel, and warm-growing orchid fallbacks.

## 0.8.1

- Hydrate live sensor values from Home Assistant immediately after a plant is
  created with mappings or an existing mapping is changed. The recurring
  background sync remains the fallback when Home Assistant is temporarily
  unavailable.
- Make the moisture reading on each plant card expandable, with species-aware
  soil-moisture guidance and clearly labelled indoor/outdoor fallbacks.
- Explain that soil-moisture percentages vary with sensor model, substrate,
  and probe placement, so the displayed range should be read as trend guidance.

## 0.8.0

- Detect mapped moisture, temperature, and illuminance sensors whose value has
  not changed for a configurable 72 hours, create a deduplicated sensor issue,
  and complete it automatically after a fresh value change.
- Send new sensor warnings to Home Assistant as persistent notifications using
  the app's injected Supervisor token; no additional notification credentials
  are required.
- Include a notification link that opens PlantCare directly on the affected
  plant, and dismiss the Home Assistant notification after sensor recovery.
- Show the active sensor timeout and Home Assistant notification state in
  PlantCare settings and diagnostics. Battery values are excluded from the
  unchanged-value rule to prevent expected slow battery changes causing alerts.

## 0.7.0

- Add a polished care-tips section to plant details with species-specific
  guidance, a different featured tip on each visit, a shuffle control, and an
  expandable full guide. Unidentified plants receive labelled indoor or
  outdoor container guidance.
- Ask for a separate diagnostic photo on every Plant Doctor visit instead of
  reusing or replacing the plant's cover photo. Diagnostic uploads are
  metadata-stripped for analysis and are not retained by PlantCare.
- Allow an optional cover photo during sensor-first plant creation.
- Keep saved sensor remapping changes even if the immediate Home Assistant
  reading refresh fails, and surface detailed API validation errors.

## 0.6.1

- Make each plant-card temperature reading expandable to show a typical species
  range, with transparent indoor/outdoor fallbacks for unidentified plants.
- Clarify that the displayed range is guidance and is not yet an automated
  temperature alert threshold.
- Apply Ruff formatting and strict typing required by clean CI runners, and
  update `js-yaml` so the high-severity npm audit check passes.

## 0.6.0

- Save successful Plant Doctor assessments locally as compact per-plant patient
  history, including the sensor snapshot, queue decision, and reported outcome.
- Let users explicitly decline a recommendation or later mark an accepted one as
  helped, did not help, or uncertain.
- Give Cloudflare only the five most recent text summaries and outcomes on a new
  check, never previous photos, and ask it not to repeat failed advice without
  current supporting evidence.
- Distinguish daily quota exhaustion, temporary capacity, rate limiting, token
  rejection, model/account configuration, and general provider outages with
  actionable messages.

## 0.5.2

- Let iPhone and iPad users choose between their photo library, camera, and
  files instead of forcing the rear camera when selecting a plant photo.

## 0.5.1

- Show the number of successful Plant Doctor checks completed by this
  installation since 00:00 UTC alongside the consent control.
- Remind users of Cloudflare's 10,000-neuron daily free allocation and label the
  expected usage as approximately 10–50 neurons per check.
- Refresh the local counter after each successful diagnosis without making an
  additional Cloudflare request or exposing provider credentials.
- Let users explicitly add the Doctor's safe next checks to the shared care
  queue as a manually completable task with a prominent AI recommendation tag.
- Deduplicate identical open AI recommendations and record their creation in
  action history; AI output never changes care or controls devices by itself.

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
