# Automatic free Pages address

This optional Linux service keeps `https://digitvillage-play.pages.dev/` in front of the existing Raspberry Pi game. At boot it waits for the local game, starts the already installed cloudflared, checks the new Quick Tunnel and publishes an isolated gateway using the official Cloudflare Wrangler package. No game files, database, SMTP configuration or Tailscale routes are uploaded or changed. `PUBLIC_BASE_URL` must already be the Pages address, as on the current Pi, so QR codes and email links remain stable.

## One-time setup

Create a custom Cloudflare API token with **Account / Cloudflare Pages / Edit**, limited to the account containing this project. Cloudflare's permission scope is account-wide Pages access, not a project-only restriction. Do not grant DNS, billing or account administration. Keep the token private; revoking or expiring it prevents automatic publication. This implementation uses the existing free project; it creates no paid resources.

From the repository root on the Pi run `bash deploy/auto-domain/install.sh`. It asks for the token with hidden input. The secret is stored separately as root-only `runtime/domain-automation/cloudflare.env`; systemd supplies it to the service. No secret appears in process arguments or ordinary logs. The installer backs up the existing game database/configuration before installing. It does not restart the game or change an active session.

The account ID defaults to the existing deployment account; another installation can set `DV_CF_ACCOUNT_ID`. The project is intentionally fixed to `digitvillage-play`. The publisher uploads only a generated gateway, route manifest and robots.txt from a dedicated directory. A stale dashboard PI_ORIGIN cannot override its verified destination.

The installer says READY only after the public endpoint responds as Digital Village and exposes the marker for an automated gateway. Only then does it stop the old `digital-village-test-tunnel` service. Leave the Pi powered on during setup. After READY, check the existing QR on mobile data; schedule the reboot test outside active play. A restarted active game intentionally recovers paused and needs the host's Resume game action.

## Operation and recovery

`systemctl status digital-village-domain --no-pager` shows service status. `sudo journalctl -u digital-village-domain -n 20 --no-pager` shows safe progress messages. The game has its own existing `digital-village` service. Normal network interruptions reconnect the same tunnel without a new publication. A stuck tunnel is recycled after ten minutes of failed checks while the local game is healthy. Failed publications retry no faster than every five minutes, with a persisted limit of ten attempts per UTC day to avoid deployment storms. Daily limits failing closed need operator investigation.

To disable only this automation: `sudo systemctl disable --now digital-village-domain`. This does not remove game data or credentials and does not restore a previous backend. To replace a revoked token, stop this service and use `sudoedit runtime/domain-automation/cloudflare.env`, then restart it. Never show this file in chat or commit it.

This automates a **free rehearsal route**, not guaranteed production hosting. Cloudflare Quick Tunnels have no uptime guarantee and do not support SSE. Free Pages/Workers quotas still apply; the fixed hostname cannot make the Pi accessible while powered off or offline. See [Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/) and [Pages limits](https://developers.cloudflare.com/pages/platform/limits/). A personal paid domain is not required for this option.
