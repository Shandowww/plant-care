# Privacy and security

- Core monitoring is local and has no direct MQTT or Zigbee access.
- The Home Assistant Supervisor token is read only from the process environment.
- The LAN password is stored as an Argon2id hash; session secrets live under
  `/data/secrets` with restrictive permissions.
- Ingress identity is accepted only on the dedicated ingress proxy surface.
- Provider photos will require per-request consent. Photo-provider features are
  not active in Phase 1.
- Normal exports and diagnostics exclude secrets and photos.
