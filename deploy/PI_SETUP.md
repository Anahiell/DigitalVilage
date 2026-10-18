# Raspberry Pi operation

For the quick Russian procedure, use [ARRIVAL_RU.md](ARRIVAL_RU.md). These instructions target the existing `robot` checkout at `/home/robot/projects/DigitalVilage`, Node 22.13+ and the already installed Tailscale service. The code was tested locally; applying it and verifying the physical Pi remains an on-device operation.

## Updating the existing installation

Run as the normal Pi user, not root:

```bash
cd ~/projects/DigitalVilage &&
git fetch origin main &&
git show origin/main:deploy/update-pi.sh > /tmp/digital-village-update.sh &&
bash /tmp/digital-village-update.sh "$PWD"
```

The bootstrap requires a clean tracked `main` checkout and merges only fast-forward. It preserves an old untracked generated `package-lock.json` under ignored private backups if necessary. It never resets source edits or deletes saved data.

`pi-launch.sh --funnel` backs up the existing `.env` and a consistent SQLite snapshot using `VACUUM INTO` (including committed WAL content), then normalises the production configuration. It preserves valid host and PIN secrets, uses an absolute `DB_PATH`, disables rehearsal outbox, and validates sender/contact/HTTPS settings. It stages `git archive HEAD` under `runtime/releases/`, runs locked installation, integration tests and the synthetic 30-player rehearsal, then switches `runtime/current` and the systemd unit. The running app never reads a mixture of old and new release files. Tests clear inherited mail credentials and never send real emails.

The generated unit uses the actual absolute Node executable, the source checkout's `.env`, `runtime/current` as working directory, a private umask and restart-on-failure behaviour. It enables reboot autostart. If local health fails after switching, it restores the previous unit/release. Database migrations are additive; the launcher does not automatically replace the live database with a backup.

Ignored runtime locations:

- `storage/`: durable database, outside the release tree.
- `backups/`: consistent database copies and private environment copies; protect and expire these according to the organiser's retention policy.
- `runtime/releases/`: complete application versions.
- `runtime/current`: active version symlink; `runtime/previous-digital-village.service`: previous unit.

A public-route or DNS failure after healthy local startup is reported without discarding the working local release. Avoid updating during a live workshop; pause first. Restarted playing rounds stay paused until the host resumes.

## Keep the existing robot site

The recorded setup has Observatory at local port 8080 and public `https://robobrain.taild17717.ts.net` on HTTPS 443. **Do not replace or reset that Funnel.** Digital Village uses local port 3000 (or its existing configured PORT), with separate public HTTPS **8443**.

The launcher reads the current Tailscale DNS name and existing Funnel routes. It refuses an occupied 8443 route unless it already targets this app. Once the local app is healthy it runs:

```bash
sudo tailscale funnel --bg --https=8443 http://127.0.0.1:3000
```

Use the configured application port if different. Funnel must already be allowed for the tailnet; policy/HTTPS enablement can require the tailnet owner's account. With `--bg` the configuration persists through restart. Funnel supports specific HTTPS ports and its tailnet `*.ts.net` hostname, rather than an arbitrary custom DNS name. Verify outside the LAN and allow for DNS propagation. Do not use `tailscale funnel reset`, which removes other routes too.

## Optional custom hostname on the same Pi

This is optional and requires control of a real domain; no domain was purchased or DNS changed by this code update.

1. Use an existing domain whose zone is managed in your Cloudflare account. Choose an available subdomain such as `village.your-domain` or `ruralem.your-domain`.
2. Follow Cloudflare's [remote tunnel procedure](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/create-remote-tunnel/): create a named tunnel, install the Linux ARM64 connector on the Pi with the supplied account-specific command, and run it as a system service. Keep its token private.
3. Add a published hostname for the selected subdomain with service type HTTP and URL `http://127.0.0.1:3000` (use your actual PORT). Use the root application route. This tunnel creates the route without router port forwarding. The network must allow the connector's required outbound traffic, including port 7844.
4. Put the exact origin, e.g. `PUBLIC_BASE_URL=https://village.your-domain`, in the checkout's private `.env`. Run `bash deploy/pi-launch.sh --apply` to deploy using that origin without modifying Funnel settings.
5. Run `npm run doctor`, open the new URL on a phone using mobile data, and rescan the new invitation QR. Use only the chosen canonical game origin; same-origin POST checks intentionally reject a mismatched alternate address.

The application still runs on the Pi; the tunnel only carries HTTPS traffic. Power and Internet loss still stop public access. The old public game route may still exist until explicitly disabled for that port by its owner; Observatory remains separate.

## Real email

The existing dedicated Gmail settings can stay in `.env`:

```dotenv
DEV_EMAIL_OUTBOX=0
SMTP_EMAIL=your-dedicated-address
SMTP_APP_PASSWORD=your-private-google-app-password
```

These are configuration descriptions, not usable credentials. Gmail requires the owner's actual account configuration. SMTP_HOST/SMTP_PORT default to `smtp.gmail.com` / `465` and can be changed for another provider.

For optional primary HTTPS delivery, verify a real sending domain in Resend and apply the SPF/DKIM records it supplies; configure DMARC for the domain too. Then set `RESEND_API_KEY` and `EMAIL_FROM` with your actual verified address. Keep Gmail configured for a second real route. No sender domain/key was provisioned by this update. See [Resend's send API](https://resend.com/docs/api-reference/emails/send-email).

Restart after changing settings. Host → setup → **Send one delivery test** sends one explicitly requested real message. Alternatively, with your actual recipient:

```bash
node deploy/doctor.mjs --public --mail your-address
```

The encrypted `mail_jobs` table is part of the existing database and its consistent backups. It resumes pending requests after restart, uses bounded delayed retries for up to 15 minutes, and removes completed/expired payloads. Preserve `PIN_PEPPER` when moving the database: it is also the queue encryption secret. A queued registration reserves its role; a permanent failure/expiry releases an unused account. Host rescue cancels a delayed PIN replacement. HTTP 202 and a queued test are explicitly unconfirmed, and `doctor --mail` exits with attention required for that state. No provider webhook is provisioned by this update; recipient-server delivery must be checked in the provider dashboard or the actual inbox.

Ordinary `npm run doctor` never sends mail. Provider acceptance is not inbox confirmation. Check actual receipt and a registration PIN/resend before inviting the room. Gmail limits, recipient filtering and a provider outage remain possible. Host in-person enrolment and emergency PIN issuance work without mail credentials.

## Health, reboot and recovery

```bash
npm run doctor
systemctl is-enabled digital-village
systemctl is-active digital-village
journalctl -u digital-village -n 50 --no-pager
curl --fail http://127.0.0.1:3000/healthz
tailscale funnel status
```

Health must identify this application: `{"ok":true,"app":"digital-village"}`. The doctor also checks authenticated host access, the configured/running sender mode and the QR URL, without printing secrets. Reboot once before the event when you have access to restore connectivity; then verify local and external health. A lost Internet connection must not advance offline village budgets.

If the launcher restores the previous service after a failed local health check, inspect its journal before trying again. Private backups permit deliberate recovery; do not copy a database over a running writer or discard `.env`/`PIN_PEPPER`. Do not run both `npm start` and systemd against the same port/database.

The static `digital-village.service` is a legacy example with fixed paths. Prefer the generated unit: it detects the actual Node installation and coherent release directory.
