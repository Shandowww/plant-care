# Plant Care Dashboard

This experimental release includes the local simulator and the first live Home
Assistant sensor synchronization milestone. In production, PlantCare reads only
the entities explicitly mapped to a plant and stores their normalized history in
its own local database.

## Installation

1. Add `https://github.com/Shandowww/plant-care` as a custom Home Assistant app
   repository.
2. Install **Plant Care Dashboard**.
3. Start the app and open it from the Home Assistant sidebar.
4. Add each plant by selecting its Home Assistant moisture sensor first.
   PlantCare preselects companion entities from the same device and suggests an
   editable plant name and Home Assistant area. Illuminance may be mapped from
   another sensor in the same area when the plant device does not provide it.
   Add an optional precise position such as “right side” or “beside the window”;
   this stays separate from the Home Assistant area and remains editable.
5. Optionally choose a private cover photo while adding the plant. It can be
   added, replaced, or removed later from **Details → Edit plant**.
6. Optional: configure Plant Doctor with your own Gemini or Cloudflare credentials
   as described below.
7. If the standalone LAN view is needed, create its password from the ingress
   session first.

### Alternative local Raspberry Pi installation

PlantCare can also be tested as a local Home Assistant app without installing
from GitHub:

1. Use an authenticated Home Assistant file-transfer method to copy the complete
   `plant-care` directory to `/addons/plant-care` on the Home Assistant host.
2. In Home Assistant, open **Settings → Apps → App store** and reload/check for
   updates from the store menu.
3. Open the **Local apps** section and select **Plant Care Dashboard**.
4. Install it, enable **Start on boot**, **Watchdog**, and **Show in sidebar**,
   then start it.
5. Open the app from the sidebar and add one test plant with its sensor mappings.
6. With the phone disconnected from home Wi-Fi, open Home Assistant through the
   Nabu Casa remote URL and confirm that the PlantCare sidebar entry opens.

Do not copy local development data, `.venv`, or `node_modules`; only the
`plant-care` app directory is needed. The first installation builds the aarch64
container on the Pi and can therefore take several minutes.

Mapped readings are synchronized every 30 seconds. Saving a mapping also asks
Home Assistant for an immediate refresh. The dashboard refreshes while it is
open, so the Home Assistant ingress and LAN views converge on the same database
state without a manual browser reload.

PlantCare uses SQLite WAL mode for concurrent dashboard reads and sensor writes.
WAL is configured once before the web server accepts requests; brief database
contention is retried automatically. A persistent synchronization storage error
is logged with its underlying driver reason without exposing credentials.
Valid readings are committed before stale-sensor actions are evaluated, so the
core dashboard continues updating if the optional monitoring phase encounters a
storage problem.

The app keeps Home Assistant's default AppArmor protection rather than replacing
it with a custom profile. Startup verifies that SQLite can acquire a write
transaction and create its required WAL sidecars before the health endpoint can
report ready.

The port mapped to internal `8098` is for the trusted home LAN only. Do not
port-forward it. Remote use must go through Home Assistant ingress and the
household's existing secure Home Assistant remote-access method.

All durable state is stored below `/data` and is included in Home Assistant
backups. The Home Assistant Supervisor token is injected at runtime and is not
stored in the repository.

## Private plant photos

Personal photos remain inside the PlantCare app data directory. Uploads are
limited to 10 MB and JPEG, PNG, WebP, HEIC, or HEIF input. PlantCare corrects orientation,
resizes the image to at most 2048 pixels on either side, strips embedded metadata,
and stores a private JPEG. A cover photo can be selected during plant creation;
replacing or removing it later is part of **Edit plant**, and cards and details
update automatically. On iPhone and iPad, the system picker offers the photo
library, camera, and files rather than opening the camera automatically.

## Optional Plant Doctor

In Home Assistant, open **Settings → Apps → Plant Care Dashboard → Configuration**.
For Gemini, enter your own `gemini_api_key`, leave `doctor_provider: auto`, save,
and restart. Auto prefers Gemini when its key is configured; otherwise it keeps
using Cloudflare. `gemini_model` defaults to `gemini-3.6-flash` and can be changed
to another compatible image/structured-output Gemini model available to your account.
Explicit `doctor_provider: gemini` or `cloudflare` pins the provider; a missing
key does not silently switch providers.

For Cloudflare, enter `cloudflare_account_id` and `cloudflare_api_token`.
Accept the terms for
`@cf/meta/llama-3.2-11b-vision-instruct` in the Cloudflare dashboard before the
first check.

Both API credentials are protected app options. They are read by the backend, not sent to
the browser, is not written to logs or audit records, and must never be committed
to Git. Every PlantCare installation uses its owner's credentials;
there is no shared PlantCare AI account.

For each check, PlantCare asks the user to take or choose a separate current
diagnostic photo and provide fresh consent. It does not use, replace, or store
the plant's cover photo for this purpose. It sends the selected provider a temporary
metadata-free copy resized to at most 1280 pixels, the plant identity,
area/precise position/exposure, the latest moisture, temperature, and
illuminance values, and a compact summary of up to seven days of local
soil-moisture readings, per-metric freshness and available drying context. Optional
“What changed?” notes can explain symptom onset, watering, movement or treatment.
Raw Home Assistant entity history is not sent.
On later checks it also sends at most five recent text-only assessment summaries,
recommendations, queue decisions, and outcomes. Previous diagnostic photos,
Home Assistant credentials, and entity IDs are not sent.

Successful assessments and their sensor snapshots are saved locally under
PlantCare's app data and included in Home Assistant backups. A user can decline
a recommendation or add it to the shared care queue, where it is labelled **AI
recommendation** and remains manually completable. On a later visit, an accepted
recommendation can be marked **Helped**, **Didn't help**, or **Not sure**. That
feedback helps the next assessment avoid repeating unsuccessful advice without
new evidence. AI output never changes care or controls devices by itself.

Each result separates identity confidence from care confidence, and includes
urgency, supporting evidence, immediate steps, things to avoid, expected improvement,
and when to reassess. Uncertain species identification still permits conditional
symptom guidance. A clear photo mismatch blocks adding its advice to the saved
plant's queue. Wilting alone is not treated as proof that more water is needed.
Watering instructions are provided only when supported; an empty watering plan
does not get replaced by generic watering advice. A suggested notification percentage is a
starting point to calibrate against that sensor, substrate, probe placement, and
pot; it is not treated as a universal watering threshold.

The consent screen also shows how many successful Plant Doctor checks this
PlantCare installation has completed since 00:00 UTC across providers. For Cloudflare it includes a reminder of
the 10,000-neuron daily free allocation and an approximate 10–50 neurons per
check. This is a local check count, not Cloudflare account-wide usage; activity
from other applications is visible only in the provider dashboard. Gemini results
show tokens, not neurons; account/model limits and billing must be checked in
Google AI Studio. Failed attempts can consume quota even when nothing is saved.

Optional `doctor_cloudflare_fallback: true` offers a separate, unchecked consent
box when both providers are configured. Only with that per-check permission can
a Gemini service/quota/format failure send the same photo/context to Cloudflare.
Uncertainty is not a failure and does not trigger fallback. Authentication/configuration
errors do not trigger it either. Results identify the actual provider and fallback use.
Shown usage covers the successful provider, not the failed primary attempt.

Google's unpaid API service may use submitted content to improve its products;
review [Google's terms](https://ai.google.dev/gemini-api/terms) before sharing photos.
Model support: [Gemini 3.6 Flash](https://ai.google.dev/gemini-api/docs/models/gemini-3.6-flash),
[structured output](https://ai.google.dev/gemini-api/docs/structured-output),
and [pricing/data use](https://ai.google.dev/gemini-api/docs/pricing).
Automated tests use mock providers; they do not establish live diagnostic accuracy.

On Cloudflare's Workers Free plan, requests stop with an error after the daily
allocation is exhausted and resume after the 00:00 UTC reset; they are not
silently slowed or charged. On Workers Paid, usage beyond the free allocation
can continue at Cloudflare's published rate. PlantCare identifies Cloudflare's
documented quota, capacity, rate-limit, authentication, model-access, and general
availability failures and displays a specific next step. A rejected token may
be expired, revoked, or missing Workers AI permission; PlantCare never logs or
returns the token itself.

## Sensor mapping

Open a plant, choose **Manage sensor mapping**, and select its moisture,
temperature, battery, and optional illuminance entities. Plant identity and
history stay in PlantCare: changing or deleting a Home Assistant entity only
marks the mapping unavailable and never deletes the plant.

New plants with mappings and later mapping changes are committed before the
backend requests an immediate reading refresh. If Home Assistant is temporarily
unavailable, the selected mapping stays saved and the regular background
synchronization retries automatically; the first sync never depends on the
browser remaining open.

`unknown`, `unavailable`, empty, non-numeric, wrong-unit, and out-of-range states
are not stored as measurements and do not overwrite the last known good value.
Repeated synchronization is idempotent using the Home Assistant update time.

On a plant card, select the temperature reading to reveal its typical normal
range. Identified plants use a species profile; unidentified plants show a
clearly labelled general indoor or outdoor fallback. These ranges are guidance
only and do not currently trigger care actions or notifications.

Select the moisture reading to reveal two starting monitoring thresholds using
the same species/fallback approach: a watering-check trigger and a prolonged-wet
trigger. These do not describe a universal healthy interval. Different sensors,
substrates, and probe positions can report different values for the same pot.
Open **Details → Edit plant → Moisture monitoring** to enable custom thresholds
for an individual plant or leave customization off to follow its species profile.

PlantCare creates a **Check soil moisture** action after three fresh readings at
or below the watering-check trigger. It asks for checks in several root-zone
locations before watering; the percentage alone never commands watering. A
single low reading marks the plant **Watch** while confirmation is pending. The
action completes automatically after the reading rises at least five percentage
points above the trigger.

When at least three readings remain at or above the prolonged-wet trigger for 24
hours, PlantCare creates **Help soil dry safely** with drainage, standing-water,
airflow, and inspection guidance. It completes automatically after the reading
falls five points below that trigger. The separate recovery boundaries prevent
repeated alerts when a reading moves back and forth near a threshold.

PlantCare's **Moisture** value means moisture in the potting medium. Some Home
Assistant plant probes classify that entity as `humidity`, which PlantCare also
accepts, but it is not the same as room relative humidity. This distinction is
especially important for orchids: their preferred air humidity does not define
a valid bark- or moss-moisture sensor percentage.

Plant Doctor receives the friendly, common, and scientific names saved for the
plant, together with the matching care profile. It is instructed to use that as
the working identification, mention the plant in its summary, compare available
sensor readings with the profile, and flag a photo that appears inconsistent
with the saved identity. If the species is not confirmed, it receives a clearly
labelled indoor, outdoor-container, or warm-growing-orchid fallback instead.

The bundled profiles use conservative household-growing guidance from sources
including university extension material and the American Orchid Society.
Temperature bands are species guidance. Soil values are deliberately labelled
as provisional monitoring triggers rather than universal targets: potting media,
sensor calibration, probe position, and plant growth all affect the percentage.

Plant details also include a bundled care guide. Identified plants receive a
different species-specific featured tip on each visit, with controls to shuffle
again or expand all tips. Unidentified plants receive clearly labelled general
indoor or outdoor container guidance until their species is entered.

## Sensor responsiveness and Home Assistant notifications

For moisture, PlantCare checks the latest Home Assistant report timestamp
(falling back to last_updated). A constant value, including 100%, is not alone a
sensor failure. No recent report for 72 hours creates a reporting warning that
clears after a fresh report. Temperature and illuminance still use value-change
timestamps. Battery values are excluded from unchanged-value monitoring.

### Per-pot drying tracking

High moisture alone no longer starts a fixed 24-hour alert. A rise of at least
15 percentage points into the wet band within 24 hours suggests watering and
shows **Recently watered** for 48 hours. It does not prove watering occurred.
Three complete observed cycles (from that rise back to the watering threshold
plus five points) establish a provisional median of the latest five cycles.
While still high, a cycle exceeding 1.5 times that median (minimum 72 hours)
prompts a drainage review. Gaps longer than 72 hours invalidate a pending cycle.
Learning uses up to 120 days of readings for the currently mapped sensor.

Before enough history exists, the app shows **Learning drying pattern**.
After 72 hours at or above the wet band with at least three recent readings and
less than a five-point decline, it shows **Still very wet**. This is an early
informational status only: it creates no action or notification and does not
diagnose overwatering. A meaningful decline, fewer fresh readings, or lower
moisture clears it.
An optional wet-duration timer in **Edit plant** can override the learned timer.
A 14-day high plateau still prompts review regardless of the baseline or custom
timer, to avoid calling a consistently poor drying pattern healthy. These are
trial monitoring heuristics, not species-specific root-health diagnoses. Wet
alerts require at least three readings; sensor values need local calibration.
Existing alerts from the old timer close automatically if no longer warranted.

The threshold can be changed from 24 to 720 hours under **Home Assistant →
Settings → Apps → Plant Care Dashboard → Configuration** using
`stale_sensor_hours`. The monitor uses 72 hours by default. Restart the app after
changing an app option.

`home_assistant_notifications` is enabled by default. A newly confirmed
low-moisture condition, prolonged-wet condition, battery below 20%, or
non-responsive sensor creates one persistent notification in Home Assistant
using the Supervisor token already injected into the app; no webhook, long-lived
access token, or Telegram setup is required. The notification contains a link
that opens PlantCare directly on the affected plant card. Recovery completes the
matching monitoring-managed action and dismisses its notification automatically.
Battery recovery requires at least 25%, providing hysteresis around the warning
threshold. Delivery can be disabled in the same app configuration screen.

Persistent notifications appear in Home Assistant's notification panel rather
than as direct iOS or Android push alerts. A future mobile-notify option can send
the same event to selected Home Assistant Companion App notify entities without
changing the sensor monitor or storing additional credentials.
