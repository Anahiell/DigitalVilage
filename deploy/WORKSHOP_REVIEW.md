# Workshop readiness review — 18 October 2026

This update reviews the complete five-round experience and prepares the existing Raspberry Pi installation. No physical Pi, domain account or real recipient mailbox was accessed. Code preparation and local verification must be distinguished from the final on-device rehearsal.

## Fixed and completed

| Area | Result |
|---|---|
| World and deadlines | Server clock advances independently of browser polling. Round deadlines close into a frozen review phase; discussion no longer keeps charging the economy. |
| Funding crisis | One 30% cut of current budgets, correct timed trigger, saved exact losses, immediate chart history, no duplicate manual cut. |
| News | 28 generated articles tied to real closing data, random IDs/order/seals, source bulletins, four facts/three fabrications per village, deliberate copied-seal fact-checking case, verdict explanations. |
| Campaigns | Usage conditions, actual required CC BY attribution and visible credits. Optimistic version checking preserves a stale draft instead of overwriting another councillor's publication. |
| Festival | Stable workload calculation, correct role speed, self-help rejected, team-help cooldown, urgent tickets inserted once, success requires all six tasks. |
| Security | Four saved practical answers per participant, explanations after close, trust outcome adjusted for the full possible participation. |
| Reports | Immutable per-round metrics/deltas, real names/positions, decisions/incidents and factual stories. Archive and projector support; whole-workshop story at finish. |
| Interface | Automatic round navigation, persistent disclosure panels/drafts, responsive report tables, keyboard focus/skip link, native private PIN dialog, honest connection and frozen states. |
| Email | Bounded retry/timeouts, optional HTTPS Resend with idempotency, real SMTP fallback, visible delivery metadata, requested real test mail, no fake success when credentials fail. |
| Durable mail | Encrypted SQLite jobs, delayed retries, stable provider request IDs and process-restart recovery. Queued is distinct from accepted. Expiry releases unused roles; rescue cancels delayed replacements. Real jobs cannot fall into a rehearsal outbox after a configuration change. |
| Host diagnostics | Valid logins no longer consume failed-password attempts, avoiding a 15-minute lockout caused by repeated doctor runs. Wrong passwords remain rate limited. |
| Entry fallback | Authenticated host can enrol a present participant and hand over a private PIN without any email provider. Existing accounts retain emergency PIN recovery. |
| Pi launch | Preserve robot's existing HTTPS 443 route; use separate game HTTPS 8443. Private consistent backup, isolated release, tests before switch, generated systemd unit, local-health rollback and public doctor. |

## Verification

- `npm test`: 23 isolated API/integration, mail and deployment checks. Covers all rounds, exact crisis losses, absent/stale clients, immutable reports, security score, both campaign attribution outcomes, concurrent publication, full festival completion/role workload/cooldown, restart and legacy schema migration, synthetic mail failures and private backup/configuration handling. A separate check proves host entry with outbox and all real providers disabled. Forced-process-termination checks cover registration and replacement recovery, provider acknowledgment followed by local transaction failure, encrypted payloads, expiry, cancellation, stale jobs and real-to-rehearsal prevention. No real mail is sent.
- `npm run load-test`: 30 synthetic users behind one IP, 431 requests and zero errors in the local rehearsal. This measures this test environment, not the Pi or venue Wi-Fi.
- Full Chromium rehearsal: host login and in-person entry/private PIN, real QR independently decoded, mobile player and Culture Ambassador, crisis/pause/resume, all five transitions and reports, source disclosures retained across polling, true/fake reveal, concurrent editing conflict/reload, credited campaign, festival help and urgent tickets, four saved security answers, overall story and projector. No JavaScript errors/CSP violations or mobile page overflow observed.
- Additional queue UI rehearsal: mobile queued-registration explanation and retained email, host pending count, rescue cancelling the delayed PIN, then successful phone login. No page overflow or script errors.
- Visual inspection: host controls, mobile round report, queued mail feedback and final projector results. Tables scroll horizontally inside their panel on narrow phones.
- Node syntax, shell syntax and whitespace checks. Dependency lockfile is updated and install remains reproducible.

## Required on-device confirmation

Run [ARRIVAL_RU.md](ARRIVAL_RU.md) on the Pi, then confirm local/public application identity from an external phone, unchanged Observatory route, real invitation QR, one actually received test email and registration PIN/resend. The launcher validates configuration but cannot prove credentials or inbox placement until sending/receipt are tested. Check the chosen public port on the actual venue network.

A real optional short domain requires its owner's DNS/Cloudflare access. A verified Resend sender requires its actual domain/key. Neither was invented, purchased or activated. Current Gmail settings are preserved, not assumed to have been verified during this review. After an update/restart, an active saved round returns paused for the host to resume.
