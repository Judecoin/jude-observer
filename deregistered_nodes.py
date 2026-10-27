"""Count deregistered service nodes whose stakes remain locked on chain."""

import json
import os
import threading
import time

from lmq import FutureJSON, MOCK_MODE


SEED = os.path.join(os.path.dirname(__file__), 'stake_index_seed.json')
STATE = os.environ.get('JUDE_STAKE_INDEX_STATE', '/var/tmp/jude-observer-stake-index.json')
_lock = threading.Lock()
_last = 0
_snapshot = None
_index = None


def _rpc(omq, connection, method, args=None):
    value = FutureJSON(omq, connection, 'rpc.' + method, None, args=args or {}, timeout=30).get()
    if not isinstance(value, dict):
        raise ValueError('Missing chain response: ' + method)
    return value


def _load():
    with open(SEED) as source:
        seed = json.load(source)
    try:
        with open(STATE) as source:
            saved = json.load(source)
        if (saved.get('version') == seed['version'] and
                saved.get('scannedThrough', 0) >= seed['scannedThrough'] and
                isinstance(saved.get('stakes'), list) and isinstance(saved.get('registrations'), dict)):
            return saved
    except (OSError, ValueError, TypeError):
        pass
    return seed


def _save(index):
    temporary = STATE + '.' + str(os.getpid()) + '.tmp'
    try:
        with open(temporary, 'w') as output:
            json.dump(index, output)
        os.replace(temporary, STATE)
    except OSError:
        try:
            os.unlink(temporary)
        except OSError:
            pass


def _advance(index, omq, connection, end):
    start = index['scannedThrough'] + 1
    if start > end:
        return index
    headers = _rpc(omq, connection, 'get_block_headers_range', {
        'start_height': start, 'end_height': end, 'get_tx_hashes': True,
    }).get('headers')
    if not isinstance(headers, list) or len(headers) != end - start + 1:
        raise ValueError('Incomplete block headers')
    hashes = []
    for height, header in enumerate(headers, start):
        txs = header.get('tx_hashes', [])
        if header.get('height') != height or not isinstance(txs, list) or len(txs) != header.get('num_txes'):
            raise ValueError('Incomplete block transactions')
        hashes.extend(txs)
    stakes = {entry['keyImage']: entry['publicKey'] for entry in index['stakes']}
    registrations = dict(index['registrations'])
    for offset in range(0, len(hashes), 100):
        batch = hashes[offset:offset + 100]
        txs = _rpc(omq, connection, 'get_transactions', {
            'txs_hashes': batch, 'decode_as_json': True, 'tx_extra': True,
            'stake_info': True, 'prune': True,
        }).get('txs')
        if not isinstance(txs, list):
            raise ValueError('Missing transactions')
        by_hash = {tx.get('tx_hash'): tx for tx in txs}
        for tx_hash in batch:
            tx = by_hash.get(tx_hash)
            if not tx or tx.get('in_pool') or not start <= tx.get('block_height', -1) <= end:
                raise ValueError('Incomplete decoded transactions')
            extra = tx.get('extra')
            if not isinstance(extra, dict):
                raise ValueError('Missing transaction extra')
            pubkey = extra.get('sn_pubkey')
            if pubkey:
                if extra.get('sn_registration'):
                    registrations[pubkey] = tx['block_height']
                for key_image in extra.get('locked_key_images', []):
                    stakes[key_image] = pubkey
    return dict(index, scannedThrough=end, scannedHash=headers[-1]['hash'],
                stakes=[{'keyImage': key, 'publicKey': value} for key, value in stakes.items()],
                registrations=registrations)


def _resolve(index, blacklist, height):
    mapping = {entry['keyImage']: entry['publicKey'] for entry in index['stakes']}
    nodes = set()
    missing = 0
    for entry in blacklist:
        if not isinstance(entry, dict) or not isinstance(entry.get('unlock_height'), int):
            raise ValueError('Invalid chain blacklist entry')
        unlock_height = entry['unlock_height']
        if unlock_height <= height:
            continue
        pubkey = mapping.get(entry['key_image'])
        if pubkey and pubkey in index['registrations']:
            nodes.add(pubkey)
        else:
            missing += 1
    return len(nodes) if not missing else None


def current_locked_count(omq, connection, height):
    """Return verified count, or None while indexing / if RPC is unavailable."""
    global _index, _last, _snapshot
    if MOCK_MODE:
        return None
    with _lock:
        if time.monotonic() - _last < 30:
            return _snapshot
        try:
            if _index is None:
                _index = _load()
            if _index['scannedThrough'] > height:
                with open(SEED) as source:
                    _index = json.load(source)
            if _index['scannedThrough'] > height:
                return None
            if _index.get('scannedHash'):
                check = _rpc(omq, connection, 'get_block_headers_range', {
                    'start_height': _index['scannedThrough'],
                    'end_height': _index['scannedThrough'],
                }).get('headers', [])
                if len(check) != 1 or check[0].get('hash') != _index['scannedHash']:
                    with open(SEED) as source:
                        _index = json.load(source)
            response = _rpc(omq, connection, 'get_service_node_blacklisted_key_images')
            blacklist = response.get('blacklist')
            if not isinstance(blacklist, list):
                raise ValueError('Missing chain blacklist')
            result = _resolve(_index, blacklist, height)
            # Only scan while the live blacklist contains unmapped key images.
            if result is None and _index['scannedThrough'] < height:
                end = min(height, _index['scannedThrough'] + 200)
                _index = _advance(_index, omq, connection, end)
                _save(_index)
                result = _resolve(_index, blacklist, height)
            _snapshot = result
            _last = time.monotonic() if result is not None else time.monotonic() - 25
            return result
        except (KeyError, TypeError, ValueError, OSError, RuntimeError):
            _snapshot = None
            _last = time.monotonic() - 25
            return None
