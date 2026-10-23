#!/usr/bin/env bash
set -euo pipefail

# Deploy only audited .net explorer files; never restart the chain daemon.
package_dir=$(cd "$(dirname "$0")/.." && pwd)
production=/opt/jude-explorer
preview=/opt/jude-explorer-preview
backup_dir=/opt/jude-explorer-backups
service=jude-explorer.service
files=(observer.py lmq.py templates/index.html templates/statistics.html templates/block.html
       templates/include/sn_active.html templates/include/sn_awaiting.html templates/include/sn_inactive.html)

[[ $(id -u) -eq 0 ]] || { echo 'Run as root' >&2; exit 1; }
[[ -d $production && -d $preview ]] || { echo 'Explorer source missing' >&2; exit 1; }
[[ -S /var/lib/judecoin/judecoind.sock ]] || { echo 'Chain RPC socket missing' >&2; exit 1; }
systemctl is-active --quiet "$service" || { echo 'Production service is not active' >&2; exit 1; }
systemctl is-active --quiet jude-explorer-preview.service || { echo 'Preview service is not active' >&2; exit 1; }

# Abort if production changed since its source was captured for this upgrade.
(cd "$production" && sha256sum -c "$package_dir/source.sha256" >/dev/null) || {
  echo 'Production source differs from the audited baseline; no changes made' >&2; exit 1;
}
for file in "${files[@]}"; do
  [[ -f $package_dir/payload/$file && -f $production/$file ]] || { echo "Missing $file" >&2; exit 1; }
done
python3 -m py_compile "$package_dir/payload/observer.py" "$package_dir/payload/lmq.py"

# All verification calls are local to the server and read the same chain node.
check_site() {
  local port=$1
  PORT="$port" python3 - <<'PY'
import json, os, urllib.request
port = os.environ['PORT']
base = 'http://127.0.0.1:' + port
def get(path):
    with urllib.request.urlopen(base + path, timeout=30) as response:
        return response.read().decode('utf-8')
info = json.loads(get('/api/networkinfo'))['data']
assert info['current_hf_version'] >= 17, 'Chain does not report v17+'
for path in ('/', '/statistics'):
    html = get(path)
    assert 'Proof of Stake (Pulse)' in html, path + ': PoS label missing'
    assert 'Hash Rate' not in html and 'Difficulty' not in html, path + ': current PoW stats shown'
assert 'VERSION' in get('/service_nodes'), 'Node versions missing'
if port == '5000':
    latest = get('/block/latest')
    assert '⛏ Mined' not in latest and 'Miner Reward Transaction' not in latest, 'Latest block labelled PoW'
print('port', port, 'height', info['height'], 'HF', info['current_hf_version'], 'hash', info.get('top_block_hash', ''))
PY
}

check_site 5001
mkdir -p "$backup_dir"
backup="$backup_dir/net-before-pos-$(date -u +%Y%m%dT%H%M%SZ).tar.gz"
tar -C "$production" -czf "$backup" "${files[@]}"
echo "Saved rollback files: $backup"

applied=false
rollback() {
  if [[ $applied == true ]]; then
    echo 'Verification failed; restoring production files' >&2
    tar -C "$production" -xzf "$backup"
    systemctl restart "$service"
    curl -fsS --max-time 30 http://127.0.0.1:5000/ -o /dev/null || true
  fi
}
trap rollback ERR INT TERM
applied=true
for file in "${files[@]}"; do
  install -m 0644 "$package_dir/payload/$file" "$production/$file"
done
python3 -m py_compile "$production/observer.py" "$production/lmq.py"
systemctl restart "$service"
for attempt in {1..20}; do
  if curl -fsS --max-time 10 http://127.0.0.1:5000/api/networkinfo -o /dev/null; then break; fi
  sleep 1
done
check_site 5000
python3 - <<'PY'
import json, urllib.request
def info(port):
    with urllib.request.urlopen('http://127.0.0.1:%d/api/networkinfo' % port, timeout=30) as response:
        return json.load(response)['data']
production, preview = info(5000), info(5001)
assert abs(production['height'] - preview['height']) <= 3, 'Production and preview heights differ'
if production['height'] == preview['height']:
    assert production.get('top_block_hash') == preview.get('top_block_hash'), 'Chain tip hashes differ'
PY
applied=false
trap - ERR INT TERM
echo 'Production .net browser updated; preview and chain node unchanged.'
