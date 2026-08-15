# Troubleshooting

Check the app log and `/api/v1/health` first. A healthy Phase 1 response reports
database readiness and simulator status. The simulator intentionally requires
`PLANTCARE_ENV=development`; the production image does not enable it.

If the LAN page redirects to login, create or change its shared password from
the Home Assistant ingress page. Do not publish the LAN port externally.
