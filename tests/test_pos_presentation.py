import os
import subprocess
import sys
import unittest
from unittest.mock import patch

os.environ['MOCK_MODE'] = '1'

import mock_data
from observer import app


class PosPresentationTests(unittest.TestCase):
    def setUp(self):
        app.testing = True
        self.client = app.test_client()

    def test_real_chain_mode_is_default(self):
        env = os.environ.copy()
        env.pop('MOCK_MODE', None)
        code = "import sys, types; sys.modules['oxenmq'] = types.ModuleType('oxenmq'); import lmq; print(lmq.MOCK_MODE)"
        result = subprocess.run([sys.executable, '-c', code], env=env, capture_output=True, text=True, check=True)
        self.assertEqual(result.stdout.strip(), 'False')

    def test_pos_overview_and_statistics_do_not_call_difficulty_hashrate(self):
        with patch.dict(mock_data.MOCK_RESPONSES, {'rpc.hard_fork_info': lambda: {'version': 17, 'revision': 0}}):
            for path in ('/', '/statistics'):
                with self.subTest(path=path):
                    response = self.client.get(path)
                    self.assertEqual(response.status_code, 200)
                    html = response.get_data(as_text=True)
                    self.assertNotIn('Hash Rate', html)
                    self.assertNotIn('Difficulty', html)
                    self.assertIn('Staking', html)

    def test_historical_pow_metrics_still_visible(self):
        with patch.dict(mock_data.MOCK_RESPONSES, {'rpc.hard_fork_info': lambda: {'version': 15, 'revision': 0}}):
            self.assertIn('Hash Rate', self.client.get('/').get_data(as_text=True))

    def test_pos_reward_uses_block_reward_name(self):
        with app.test_request_context('/block/1'):
            from flask import render_template
            header = {'height': 1, 'hash': 'a' * 64, 'major_version': 17, 'minor_version': 17,
                      'timestamp': 1792733088, 'block_size': 154, 'block_weight': 154,
                      'reward': 8960000000, 'nonce': 0}
            tx = {'tx_hash': 'b' * 64, 'vout': [{'amount': 8960000000}], 'size': 154, 'version': 3,
                  'extra': {}}
            html = render_template('block.html', info={'height': 2}, block_header=header,
                                   block={'info': {'pulse': {'round': 0}}}, miner_tx=tx,
                                   transactions=[], details_html=None)
            self.assertIn('Block Reward Transaction', html)
            self.assertNotIn('Miner Reward Transaction', html)


if __name__ == '__main__':
    unittest.main()
