import os
import unittest

os.environ['MOCK_MODE'] = '1'

from deregistered_nodes import _resolve


class DeregistrationCountTests(unittest.TestCase):
    def setUp(self):
        self.index = {
            'registrations': {'a': 100, 'b': 120},
            'stakes': [
                {'keyImage': 'x', 'publicKey': 'a'},
                {'keyImage': 'y', 'publicKey': 'a'},
                {'keyImage': 'z', 'publicKey': 'b'},
            ],
        }

    def test_deduplicates_stakes_and_excludes_unlocked_nodes(self):
        locks = [{'key_image': key, 'unlock_height': 500}
                 for key in ('x', 'y', 'z')]
        self.assertEqual(_resolve(self.index, locks, 499), 2)
        self.assertEqual(_resolve(self.index, locks, 500), 0)

    def test_unknown_active_stake_does_not_produce_false_count(self):
        locks = [{'key_image': 'unknown', 'unlock_height': 500}]
        self.assertIsNone(_resolve(self.index, locks, 499))
        self.assertEqual(_resolve(self.index, locks, 500), 0)


if __name__ == '__main__':
    unittest.main()
