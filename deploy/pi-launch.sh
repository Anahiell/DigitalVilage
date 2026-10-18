#!/usr/bin/env bash
# Prepare a coherent release; the running service never reads half-updated assets.
set -euo pipefail
APP_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$APP_ROOT"
MODE="${1:---check}"
if [[ "$MODE" == --check ]]; then exec node deploy/doctor.mjs --public; fi
if [[ "$MODE" != --apply && "$MODE" != --funnel ]]; then
  printf '%s\n' 'Usage: bash deploy/pi-launch.sh --check | --apply | --funnel'
  exit 2
fi
if [[ "$(id -u)" == 0 ]]; then printf '%s\n' 'Run this as the regular Pi account. The script uses sudo only for system services.'; exit 1; fi
for app_command in node npm git curl systemctl; do command -v "$app_command" >/dev/null || { printf 'Missing command: %s\n' "$app_command"; exit 1; }; done
if ! git diff --quiet || ! git diff --cached --quiet; then printf '%s\n' 'Commit or stash local source edits before creating a release.'; exit 1; fi
APP_PORT="$(node deploy/pi-config.mjs --port)"
if [[ -f .env ]]; then node deploy/backup.mjs; fi
if [[ "$MODE" == --funnel ]]; then
  command -v tailscale >/dev/null || { printf '%s\n' 'Tailscale is not installed.'; exit 1; }
  APP_DNS="$(tailscale status --json | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{const j=JSON.parse(s);if(j.BackendState!=="Running"||!j.Self?.DNSName)process.exit(1);process.stdout.write(j.Self.DNSName.replace(/\.$/,""));})')"
  APP_HTTPS_PORT=8443
  # Read existing routes first; never replace an Observatory or another service.
  tailscale funnel status --json | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{const j=JSON.parse(s||"{}"),port=process.argv[1],target="http://127.0.0.1:"+process.argv[2];if(j.TCP?.[port]?.TCPForward){console.error("Public port is already used by TCP forwarding.");process.exit(1);}for(const [host,web] of Object.entries(j.Web||{})){if(host.endsWith(":"+port)){for(const handler of Object.values(web.Handlers||{})){if(handler.Proxy!==target){console.error("Public port "+port+" is already used by another service. No route was changed.");process.exit(1);}}}}});' "$APP_HTTPS_PORT" "$APP_PORT"
  node deploy/pi-config.mjs --configure --url "https://$APP_DNS:$APP_HTTPS_PORT"
else
  node deploy/pi-config.mjs --configure
fi
APP_REVISION="$(git rev-parse HEAD)"
APP_RELEASE="$APP_ROOT/runtime/releases/$APP_REVISION-$(date -u +%Y%m%dT%H%M%SZ)-$$"
mkdir -p "$APP_RELEASE"
git archive HEAD | tar -x -C "$APP_RELEASE"
(cd "$APP_RELEASE" && npm ci --omit=dev --no-audit --no-fund && npm test && npm run load-test)
node deploy/pi-config.mjs --unit --user "$(id -un)"
APP_PREVIOUS="$(readlink "$APP_ROOT/runtime/current" || true)"
APP_OLD_UNIT="$APP_ROOT/runtime/previous-digital-village.service"
if [[ -f /etc/systemd/system/digital-village.service ]]; then sudo cp /etc/systemd/system/digital-village.service "$APP_OLD_UNIT"; fi
APP_SWITCHED=0
rollback(){
  if [[ "$APP_SWITCHED" == 1 ]]; then
    printf '%s\n' 'New service failed its local health check. Restoring the previous service configuration.'
    if [[ -n "$APP_PREVIOUS" ]]; then ln -sfn "$APP_PREVIOUS" "$APP_ROOT/runtime/current"; fi
    if [[ -f "$APP_OLD_UNIT" ]]; then sudo cp "$APP_OLD_UNIT" /etc/systemd/system/digital-village.service; sudo systemctl daemon-reload; sudo systemctl restart digital-village; fi
  fi
}
trap rollback ERR
ln -sfn "$APP_RELEASE" "$APP_ROOT/runtime/current"
APP_SWITCHED=1
sudo install -m 644 "$APP_ROOT/runtime/digital-village.service" /etc/systemd/system/digital-village.service
sudo systemctl daemon-reload
sudo systemctl enable digital-village
sudo systemctl restart digital-village
APP_HEALTHY=0
for attempt in {1..20}; do
  if curl --fail --silent "http://127.0.0.1:$APP_PORT/healthz" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{try{const j=JSON.parse(s);process.exit(j.ok&&j.app==="digital-village"?0:1);}catch{process.exit(1);}})'; then APP_HEALTHY=1; break; fi
  sleep 1
done
[[ "$APP_HEALTHY" == 1 ]]
APP_SWITCHED=0
trap - ERR
if [[ "$MODE" == --funnel ]]; then sudo tailscale funnel --bg --https="$APP_HTTPS_PORT" "http://127.0.0.1:$APP_PORT"; fi
printf '%s\n' 'The application is running. An interrupted game stays paused until the host resumes it.'
node deploy/doctor.mjs --public
