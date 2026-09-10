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
5. Optionally choose a private cover photo while adding the plant. It can be
   added, replaced, or removed later from **Details → Edit plant**.
6. Optional: configure Plant Doctor with your own Cloudflare account credentials
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

Plant Doctor uses Cloudflare Workers AI only when an installation owner provides
their own credentials. In Home Assistant, open **Settings → Apps → Plant Care
Dashboard → Configuration**, enter `cloudflare_account_id` and
`cloudflare_api_token`, save, and restart the app. Accept the terms for
`@cf/meta/llama-3.2-11b-vision-instruct` in the Cloudflare dashboard before the
first check.

The token is a protected app option. It is read by the backend, is not sent to
the browser, is not written to logs or audit records, and must never be committed
to Git. Every PlantCare installation uses its owner's Cloudflare credentials;
there is no shared PlantCare AI account.

For each check, PlantCare asks the user to take or choose a separate current
diagnostic photo and provide fresh consent. It does not use, replace, or store
the plant's cover photo for this purpose. It sends Cloudflare a temporary
metadata-free copy resized to at most 1280 pixels, the plant identity,
location/exposure, and the latest moisture, temperature, and illuminance values.
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

The consent screen also shows how many successful Plant Doctor checks this
PlantCare installation has completed since 00:00 UTC. It includes a reminder of
the 10,000-neuron daily free allocation and an approximate 10–50 neurons per
check. This is a local check count, not Cloudflare account-wide usage; activity
from other applications is visible only in the Cloudflare dashboard.

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

Mapping changes are committed before PlantCare requests an immediate reading
refresh. If Home Assistant is temporarily unavailable, the selected mapping
stays saved and the regular background synchronization retries automatically.

`unknown`, `unavailable`, empty, non-numeric, wrong-unit, and out-of-range states
are not stored as measurements and do not overwrite the last known good value.
Repeated synchronization is idempotent using the Home Assistant update time.

On a plant card, select the temperature reading to reveal its typical normal
range. Identified plants use a species profile; unidentified plants show a
clearly labelled general indoor or outdoor fallback. These ranges are guidance
only and do not currently trigger care actions or notifications.

Plant details also include a bundled care guide. Identified plants receive a
different species-specific featured tip on each visit, with controls to shuffle
again or expand all tips. Unidentified plants receive clearly labelled general
indoor or outdoor container guidance until their species is entered.

## Sensor responsiveness and Home Assistant notifications

PlantCare checks Home Assistant's value-change timestamp for every mapped
moisture, temperature, and illuminance entity. When a valid sensor value has not
changed for 72 hours, the plant is marked **Sensor issue** and a deduplicated
**Check sensor** action is added to the care queue. The action remains
sensor-managed and completes automatically once Home Assistant reports a fresh
value change. Battery entities are deliberately excluded because a healthy
battery percentage can legitimately remain unchanged for days or weeks.

The threshold can be changed from 24 to 720 hours under **Home Assistant →
Settings → Apps → Plant Care Dashboard → Configuration** using
`stale_sensor_hours`. The monitor uses 72 hours by default. Restart the app after
changing an app option.

`home_assistant_notifications` is enabled by default. A newly detected sensor
issue creates one persistent notification in Home Assistant using the Supervisor
token already injected into the app; no webhook, long-lived access token, or
Telegram setup is required. The notification contains a link that opens
PlantCare directly on the affected plant card. When the sensor value changes and
the issue closes, PlantCare dismisses the matching notification automatically.
Delivery can be disabled in the same app configuration screen.

Persistent notifications appear in Home Assistant's notification panel rather
than as direct iOS or Android push alerts. A future mobile-notify option can send
the same event to selected Home Assistant Companion App notify entities without
changing the sensor monitor or storing additional credentials.
