#!/usr/bin/env bash
set -euo pipefail

# Install a separate, loopback-only preview from the audited production source.
# Run from the directory containing payload/ and source.sha256 as root.
package_dir=$(cd "$(dirname "$0")/.." && pwd)
production=/opt/jude-explorer
preview=/opt/jude-explorer-preview
service=/etc/systemd/system/jude-explorer-preview.service

if [[ $(id -u) -ne 0 ]]; then echo 'Run as root' >&2; exit 1; fi
if [[ -e $preview || -e $service ]]; then echo 'Preview installation already exists; refusing to overwrite it' >&2; exit 1; fi
if [[ ! -s $production/dereg_cache.json ]]; then
  echo 'Production dereg_cache.json is missing; starting a preview would rescan the chain' >&2
  exit 1
fi
if [[ ! -x $production/.venv/bin/gunicorn ]]; then
  echo 'Production Gunicorn environment is missing' >&2; exit 1
fi
for file in observer.py lmq.py config.py mainnet.py base58.py pysodium_shim.py local_config.py; do
  if [[ ! -f $production/$file ]]; then echo "Missing production source: $file" >&2; exit 1; fi
done
if [[ ! -S /var/lib/judecoin/judecoind.sock ]]; then
  echo 'Judecoin node socket is missing' >&2; exit 1
fi
if ss -ltn | grep -Eq '127\.0\.0\.1:5001[[:space:]]'; then
  echo 'Preview port 5001 is already in use' >&2; exit 1
fi
(cd "$production" && sha256sum -c "$package_dir/source.sha256")

mkdir -m 0750 "$preview"
cp -a "$production"/{observer.py,lmq.py,config.py,mainnet.py,base58.py,pysodium_shim.py,local_config.py,dereg_cache.json,templates,static} "$preview"/
cp -a "$package_dir/payload"/. "$preview"/
python3 -m py_compile "$preview"/{observer.py,lmq.py,mainnet.py}

cat > "$service" <<'UNIT'
[Unit]
Description=Jude .net explorer PoS review preview
After=network-online.target judecoind.service

[Service]
Type=simple
User=root
WorkingDirectory=/opt/jude-explorer-preview
Environment=MOCK_MODE=0
ExecStart=/opt/jude-explorer/.venv/bin/gunicorn -w 1 -b 127.0.0.1:5001 mainnet:app
Restart=on-failure
RestartSec=5
MemoryMax=512M
CPUQuota=35%
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=/opt/jude-explorer-preview

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl start jude-explorer-preview.service
curl --fail --silent --show-error --max-time 20 http://127.0.0.1:5001/ -o /dev/null
echo 'Preview responds on loopback port 5001. Production service and nginx were not modified.'
