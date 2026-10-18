# DIGITAL VILLAGE 🌿 — Survive. Connect. Grow.

A mobile-first, real-time educational multiplayer strategy for the **RURALEM / Erasmus+ Digital Competences** module. Four villages, up to 32 players, five rounds, and a host-operated control center. Every decision affects a living economy whose metrics are calculated and persisted on the server.

**Status: functional workshop MVP.** Public access and real email delivery depend on the running host's HTTPS, SMTP and privacy settings. The project uses modern HTML, CSS, JavaScript and a Node.js HTTP server with built-in SQLite, `qrcode` for invitations, and optional Nodemailer for Gmail delivery. It has no frontend framework.

## What's implemented

- **Registration**: one of four villages, exclusive team role (eight seats per village), real email address, and *optional* separate consent for one educational email simulation.
- **Identity**: random unique six-digit PIN emailed on registration; PIN hash and private HTTP-only session; wrong-PIN lockout; rate limits; resend cooldown; host-only emergency PIN reset; restoration after browser refresh.
- **World**: budgets, youth population, employment, internet, education, services, trust; income and upkeep; attractiveness and migration; time-series snapshots **every 10 real seconds**; charts rendered directly from history rather than predefined animation frames.
- **Round 1**: five investments, persistent budgets, one-time 30% funding crisis at minute 10 or on host command.
- **Living-world incidents**: server-selected favourable or challenging events every two minutes during rounds 1–4 (regional investments, broadband damage, exchange students, employers leaving, tourism, volunteers). Players see breaking-news banners; effects are saved in the economy and its charts.
- **Round 2**: seven articles per village, real/fake variants, signatures and seals, team selections, host reveal, real effects on youth and trust.
- **Round 3**: responsive mobile content editor, ten creative assets, campaign preview, deliberate licensing traps, host reveal and penalties/rewards.
- **Round 4**: multi-user festival board; progress increases server-side; assigning to relevant roles is faster; helping tasks; timed arrival of urgent tickets; simulated festival outcome and impact.
- **Round 5**: safe educational inbox + opt-in email notification leading to an on-site awareness page. No imitation of Microsoft or collection of passwords.
- **Host**: separate login, readiness indicators, start / pause / resume / next, reveal results, grant money, trigger crisis and ticket event, emergency PIN issuance, simulated email outbox for rehearsal, separate projector mode, erase event data.
- **Persistence**: SQLite in WAL mode; idempotent investment purchase, role reservation constraints, stored history and events; automatic state recovery after restarting the Node server.
- **Participant support**: the login form keeps the entered email, shows persistent delivery errors and a 90-second resend countdown, and keeps the previous PIN valid if replacement mail fails. Simultaneous replacement requests cannot overwrite each other.
- **Invitations**: the host dashboard and waiting-room projector show a real scannable QR for `PUBLIC_BASE_URL`, with a copyable invitation link. QR generation happens locally on the server.
- **Recovery and reflection**: connection loss is visible while the browser reconnects; a restarted server pauses the saved round for the host to resume. **Finish simulation** freezes the economy and displays each village's actual youth change, remaining budget and trust.

## Run locally

Requires **Node.js 22.13 or newer** (SQLite is an experimental built-in API in Node 22; a warning is expected).

1. Copy `.env.example` to `.env` and set strong, distinct `ADMIN_PASSWORD` and `PIN_PEPPER`. **Do not commit `.env`.**
2. For a private rehearsal only, keep `DEV_EMAIL_OUTBOX=1`. The host can see PINs in the development outbox. **Do not expose this mode to participants on a public network.**
3. Run `npm ci`, then `npm start` inside this directory. Open `http://127.0.0.1:3000` in a browser. Run `npm test` for the API integration and recovery regression tests.
4. To see the game: open the Host tab, sign in with `ADMIN_PASSWORD`, register players using another browser (or private windows), find their PINs in the host's test outbox, then press **Start the game**.
5. In a second host tab open `/?projector=1` to show the projector presentation while keeping the dashboard in the first tab.

`npm ci` includes Nodemailer unless optional dependencies are explicitly omitted. Set `SMTP_EMAIL` and `SMTP_APP_PASSWORD` with a **separate Gmail account** protected by two-step verification and a Google app password. Never store these details in the browser. Test delivery with a single recipient before inviting 30 people. Sending with consumer Gmail can be restricted or delayed; be prepared to issue an emergency PIN. **PUBLIC_BASE_URL** must be the externally reachable HTTPS address used in your messages.

SMTP success means the email service accepted the message, not that it has reached the inbox. The participant should check spam as well. A missing sender or SMTP failure returns a specific HTTP 503 error; a resend during cooldown returns HTTP 429 with `Retry-After`. Failed registration releases its village role. A failed replacement leaves the existing PIN intact. The host's rehearsal outbox is explicitly labelled as rehearsal and does not prove real email delivery.

Round-five opt-in notifications are sent in small background batches so a slow mail provider cannot hold up the round change. The world event feed records the accepted-message count. If the public address is missing, no unusable localhost link is sent; the on-site security lab remains available.

## Public deployment with Railway (persistent storage)

The app runs on a **single long-lived Node instance**, not a Vercel serverless function. Use the supplied `Dockerfile` (Node 22, no compilation/build step) to deploy the GitHub repository as a Railway service or an equivalent container host. Attach a **persistent volume mounted at `/data`** before any participants register. The SQLite database is stored at `/data/village.db`. Use **one replica only** (multiple app processes cannot safely share SQLite database traffic via a network volume).

Set these secrets in the hosting provider's **environment variables**, never in Git or a chat message:

| Variable | Value |
|---|---|
| `ADMIN_PASSWORD` | Random secret of at least 14 characters |
| `PIN_PEPPER` | Independent random secret of at least 20 characters; changing it invalidates PINs |
| `HOST` | `0.0.0.0` |
| `DB_PATH` | `/data/village.db` (mount persistent storage at `/data`) |
| `DEV_EMAIL_OUTBOX` | `0` (never show generated PINs in a publicly accessible outbox) |
| `NODE_ENV` | `production` |
| `PUBLIC_BASE_URL` | Public `https://...` URL once provisioned |
| `PRIVACY_CONTACT` | Genuine organiser privacy contact before participant registration |
| `SMTP_EMAIL` / `SMTP_APP_PASSWORD` | Dedicated real Gmail address / Google app password once configured |

Configure your host to check `GET /healthz`. Verify `https://<generated-public-domain>/healthz` and `/api/state` before sharing the QR code. Without SMTP, registration deliberately returns 503 rather than creating unusable player accounts. Never activate `DEV_EMAIL_OUTBOX=1` on the public service. With SMTP active, send **one test PIN** and verify delivery before opening registration to 30 people. The app intentionally blocks unauthorised admin actions and uses HTTP-only session cookies.

**Deploy checklist:** GitHub connected → build with Dockerfile → one replica → persistent volume `/data` → environment secrets → HTTPS domain → SMTP delivery test → rehearsal with 30 clients → backup and recover volume → verify data deletion process with organisers. For rehearsal, avoid real participant personal data until privacy/consent wording is confirmed.

### Automated load check

`npm run load-test` simulates 30 distinct users behind the **same public IP**: simultaneous role reservations, PIN logins, polling waves, economy update, investment, grant and all five rounds. This uses a temporary local database and simulated outbox (no real emails or participant data), then cleans up. It does **not** prove external hosting or venue Wi-Fi performance; repeat a separate test against the deployed service before the workshop, only with approved synthetic accounts.

## Connectivity / Raspberry Pi 5

This build uses a persistent Node process and a local SQLite database — it **cannot run as a static Vercel site or as serverless Vercel functions with durable SQLite storage**. For a local pilot you can host it on a Pi 5 or laptop, bind `HOST=0.0.0.0`, and connect all phones to the same trusted local Wi-Fi network. Test the client-isolation setting of the venue access point in advance. Guests must be able to connect to the host. Use HTTPS with a reverse proxy for real email/PIN sign-ins; do not send participant credentials in cleartext over a shared network. For remote public deployment choose a reliable always-on host with a persistent disk, HTTPS, automatic restart, and database backups, or migrate the data layer to a managed PostgreSQL service.

If the network fails entirely, have printed activity cards and the on-site learning exercises ready. Server-side game state is persisted, so restarts do not reset the world.

## Game timing

| Round | Topic | Duration |
| --- | --- | ---: |
| 1 | Rural infrastructure, inequality, investment | 20 min |
| 2 | Information literacy and fact-checking | 20 min |
| 3 | Digital content and copyright | 20 min |
| 4 | Digital collaboration and project management | 30 min |
| 5 | Cybersecurity and privacy | 15 min |

Plus 10 minutes for registration and 5 minutes for final reflection = **120 minutes**. Host advances rounds manually; the world ticks automatically and some events fire on timed triggers. The moderator should pause the simulation for discussion or technical difficulties.

## A living village, not a scripted chart

Every 10 seconds of playing time the server calculates:

- `attractiveness` from internet, education, services and jobs;
- `youth migration` from attractiveness, public trust and budget health;
- `tax and commercial income` from population, employment and trust;
- `operating costs` from the ongoing provision of infrastructure and public services;
- `public trust drift` from services and the fiscal position;
- task progress from time, role fit and the number of tasks assigned to a person.

The resulting state is saved in the `villages` table and appended to `snapshots`. A host can issue a grant at any moment. Investments shift future income, costs and migration — not just a single displayed score. UI charts use the actual last 150 stored samples, refresh every 3.5 seconds and draw continuous SVG paths.

Pausing also pauses the countdown to the next random incident. On a server restart, an active round is restored **paused at the last saved simulation tick**, with at most ten seconds of unsaved active time discarded. Offline time does not consume village budgets. The host resumes explicitly. After **Finish simulation**, time and economic results stay fixed; grants, new rounds and resume are rejected. Starting another workshop requires the explicit event-data reset.

This is a *teaching simulation*, not an economic forecast. The parameters are intentionally simplified for short-group discussions; adjust balance after a full rehearsal.

## Privacy and safety before the event

**Mandatory preflight:** the organiser should supply a real privacy contact (`PRIVACY_CONTACT`), explain who controls registration data, what is collected, the purposes, access, data-retention period and deletion, and offer a separate optional simulated-email opt-in. Set the hosted URL, confirm that email delivery works, and explain on-screen that the QR link is part of the workshop. Account emails and participation must be kept separate from any competition scoring. Do not use real brand-lookalike domains, password prompts, click telemetry, or collection of other personal information.

The host control center includes **Erase event data**, guarded by explicit confirmation and another admin-password check. It permanently clears locally stored players, emails, session tokens, posts, metrics, event history, tasks, and development outbox, and resets village values. **It cannot delete sent-email copies in Gmail or external backups**; those must be handled separately according to the retention notice.

**Security review required before public Internet launch:** this is a fast educational prototype, not an independently audited identity system. Serve it behind an HTTPS reverse proxy, restrict direct access, configure a verified sender, use strong environmental secrets and an appropriate backup/monitoring plan. Avoid pointing a public URL at a laptop or Pi over an unsecured tunnel.

## Suggested 20–30 person workshop layout

Four village tables, 5–8 people at each. Each table elects its own mayor, finance officer, digital officer, media officer, events coordinator and community representatives. The lecturer controls round changes from their laptop, while the projector tab shows shared stats and reveal screens.

## Project files

- `server.js`: API, PIN authentication, economy, rounds and game database.
- `data.js`: village starting positions, investments, roles, editorial news, licensing examples, tickets and round metadata.
- `public/app.js`: responsive interactive player/host/projector experience and SVG chart rendering.
- `public/style.css`: design and mobile layouts.
- `tests/flow.test.js`: integration rehearsal over all five rounds, role exclusivity, privileges, state, and cleanup.
