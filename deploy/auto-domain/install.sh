#!/usr/bin/env bash
set -euo pipefail
umask 077
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
APP_ROOT="$(cd "$SOURCE_DIR/../.." && pwd -P)"
TARGET="$APP_ROOT/runtime/domain-automation"
ACCOUNT="${DV_CF_ACCOUNT_ID:-e5e31d76294d0c5c8e26e2daa7327c0f}"
PROJECT="digitvillage-play"
if [[ $(id -u) -eq 0 ]]; then echo 'Run as the normal game owner, not root.'; exit 1; fi
for tool in node npm sudo systemctl systemd-analyze curl; do command -v "$tool" >/dev/null; done
[[ -x /usr/local/bin/cloudflared ]] || { echo 'The existing cloudflared executable is missing.'; exit 1; }
[[ "$ACCOUNT" =~ ^[a-f0-9]{32}$ ]] || { echo 'Invalid Cloudflare account ID.'; exit 1; }
node -e 'if(Number(process.versions.node.split(".")[0])<22)process.exit(1)'
node --test "$APP_ROOT/tests/auto-domain.test.js"
curl -fsS --max-time 10 http://127.0.0.1:3000/healthz | node -e 'let s="";process.stdin.on("data",x=>s+=x).on("end",()=>{const j=JSON.parse(s);if(j.ok!==true||j.app!=="digital-village")process.exit(1)})'
node "$APP_ROOT/deploy/backup.mjs"
sudo -v
mkdir -p "$TARGET"
chmod 700 "$TARGET"
install -m 600 "$SOURCE_DIR/controller.mjs" "$TARGET/controller.mjs"
install -m 600 "$SOURCE_DIR/gateway.js" "$TARGET/gateway.js"
# Only the isolated publisher dependency is installed; the game is untouched.
npm install --prefix "$TARGET" --save-exact wrangler@4.151.0 --no-audit --no-fund
if ! sudo test -s "$TARGET/cloudflare.env"; then
 echo 'Paste a Cloudflare API token with Account / Cloudflare Pages / Edit for this account only.'
 echo 'Input is hidden. Do not paste the token into chat.'
 read -r -s -p 'Cloudflare token: ' CF_TOKEN
 printf '\n'
 [[ "$CF_TOKEN" =~ ^[A-Za-z0-9_-]{20,}$ ]] || { unset CF_TOKEN; echo 'Unexpected token format; nothing started.'; exit 1; }
 # The secret goes through stdin, never command arguments or shell history.
 printf 'CLOUDFLARE_API_TOKEN=%s\nCLOUDFLARE_ACCOUNT_ID=%s\nDV_PAGES_PROJECT=%s\n' "$CF_TOKEN" "$ACCOUNT" "$PROJECT" | sudo install -o root -g root -m 600 /dev/stdin "$TARGET/cloudflare.env"
 unset CF_TOKEN
fi
APP_USER="$(id -un)"
NODE_BIN="$(command -v node)"
export DV_DOMAIN_TARGET="$TARGET" DV_DOMAIN_NODE="$NODE_BIN" DV_DOMAIN_USER="$APP_USER"
node --input-type=module <<'NODE'
import {writeFileSync} from 'node:fs';
const {DV_DOMAIN_TARGET:target,DV_DOMAIN_NODE:node,DV_DOMAIN_USER:user}=process.env;
for(const x of [target,node,user])if(/[\n\r%]/.test(x))throw Error('Unsupported service path.');
const quote=x=>'"'+x.replaceAll('\\','\\\\').replaceAll('"','\\"')+'"';
writeFileSync(target+'/digital-village-domain.service',`[Unit]
Description=Digital Village fixed free domain and persistent tunnel
Wants=network-online.target
After=network-online.target digital-village.service
StartLimitIntervalSec=0

[Service]
Type=simple
User=${user}
WorkingDirectory=${target}
EnvironmentFile=${target}/cloudflare.env
ExecStart=${quote(node)} ${quote(target+'/controller.mjs')}
Restart=on-failure
RestartSec=20
TimeoutStopSec=20
KillMode=control-group
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full

[Install]
WantedBy=multi-user.target
`);
NODE
systemd-analyze verify "$TARGET/digital-village-domain.service"
sudo install -m 644 "$TARGET/digital-village-domain.service" /etc/systemd/system/digital-village-domain.service
sudo systemctl daemon-reload
sudo systemctl enable digital-village-domain.service
sudo systemctl restart digital-village-domain.service
echo 'Automation enabled at boot. Waiting for the fixed public domain (up to five minutes).'
for attempt in {1..60}; do
 if curl -fsS --max-time 8 -D "$TARGET/public-headers" "https://$PROJECT.pages.dev/healthz" -o "$TARGET/public-health.json" && node --input-type=module - "$TARGET" <<'NODE'
import {readFileSync} from 'node:fs';
const dir=process.argv[2];try{const h=readFileSync(dir+'/public-headers','utf8'),j=JSON.parse(readFileSync(dir+'/public-health.json'));if(!j.ok||j.app!=='digital-village'||!/^x-digital-village-tunnel: https:\/\/[a-z0-9-]+\.trycloudflare\.com\s*$/im.test(h))process.exit(1);}catch{process.exit(1)}
NODE
 then
  # Retire only the old temporary game tunnel, after the fixed domain works.
  sudo systemctl stop digital-village-test-tunnel.service 2>/dev/null || true
  echo "READY: https://$PROJECT.pages.dev/ — unchanged URL and QR; automatic after reboot."
  echo 'Game database, SMTP, PUBLIC_BASE_URL and Tailscale Funnel were not changed.'
  exit 0
 fi
 sleep 5
done
echo 'Automation is installed but public verification has not passed yet. Do not reboot to test until READY.'
sudo journalctl -u digital-village-domain.service -n 15 --no-pager
exit 1
