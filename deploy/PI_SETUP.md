# Raspberry Pi 5 deployment (Digital Village)

This service file assumes the Raspberry Pi account is `robot`, the checkout is at `/home/robot/projects/DigitalVilage` and Node.js 22.13+ is at `/usr/bin/node`. Confirm **every path** before enabling; if Node was installed using nvm, its absolute path will be different.

## Before starting

1. On the Pi, verify `node --version`, `command -v node`, `git --version` and `tailscale version`.
2. Checkout repository into `~/projects/DigitalVilage`, not into an existing project's directory.
3. Run `npm install --omit=dev`. Node.js 22.13+ is needed for `node:sqlite`.
4. Copy `.env.example` to `.env`. Generate two **different random secrets**, at least 14 chars for `ADMIN_PASSWORD` and 20 for `PIN_PEPPER`. Never paste secrets into chat or Git. Set `HOST=127.0.0.1`, `PORT=3000`, `NODE_ENV=production`, `DEV_EMAIL_OUTBOX=0`, `PRIVACY_CONTACT` to a real address. Set private file permissions: `chmod 600 .env`. SMTP can be added later. Registration intentionally returns HTTP 503 until SMTP is configured. Do **not** set development email outbox to 1 while public access is enabled.
5. Confirm the application works privately before opening a Funnel.

## Enable reboot auto-start with systemd

From the repository root (after verifying `whoami`, `pwd` and `command -v node` match the unit file):

```sh
sudo cp deploy/digital-village.service /etc/systemd/system/digital-village.service
sudo systemctl daemon-reload
sudo systemctl enable --now digital-village.service
systemctl status digital-village.service --no-pager
```

The `enable` operation creates an autostart symlink. `--now` also starts the service immediately. The database is persisted at `storage/village.db` in the project by default. The service restarts when the application crashes.

Diagnostics:

```sh
journalctl -u digital-village -n 50 --no-pager
curl -sS http://127.0.0.1:3000/healthz
```

Expected response to the health request: `{"ok":true}`.

## Public HTTPS: Tailscale Funnel (only after private + security checks)

With Tailscale connected and MagicDNS/HTTPS/Funnel enabled for the tailnet:

```sh
sudo tailscale funnel --bg 3000
sudo tailscale funnel status
```

Tailscale provides a genuine `https://*.ts.net` address and reverse proxies to `http://127.0.0.1:3000`. A Funnel configured with `--bg` persists through reboot and resumes when the Pi reconnects to Tailscale; no separate Funnel systemd unit is necessary. Funnel is public to **anyone with the URL** and has bandwidth limits. Only enable once `DEV_EMAIL_OUTBOX=0`, secure admin secrets, consent notice and SMTP have been checked. Set `PUBLIC_BASE_URL` to the exact HTTPS URL and restart `digital-village`. Use `sudo tailscale funnel reset` to disable all public Funnel services if needed; verify no other services use Funnel first.

## Reboot rehearsal

Before the event, reboot the Pi and verify all three:
- `systemctl is-enabled digital-village` says `enabled`
- `systemctl is-active digital-village` says `active`
- `curl http://127.0.0.1:3000/healthz` succeeds

Then check the public HTTPS address **from a phone on mobile data**, not only on the same Wi-Fi. Simulate 30 players using test accounts before collecting real attendee information.

## Important limitations
- This deployment uses your Pi's storage and home internet. If the Pi loses power or internet, public access stops; SQLite persists on disk.
- The project's SQLite timer/game ticks run only while the server is running, with no guarantee of resolving economic time during downtime in exactly the same way. Rehearse recovery.
- Gmail SMTP requires the owner's own account/app password; never put credentials in the GitHub repository.
- If an older site already occupies port 3000, change Digital Village's PORT and Funnel target **consistently**.
- The existing README also contains security/privacy preflight requirements; this project is a fast prototype, not audited production software.
