"""Run with python -m unittest discover -s mcp/robot-lab/training -p test_preview.py."""
import json
import pathlib
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch
from preview import LivePreview


class Positions(list):
    def __getitem__(self, key):
        if isinstance(key, list):
            return Positions(super(Positions, self).__getitem__(i) for i in key)
        value = super().__getitem__(key)
        return Positions(value) if isinstance(key, slice) else value

    def tolist(self):
        return list(self)


class PreviewTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.control = pathlib.Path(self.tmp.name) / 'watch.json'
        self.output = pathlib.Path(self.tmp.name) / 'live.json'
        self.preview = LivePreview({'preview_control_file': str(self.control), 'preview_file': str(self.output)})
        self.env = SimpleNamespace(data=[SimpleNamespace(qpos=Positions(range(21)), time=1.2)], qadr=list(range(20, 6, -1)))

    def publish(self, now):
        with patch('preview.time.monotonic', return_value=now), patch('preview.time.time', return_value=now):
            self.preview.publish(self.env, 4, 'sampling')

    def test_opt_in_rate_limit_pose_order_and_no_mutation(self):
        self.publish(100)
        self.assertFalse(self.output.exists())
        self.control.write_text(json.dumps({'expires_at': 103000}))
        self.publish(100.5)
        snapshot = json.loads(self.output.read_text())
        self.assertEqual(snapshot['root'], list(range(7)))
        self.assertEqual(snapshot['joints'], list(range(20, 6, -1)))
        self.assertEqual(snapshot['iteration'], 4)
        self.assertEqual(self.env.data[0].qpos, list(range(21)))
        self.publish(100.55)
        self.assertEqual(self.preview.sequence, 1)
        self.publish(100.65)
        self.assertEqual(self.preview.sequence, 2)
        self.control.unlink()
        self.publish(101.2)
        self.assertEqual(self.preview.sequence, 2)

    def test_lease_expires_after_viewer_disappears(self):
        self.control.write_text(json.dumps({'expires_at': 103000}))
        self.publish(100)
        self.assertEqual(self.preview.sequence, 1)
        self.publish(104)
        self.assertEqual(self.preview.sequence, 1)

    def test_malformed_lease_and_nonfinite_pose_do_not_fail_training(self):
        self.control.write_text('[]')
        self.publish(100)
        self.assertFalse(self.output.exists())
        self.control.write_text(json.dumps({'expires_at': 103000}))
        self.env.data[0].qpos[0] = float('nan')
        self.publish(101)
        self.assertEqual(self.preview.sequence, 0)
        self.assertFalse(self.output.exists())


if __name__ == '__main__':
    unittest.main()
