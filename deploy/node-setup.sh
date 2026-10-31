#!/usr/bin/env bash
# Run by t43deploy (activate.sh) on the node before installing the units. Idempotent; also runs on rollback.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd -P)
id dlhub >/dev/null 2>&1 || useradd --system --home-dir /var/lib/dlhub --shell /usr/sbin/nologin dlhub
# Data (ReadWritePaths in 10-user.conf) stays outside the releases.
for d in data src/data storage storage/files; do
  [ -d "/opt/download-hub/$d" ] || install -d -o dlhub -g dlhub "/opt/download-hub/$d"
done
# Release = app.tar.gz (src, views, public, production node_modules built on HQ-01); unpack once.
if [ ! -d "$here/app" ]; then
  rm -rf "$here/app.tmp"
  mkdir "$here/app.tmp"
  tar -xzf "$here/app.tar.gz" -C "$here/app.tmp" --no-same-owner
  mv -T "$here/app.tmp" "$here/app"
fi
