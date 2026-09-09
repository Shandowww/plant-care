# Privacy and security

- Core monitoring is local and has no direct MQTT or Zigbee access.
- The Home Assistant Supervisor token is read only from the process environment.
- The LAN password is stored as an Argon2id hash; session secrets live under
  `/data/secrets` with restrictive permissions.
- Ingress identity is accepted only on the dedicated ingress proxy surface.
- Personal plant photos are processed and retained locally under `/data`.
- Provider-backed Plant Doctor checks will require per-request consent and are
  not active yet; locally stored photos are never sent automatically.
- Normal exports and diagnostics exclude secrets and photos.
