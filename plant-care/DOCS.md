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
4. Add each plant and use **Manage sensor mapping** to select its Home Assistant
   moisture, temperature, battery, and optional illuminance entities.
5. If the standalone LAN view is needed, create its password from the ingress
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
backups. No Home Assistant, Telegram, Pl@ntNet, or OpenAI credentials are placed
in app options.

## Sensor mapping

Open a plant, choose **Manage sensor mapping**, and select its moisture,
temperature, battery, and optional illuminance entities. Plant identity and
history stay in PlantCare: changing or deleting a Home Assistant entity only
marks the mapping unavailable and never deletes the plant.

`unknown`, `unavailable`, empty, non-numeric, wrong-unit, and out-of-range states
are not stored as measurements and do not overwrite the last known good value.
Repeated synchronization is idempotent using the Home Assistant update time.
