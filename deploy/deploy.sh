#!/usr/bin/env bash
# Deploy HEAD to HKG-1 by hand (run on HQ-01): build + test a tarball, swap /opt/download-hub/app,
# restart, health-check; on failure the previous app comes back. Rollback later: deploy.sh rollback
set -euo pipefail
NODE=root@100.88.104.72
SSH=(ssh -i /root/rwl01.key "$NODE")
repo=$(cd "$(dirname "$0")/.." && pwd -P)

remote() { "${SSH[@]}" bash -s; }

if [ "${1:-}" = rollback ]; then
  remote <<'EOF'
set -e
cd /opt/download-hub
[ -d app.prev ] || { echo "no app.prev"; exit 1; }
mv -T app app.bad && mv -T app.prev app && mv -T app.bad app.prev
systemctl restart download-hub && echo "rolled back"
EOF
  exit 0
fi

tmp=$(mktemp -d /var/tmp/download-hub-build.XXXXXX)
trap 'rm -rf "$tmp"' EXIT
git -C "$repo" archive HEAD | tar -x -C "$tmp"
(cd "$tmp" && npm ci --no-audit --no-fund && npm test && npm prune --omit=dev --no-audit --no-fund \
  && tar -czf app.tar.gz package.json package-lock.json src views public node_modules)
scp -i /root/rwl01.key "$tmp/app.tar.gz" "$NODE:/var/tmp/download-hub-app.tar.gz"
scp -i /root/rwl01.key "$repo/deploy/download-hub.service" "$NODE:/etc/systemd/system/download-hub.service"
"${SSH[@]}" install -d /etc/systemd/system/download-hub.service.d
scp -i /root/rwl01.key "$repo/deploy/10-user.conf" "$NODE:/etc/systemd/system/download-hub.service.d/10-user.conf"

remote <<'EOF'
set -euo pipefail
id dlhub >/dev/null 2>&1 || useradd --system --home-dir /var/lib/dlhub --shell /usr/sbin/nologin dlhub
for d in data src/data storage storage/files; do
  [ -d "/opt/download-hub/$d" ] || install -d -o dlhub -g dlhub "/opt/download-hub/$d"
done
cd /opt/download-hub
rm -rf app.new && mkdir app.new
tar -xzf /var/tmp/download-hub-app.tar.gz -C app.new --no-same-owner && rm -f /var/tmp/download-hub-app.tar.gz
rm -rf app.prev; [ -d app ] && mv -T app app.prev
mv -T app.new app
systemctl daemon-reload && systemctl enable -q download-hub && systemctl restart download-hub
ok=0
for _ in $(seq 1 60); do
  if curl -fsS --max-time 3 http://127.0.0.1:3000/health | grep -q '"ok":true' \
     && curl -fsS --max-time 5 -o /dev/null http://127.0.0.1:3000/; then ok=1; break; fi
  sleep 1
done
sleep 3
if [ $ok = 1 ] && [ "$(systemctl show -P NRestarts download-hub)" = 0 ]; then echo "deploy ok"; exit 0; fi
echo "health failed, restoring app.prev" >&2
if [ -d app.prev ]; then rm -rf app && mv -T app.prev app && systemctl restart download-hub; fi
exit 1
EOF
