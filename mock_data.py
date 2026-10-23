"""Mock data for running the explorer UI without a live juded node."""

import time
import random

_now = int(time.time())

def _mock_tx_hash():
    return ''.join(random.choice('0123456789abcdef') for _ in range(64))

def _mock_pubkey():
    return ''.join(random.choice('0123456789abcdef') for _ in range(64))


def get_info():
    return {
        'height': 825770,
        'l2_height': 0,
        'difficulty': 165383156,
        'target': 180,
        'tx_count': 41288,
        'tx_pool_size': 0,
        'alt_blocks_count': 0,
        'outgoing_connections_count': 8,
        'incoming_connections_count': 12,
        'white_peerlist_size': 250,
        'grey_peerlist_size': 4800,
        'mainnet': True,
        'testnet': False,
        'stagenet': False,
        'devnet': False,
        'nettype': 'mainnet',
        'top_block_hash': _mock_tx_hash(),
        'cumulative_difficulty': 1398450000000,
        'block_size_limit': 614400,
        'block_size_median': 300,
        'block_weight_limit': 614400,
        'block_weight_median': 300,
        'database_size': 1940000000,
        'version': '3.2.0-release',
        'status': 'OK',
        'start_time': _now - 86400 * 30,
        'target_height': 0,
        'service_node': True,
    }


def get_staking_requirement():
    return {
        'staking_requirement': 23600000000000,
        'status': 'OK',
    }


def get_fee_estimate():
    return {
        'fee_per_byte': 8460,
        'fee_per_output': 4230000,
        'blink_fee_per_byte': 42300,
        'blink_fee_per_output': 21150000,
        'quantization_mask': 10000,
        'status': 'OK',
    }


def get_hard_fork_info():
    return {
        'version': 15,
        'revision': 0,
        'enabled': True,
        'earliest_height': 700000,
        'status': 'OK',
    }


def get_coinbase_tx_sum():
    return {
        'emission_amount': 18446744000000000,
        'fee_amount': 1230000000000,
        'burn_amount': 615000000000,
        'status': 'OK',
    }


def get_accrued_batched_earnings():
    return {
        'amounts': [50000000000, 30000000000, 20000000000],
    }


def _make_block(height, num_txs=1):
    ts = _now - (825770 - height) * 120
    block_hash = _mock_tx_hash()
    miner_tx_hash = _mock_tx_hash()

    txs = [{
        'tx_hash': miner_tx_hash,
        'block_height': height,
        'coinbase': True,
        'version': 4,
        'type': 0,
        'vin': [{'gen': {'height': height}}],
        'vout': [{'amount': 0, 'target': {'key': _mock_tx_hash()}} for _ in range(2)],
        'size': 214,
        'extra': {},
        'tx_extra_raw': '',
        'rct_signatures': {'txnFee': 0},
    }]

    for _ in range(num_txs):
        txs.append({
            'tx_hash': _mock_tx_hash(),
            'block_height': height,
            'version': 4,
            'type': 0,
            'vin': [{'key': {'amount': 0, 'key_offsets': [1, 2]}} for _ in range(2)],
            'vout': [{'amount': 0, 'target': {'key': _mock_tx_hash()}} for _ in range(2)],
            'size': 205,
            'fee': 8960000,
            'extra': {},
            'tx_extra_raw': '',
            'rct_signatures': {'txnFee': 8960000},
        })

    return {
        'height': height,
        'timestamp': ts,
        'hash': block_hash,
        'miner_tx_hash': miner_tx_hash,
        'block_size': 214 + 205 * num_txs,
        'block_weight': 214 + 205 * num_txs,
        'num_txes': num_txs,
        'reward': 8960000000,
        'coinbase_payouts': 8960000000,
        'txs': txs,
    }


def get_block_headers_range(start_height, end_height, **kwargs):
    blocks = []
    for h in range(start_height, end_height + 1):
        blocks.append(_make_block(h, num_txs=random.randint(0, 3)))
    return {'headers': blocks}


def _mock_address():
    return '5' + ''.join(random.choice('0123456789abcdef') for _ in range(94))


def _make_sn(active=True, funded=True, num_contributors=1, unlock_height=0):
    pubkey = _mock_pubkey()
    staking_req = 23600000000000

    if num_contributors == 1:
        contributed = staking_req if funded else random.randint(staking_req // 4, staking_req * 3 // 4)
        reserved = staking_req if funded else contributed
        addr = _mock_address()
        contributors = [{
            'amount': contributed,
            'reserved': reserved,
            'address': addr,
            'locked_contributions': [{'amount': contributed, 'key_image': _mock_tx_hash(), 'key_image_pub_key': _mock_tx_hash()}] if contributed > 0 else [],
        }]
    else:
        per_share = staking_req // num_contributors
        contributors = []
        total = 0
        for i in range(num_contributors):
            amount = staking_req - total if i == num_contributors - 1 else per_share
            total += amount
            contributors.append({
                'amount': amount,
                'reserved': amount,
                'address': _mock_address(),
                'locked_contributions': [{'amount': amount, 'key_image': _mock_tx_hash(), 'key_image_pub_key': _mock_tx_hash()}],
            })
        contributed = staking_req

    total_contributed = contributed if funded else contributors[0]['amount']
    total_reserved = staking_req if funded else total_contributed

    return {
        'service_node_pubkey': pubkey,
        'pubkey_ed25519': _mock_pubkey(),
        'requested_unlock_height': unlock_height,
        'last_reward_block_height': 825770 - random.randint(0, 100),
        'last_reward_transaction_index': 0,
        'active': active,
        'funded': funded,
        'earned_downtime_blocks': random.randint(10, 1440),
        'service_node_version': [3, 2, 0],
        'total_contributed': total_contributed,
        'total_reserved': total_reserved,
        'staking_requirement': staking_req,
        'portions_for_operator': 18446744073709551612,
        'operator_address': contributors[0]['address'],
        'last_uptime_proof': _now - random.randint(0, 3600),
        'state_height': 825770 - random.randint(0, 5000),
        'swarm_id': random.randint(0, 50),
        'contributors': contributors,
    }


def get_service_nodes(**kwargs):
    active = []
    active += [_make_sn(active=True, funded=True, num_contributors=1) for _ in range(6)]
    active += [_make_sn(active=True, funded=True, num_contributors=2) for _ in range(2)]
    active += [_make_sn(active=True, funded=True, num_contributors=3) for _ in range(1)]
    active += [_make_sn(active=True, funded=True, num_contributors=4) for _ in range(1)]

    active += [_make_sn(active=True, funded=True, unlock_height=825770 + 230)]
    active += [_make_sn(active=True, funded=True, unlock_height=825770 + 4230)]
    active += [_make_sn(active=True, funded=True, num_contributors=2, unlock_height=825770 + 8100)]

    inactive = [_make_sn(active=False, funded=True) for _ in range(2)]
    awaiting = [_make_sn(active=False, funded=False) for _ in range(2)]

    for sn in inactive:
        sn['decomm_blocks_remaining'] = max(sn['earned_downtime_blocks'], 0)
        sn['decomm_blocks'] = random.randint(1, 100)

    return {
        'service_node_states': active + inactive + awaiting,
        'status': 'OK',
    }


def get_checkpoints():
    return {
        'checkpoints': [
            {
                'height': 795200,
                'type': 'ServiceNode',
                'block_hash': _mock_tx_hash(),
                'signatures': [{'voter_index': i} for i in range(20)],
            },
            {
                'height': 753000,
                'type': 'ServiceNode',
                'block_hash': _mock_tx_hash(),
                'signatures': [{'voter_index': i} for i in range(20)],
            },
            {
                'height': 700000,
                'type': 'ServiceNode',
                'block_hash': _mock_tx_hash(),
                'signatures': [{'voter_index': i} for i in range(20)],
            },
        ],
        'status': 'OK',
    }


def get_mempool():
    return {
        'txs': [],
        'status': 'OK',
    }


def get_quorum_state():
    return {
        'quorums': [],
        'status': 'OK',
    }


MOCK_RESPONSES = {
    'rpc.get_info': get_info,
    'rpc.get_staking_requirement': get_staking_requirement,
    'rpc.get_fee_estimate': get_fee_estimate,
    'rpc.hard_fork_info': get_hard_fork_info,
    'admin.get_coinbase_tx_sum': get_coinbase_tx_sum,
    'rpc.get_accrued_batched_earnings': get_accrued_batched_earnings,
    'rpc.get_block_headers_range': get_block_headers_range,
    'rpc.get_service_nodes': get_service_nodes,
    'rpc.get_checkpoints': get_checkpoints,
    'rpc.get_transaction_pool': get_mempool,
    'rpc.get_quorum_state': get_quorum_state,
}
