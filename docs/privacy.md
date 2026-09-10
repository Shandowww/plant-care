# Privacy and security

- Core monitoring is local and has no direct MQTT or Zigbee access.
- The Home Assistant Supervisor token is read only from the process environment.
- The LAN password is stored as an Argon2id hash; session secrets live under
  `/data/secrets` with restrictive permissions.
- Ingress identity is accepted only on the dedicated ingress proxy surface.
- Personal plant photos are processed and retained locally under `/data`.
- Plant Doctor is optional and requires the installation owner's own Cloudflare
  Account ID and API token. Those credentials stay in protected app options and
  are never returned to the browser, logged, audited, or committed to Git.
- A Plant Doctor check sends a reduced metadata-free image plus limited plant and
  sensor context to Cloudflare only after explicit consent for that request.
  Home Assistant credentials and entity IDs are not included.
- Plant Doctor output is displayed transiently and is not persisted. A user can
  explicitly copy its safe next checks into a clearly labelled AI recommendation
  task; AI output cannot modify care or control devices automatically.
- PlantCare locally counts successful Doctor checks per UTC day from minimal
  audit metadata. It does not query or expose Cloudflare billing information.
- Normal exports and diagnostics exclude secrets and photos.
