# Workshop readiness review — 18 October 2026

The five-round simulation is implemented. This review focused on participant entry, host control and recovery during an actual workshop.

| Finding | Implemented correction |
| --- | --- |
| Resend reported success during cooldown or after SMTP failure. | Explicit 429 countdown/`Retry-After`, actionable 503 errors, persistent form feedback. |
| Replacing a PIN could invalidate the old code before mail succeeded. | Commit the replacement only after SMTP accepts it; serialize recovery requests per account. |
| Selecting a village or polling could clear a form. | Preserve registration, content and grant drafts; prefill the login email; prevent polling from replacing a pending submission. |
| The QR dependency existed without an invitation feature. | Host and waiting-room projector render a locally generated QR for the configured public URL, plus a copyable link. |
| Lost connections left a misleading live display. | Show cached-state/reconnection status and automatically recover the existing session. |
| A long outage could advance the economy on return. | Recover an active game paused at the last saved tick; preserve incident timing across pauses. |
| There was no usable finish control or frozen outcome screen. | Add host finish, actual per-village outcomes and projector results; reject economic changes and round advancement after finish. |
| Some player permissions differed between UI and API. | Match newsroom/content permissions, including the Culture Ambassador; disable unavailable host/player actions. |
| Purchases were inferred from only the latest 24 events. | Read completed projects from the persistent investments table. |
| The page policy blocked dynamic indicator styles. | Permit style attributes while keeping scripts restricted to same-origin files; verify actual indicator widths in the browser. |

## Verification

- `npm test`: complete five-round rehearsal plus regressions for resend, cooldown, concurrency, a synthetic SMTP rejection, failed-registration cleanup, recovery, permissions and frozen results. Tests use temporary databases and never contact a real mail provider.
- `npm run load-test`: 30 players behind one IP, 431 requests, zero errors in the local rehearsal. This measures the test environment, not the venue network or Pi.
- Chromium browser check: mobile registration and PIN login, preserved drafts, countdown, network loss/recovery, host controls and final projector display. The rendered invitation QR was independently decoded to confirm its target. No JavaScript errors or content-policy violations were observed.
- Dependency lockfile and Docker `npm ci` make installs reproducible.

## Runtime checks still needed on the Raspberry Pi

The review did not access or modify the Pi. GitHub changes must be pulled and the service restarted there, preserving `.env` and the SQLite database. Verify the actual public game URL, organiser contact and one real SMTP PIN/resend before opening the workshop. The QR uses the configured address; it does not create hosting or prove external reachability. An active saved round will return paused after the update.
