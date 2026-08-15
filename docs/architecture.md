# Architecture

The product uses one FastAPI application and SQLite database behind two Nginx
listeners. Port `8099` is reachable only through Home Assistant ingress. Port
`8098` is the explicitly mapped LAN surface and requires the shared application
password. Nginx removes caller-supplied identity headers and writes a trusted
internal surface marker before proxying to the API.

The React application is compiled to static assets during the container build
and served by the API. Runtime data, the SQLite WAL, secrets, retained media,
and migration backups live only under `/data`.

Home Assistant Core remains the sole live device source. The Phase 2 REST client
discovers relevant entities and synchronizes only explicitly mapped entities on
a guarded background interval. Normalized readings are stored idempotently by
plant, metric, entity ID, and Home Assistant update timestamp. Invalid states do
not overwrite the last good value. WebSocket event ingestion and bounded Recorder
backfill remain Phase 2 follow-up work.

The browser refreshes shared plants, actions, and action history every 30 seconds,
so open ingress and LAN sessions converge after background synchronization. The
development simulator is disabled in production by an explicit environment guard.

The current Home Assistant app format no longer consumes `build.yaml` (retired
in Supervisor 2026.04). Base images and app labels therefore live directly in
the Dockerfile.
