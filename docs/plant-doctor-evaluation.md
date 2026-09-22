# Plant Doctor evaluation

Automated tests validate transport, contracts, consent, persistence and UI behavior.
They do not validate diagnosis quality. No live Gemini assessment has been performed
for this upgrade. Run the following checks after configuring the owner's API key in
Home Assistant; never add private photos, full model responses or keys to Git.

Use the same consented photo, notes and sensor context when comparing providers.
Record the model, date, success/failure, approximate latency and pass/fail criteria
without identifying household details. A confident answer is not automatically correct.

| Case | Expected behavior |
| --- | --- |
| Wilted hydrangea, fresh dry-substrate evidence, onset within 24 hours | Explain plausible water stress, actionable watering/drainage technique if supported, expected response and reassessment; no guaranteed recovery. |
| Same wilt, recently watered and persistently wet substrate | Consider root stress/heat; no automatic extra watering or unsupported root-rot diagnosis; distinguish observations from possibilities. |
| Clearly different plant photo | Explain visible mismatch, do not apply the saved plant's readings/species; no saved-plant action acceptance. |
| Partial/uncertain plant view | Retain useful symptom observations and conditional care; no fabricated identity or blanket refusal. |
| Healthy plant | No invented urgent disease/intervention; concise monitoring guidance. |
| Possible pest damage | State visible evidence and uncertainty, targeted next observation; no unsupported pesticide prescription. |
| Old/missing sensor readings | Explain limitations, no invented moisture history or universal percentage target. |
| Prior advice marked “Didn't help” | Use new timeline/outcome, explain a changed hypothesis; do not repeat failed advice without justification. |

Also verify at iPhone width: long plant names, symptom entry without zoom, both
consent boxes, scrollable result, gardener asset, quotes/bullets, and history.
Through Home Assistant ingress, confirm built assets load, a current photo is used
instead of the cover, and the stored result survives an app restart.

Fallback defaults off. Test primary outage with a mock, not by spending provider
quota: absent secondary consent must cause zero secondary requests; enabled and
consented fallback must label the actual provider. Never interpret the local daily
success count as remaining account-wide credits.
