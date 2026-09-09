"""Optional read-only pose snapshots. A short viewer lease keeps unattended runs headless."""
import json
import os
import pathlib
import time


class LivePreview:
    def __init__(self, config):
        self.control = pathlib.Path(config['preview_control_file']) if config.get('preview_control_file') else None
        self.output = pathlib.Path(config['preview_file']) if config.get('preview_file') else None
        self.next_check = 0.0
        self.next_frame = 0.0
        self.enabled = False
        self.sequence = 0
        self.write_seconds = 0.0

    def publish(self, env, iteration, stage):
        now = time.monotonic()
        if not self.control or not self.output:
            return
        if now >= self.next_check:
            self.next_check = now + 0.5
            try:
                self.enabled = json.loads(self.control.read_text(encoding='utf-8')).get('expires_at', 0) > time.time() * 1000
            except (OSError, ValueError, TypeError, AttributeError):
                self.enabled = False
        if not self.enabled or now < self.next_frame:
            return
        self.next_frame = now + 0.1
        started = time.monotonic()
        data = env.data[0]
        frame = {'sequence': self.sequence + 1, 'captured_at': time.time() * 1000,
                 'iteration': iteration, 'stage': stage, 'environment': 0, 'simulation_time': float(data.time),
                 'root': data.qpos[:7].tolist(), 'joints': data.qpos[env.qadr].tolist()}
        temporary = self.output.with_suffix('.tmp')
        try:
            encoded = json.dumps(frame, allow_nan=False)
            with open(temporary, 'w') as stream:
                stream.write(encoded)
            os.replace(temporary, self.output)
            self.sequence += 1
        except (OSError, ValueError):
            # A slow/closed viewer or snapshot I/O failure cannot fail training.
            try:
                temporary.unlink(missing_ok=True)
            except OSError:
                pass
        self.write_seconds += time.monotonic() - started
