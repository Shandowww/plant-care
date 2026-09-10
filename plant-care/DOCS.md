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
5. Open a plant's **Details**, choose **Edit plant**, and add or replace its
   private photo in the same form as its name, area, and exposure.
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
and stores a private JPEG. Replacing or removing a photo is part of **Edit
plant**, and cards and details update automatically. On iPhone and iPad, the
system picker offers the photo library, camera, and files rather than opening
the camera automatically.

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

For each check, PlantCare requires a current private photo and fresh consent.
It sends Cloudflare a temporary metadata-free copy resized to at most 1280 pixels,
the plant identity, location/exposure, and the latest moisture, temperature, and
illuminance values. It does not send Home Assistant credentials or entity IDs.
The assessment and neuron usage are displayed but not saved. After reviewing an
assessment, a user may explicitly add its safe next checks to the shared care
queue. The resulting task is labelled **AI recommendation**, can be snoozed or
completed manually, and appears in action history. AI output never changes care
or controls devices by itself. Cloudflare's allowance and data policies remain
subject to the owner's Cloudflare plan and terms.

The consent screen also shows how many successful Plant Doctor checks this
PlantCare installation has completed since 00:00 UTC. It includes a reminder of
the 10,000-neuron daily free allocation and an approximate 10–50 neurons per
check. This is a local check count, not Cloudflare account-wide usage; activity
from other applications is visible only in the Cloudflare dashboard.

## Sensor mapping

Open a plant, choose **Manage sensor mapping**, and select its moisture,
temperature, battery, and optional illuminance entities. Plant identity and
history stay in PlantCare: changing or deleting a Home Assistant entity only
marks the mapping unavailable and never deletes the plant.

`unknown`, `unavailable`, empty, non-numeric, wrong-unit, and out-of-range states
are not stored as measurements and do not overwrite the last known good value.
Repeated synchronization is idempotent using the Home Assistant update time.
