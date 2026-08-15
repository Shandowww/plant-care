# Release checklist

- [ ] Replace placeholder repository and support URLs.
- [x] Run backend formatting, lint, strict type checking, and tests.
- [x] Run frontend lint, type checking, tests, build, and dependency audit.
- [ ] Validate Home Assistant app metadata and AppArmor profile.
- [x] Build and smoke-test the `aarch64` image locally.
- [ ] Build and smoke-test the `amd64` image.
- [ ] Install the `aarch64` image on Home Assistant OS and reboot the host.
- [ ] Verify ingress access has no second login.
- [ ] Verify LAN access requires the shared password.
- [ ] Verify LAN requests cannot inject ingress identity headers.
- [ ] Review image contents, logs, diagnostics, and built assets for secrets.
- [ ] Back up and restore the latest schema migration.
- [ ] Record acceptance evidence and remaining limitations in release notes.
