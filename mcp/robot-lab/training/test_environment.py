"""Real MuJoCo checks for reward state, including the straight-walking reference."""
import pathlib
import unittest
import mujoco
import numpy as np
from environment import Environments


class RewardStateTest(unittest.TestCase):
    def test_heading_and_yaw_rate_have_physical_units_and_batch_shape(self):
        assets = pathlib.Path(__file__).resolve().parents[3] / 'renderer/public/robot/mjlab'
        env = Environments(assets, 2)
        env.data[0].qpos[3:7] = [np.cos(np.pi / 8), 0, 0, np.sin(np.pi / 8)]
        env.data[0].qvel[:] = 0
        env.data[0].qvel[5] = .2
        mujoco.mj_forward(env.model, env.data[0])
        state = env.state()
        np.testing.assert_allclose(state['heading_error'], [np.pi / 4, 0], atol=1e-6)
        self.assertAlmostEqual(float(state['yaw_rate'][0]), .2, places=5)
        for value in state.values():
            self.assertEqual(value.shape, (2,))
            self.assertEqual(value.dtype, np.float32)
            self.assertTrue(np.isfinite(value).all())
        # Reward-only additions must not change the public policy observation contract.
        self.assertEqual(env.observe().shape, (2, 61))


if __name__ == '__main__':
    unittest.main()
