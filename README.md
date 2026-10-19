# Digital Village — Survive. Connect. Grow.

A mobile-first multiplayer teaching simulation for the RURALEM / Erasmus+ Digital Competences workshop: four villages, up to 32 participants, five rounds, and a host control center. One Node.js process calculates and saves the world in SQLite. The app and QR generator run on the Raspberry Pi; no AI API or cloud database is required.

**Arriving with the Pi? Start with [the Russian arrival instructions](deploy/ARRIVAL_RU.md).** The tested code does not update the physical Pi until you run the update there. A real inbox and the venue network still need a delivery/connectivity check.

For the existing `digitvillage-play.pages.dev` address, [optional free domain automation](deploy/auto-domain/README.md) starts the game tunnel after reboot and updates the gateway without changing the QR. It requires one private, account-scoped Cloudflare Pages API token entered on the Pi.

## Implemented experience

| Round | What participants do | What changes |
|---|---|---|
| 1 — Development, 20 min | Choose investments; react to a funding crisis | The crisis removes 30% of each village's current budget, once, at minute 10 or on host command. Investments affect the continuing economy. |
| 2 — Information, 20 min | Verify and share up to six reports about other villages | Each workshop generates 28 shuffled articles from the actual round-one closing data: four facts and three fabrications per village. Official source bulletins show metrics, projects, signers and seals. Reveal explains each verdict. |
| 3 — Content, 20 min | Publish a village campaign with selected creative assets | Explicit usage conditions and required attribution affect the outcome. Concurrent edits cannot silently overwrite a newer campaign. |
| 4 — Collaboration, 30 min | Claim four standard festival tasks and two urgent tasks | Progress depends on time, role and workload. Helping another person has a one-minute cooldown. Urgent tasks appear at minute 4. Success requires all six tasks. |
| 5 — Security, 15 min | Answer four practical questions about senders, links, data and urgent payments | Each answer is saved. The host closes the exercise to reveal explanations and apply the participation-adjusted trust outcome. All registered participants receive a simulated phishing email linking to a simple educational reveal page. |

The server advances the world without a connected browser. Income, upkeep, migration and trust update every 10 active seconds; incidents appear every two active minutes in rounds 1–4. At the deadline the round closes automatically into **review**, freezing the economy until the host opens the next round. Pause stops both the clock and incidents. Restart restores an active round paused, without charging for offline time.

Every closed round saves **all seven village metrics, changes, participant names and positions, decisions, incidents and a factual mini story**. Players and the projector can view reports; the archive retains previous rounds. Finishing adds a story spanning the completed workshop. Missing rounds are never invented.

Registration uses a private emailed six-digit PIN, hashed on the server, rate limits and HTTP-only sessions. Resend has a visible cooldown and preserves the old PIN when a replacement fails. The host can verify a participant in person and issue a private PIN if email is unavailable. Invitations include a real locally generated QR for `PUBLIC_BASE_URL`; changing that setting and restarting updates the QR.

## Local rehearsal

Requires Node.js **22.13+**; the already prepared Pi uses Node 24. Use one application process.

1. Copy `.env.example` to `.env`; set distinct strong `ADMIN_PASSWORD` and `PIN_PEPPER`.
2. For a private rehearsal use `DEV_EMAIL_OUTBOX=1` without real mail credentials. The host's labelled rehearsal outbox contains the synthetic PIN letters.
3. Run `npm ci`, then `npm start`; open `http://127.0.0.1:3000`.
4. Sign in on the Host tab. Use separate browser contexts for participants. Start the round, then **Close round & view results** → discuss → **Open next round**. Round five ends with **Finish simulation**.
5. Open `/?projector=1` in a separate host tab for projection.

Do not expose rehearsal outbox mode publicly. For HTTPS operation, use the exact public origin in `PUBLIC_BASE_URL`; the browser uses secure session cookies.

## Raspberry Pi operation

[Arrival guide](deploy/ARRIVAL_RU.md) · [Free HTTPS name](deploy/FREE_DOMAIN_RU.md) · [Technical deployment details](deploy/PI_SETUP.md) · [Readiness review](deploy/WORKSHOP_REVIEW.md).

The launcher stages a complete version, installs locked dependencies, runs integration and 30-player checks, backs up the database/configuration, generates a systemd unit using the installed Node path, switches the release and checks health. `digital-village.service` starts after reboot and restarts after a crash. Saved data stays in the checkout's `storage/` directory through an absolute database path.

The default prepared route uses **Tailscale Funnel on HTTPS port 8443**, preserving the existing Observatory at HTTPS port 443 / local port 8080. The launcher refuses to replace another service on 8443. Phones need ordinary Internet access; they do not need Tailscale installed. For a free friendly address, [the prepared Cloudflare Pages gateway](deploy/FREE_DOMAIN_RU.md) can expose the Pi at an available `*.pages.dev` name. It requires the owner’s free Cloudflare account and has a shared 100,000-request daily quota. The name is not registered by this code update. Future Funnel updates preserve a chosen custom public origin. A purchased-domain hostname can instead use Cloudflare Tunnel to `http://127.0.0.1:3000` and the `--apply` launcher mode.

`npm run doctor` checks local/public service identity, host authentication, sender configuration and the invitation QR. It deliberately sends **no mail**. To send one requested test, use Host → setup → **Send one delivery test**, or `node deploy/doctor.mjs --public --mail recipient@example.com` with an actual recipient you control.

## Email

- Gmail SMTP: set both `SMTP_EMAIL` and `SMTP_APP_PASSWORD` for a dedicated account. `SMTP_HOST` / `SMTP_PORT` optionally support another SMTP server.
- Optional separate Gmail/SMTP teaching account: set `EXERCISE_SMTP_EMAIL` and `EXERCISE_SMTP_APP_PASSWORD`. The exercise for all participants and its host test then use that account; its failures never fall back into the PIN account. Without these settings the current sender is shared. The host displays which mode is active and can test each sender separately. PIN jobs run first, and exercise jobs leave one of four dispatch slots available.
- Optional Resend HTTPS sender: set `RESEND_API_KEY` and `EMAIL_FROM` on your own verified sending domain. If both providers are configured, Resend is primary and SMTP is the real fallback.
- Outgoing mail is saved in an **encrypted SQLite queue before dispatch**. Temporary failures retry with increasing delays for up to 15 minutes, including after a process restart. The same request ID is reused for Resend idempotency; SMTP keeps a stable Message-ID, which does not guarantee deduplication by the recipient. Permanent failures stop. Completed or expired payloads are removed. Keep the existing `PIN_PEPPER`: it also protects the queue.
- HTTP **202 / queued** means a saved pending request, never successful delivery. A queued registration keeps its place; expiry or permanent failure releases an unused registration. A failed/pending replacement leaves the old PIN usable until the provider accepts the new one. Host rescue cancels a delayed replacement so it cannot overwrite the hand-delivered PIN.
- Round-five notification jobs are saved as one batch, so a restart cannot silently drop its unsent recipients. Requests not yet sending are cancelled after the workshop ends. A real job cannot become fake rehearsal success after credentials are removed.
- Host diagnostics distinguish sending, provider acceptance, failure, interruption and rehearsal. Logs contain delivery metadata/provider IDs, not PIN bodies. The host sees the pending count; the doctor treats a queued delivery test as unconfirmed.
- Provider acceptance **does not prove inbox receipt**. Check inbox/spam from a real phone before registration. A lost acknowledgment can also cause duplicate mail across providers; use the most recent successful PIN. The in-person host entry route keeps the workshop usable without email.

## Timing and facilitation

Maximum active round time is 105 minutes; 10 minutes of registration and 5 minutes of final reflection fill two hours. Review pauses add wall-clock time. To fit five two-minute report discussions into two hours, close rounds after **18 / 18 / 18 / 28 / 13 minutes**. Leave round one running past minute 10 and round four past minute 4 to include their timed crises. Otherwise budget a longer workshop.

Four tables of 5–8 people work well. Each council has a mayor and specialised roles. Different villages start with different resources; compare changes and decisions, as well as final values. This is a simplified learning simulation, not an economic forecast.

## Verification and data

`npm test` runs isolated integration, mail-failure, recovery, report, timing, concurrency and Pi-preparation checks. `npm run load-test` rehearses 30 players behind one IP. Both use temporary databases and synthetic mail; neither sends real participant email. See the readiness review for browser scenarios and remaining hardware checks.

Use a real `PRIVACY_CONTACT`; explain names/emails, roles, reports, retention and the workshop exercise email sent to all participants. **Reset game** resets only a finished session after password and phrase confirmation. Final reports, report access and queued report emails survive; this is not a complete personal-data erasure tool. Sent emails and private backups remain outside the reset. Keep `.env`, `storage/`, `backups/` and `runtime/` out of Git. Backups include private configuration and must remain private.

The optional `Dockerfile` also supports a single persistent container: mount `/data`, set `DB_PATH=/data/village.db`, `HOST=0.0.0.0`, real sender/contact, strong secrets, `DEV_EMAIL_OUTBOX=0`, and the HTTPS public URL. Health is `GET /healthz` → `{"ok":true,"app":"digital-village"}`. Do not use multiple replicas or ephemeral serverless storage for this SQLite app.


SMTP setup and launch: [Russian quick start](deploy/SMTP_START_RU.md). Browser checks: `npm run test:e2e` after `npx playwright install chromium`. Load rehearsal: `npm run load-test` (30 players, including final reports and reset).


## Participant readiness and exercise monitoring

The host-only **Participants** tab lists names, account emails, villages and roles, current sign-in sessions, online presence (seen within 35 seconds), and participant-confirmed readiness. Players toggle **I’m ready** on Overview. Readiness and online presence are separate: closing a page does not automatically revoke readiness, and a signed-in browser may be offline.

Round five sends each participant a personal opaque exercise link. A visible reveal page reports its first/last open and total page opens to the host. Merely fetching the HTML does not mark an open. These are page-open signals, not proof that a human clicked: email security scanners can sometimes execute pages too. IP addresses and device details are not stored with these signals. Existing unpersonalised links remain usable but cannot identify a participant.

Each row shows the latest exercise delivery status, error code and request count. **Resend exercise** enqueues a new email for that participant while round five is playing, paused or in review. It preserves the personal link and earlier opens, rejects requests while a previous job is pending, and enforces a 90-second per-person cooldown. Provider acceptance does not prove inbox delivery. A server restart retains tracking/readiness and queued requests. Reset clears these session-specific records and invalidates old tracking links; saved final reports remain unchanged.

Checks: `npm run test:monitor` runs a real-handler/SQLite integration rehearsal for 30 participants in process, with no listening socket or real email. `npm run test:e2e` includes Chromium checks for the participant tab, readiness, personal-link opens and resend controls.
