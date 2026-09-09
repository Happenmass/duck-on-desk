// One control-clock lifecycle for menu actions and the walking repertoire.
// Move leases remain live underneath it; finishing never restores a stale command.
export class ActionSequence {
  constructor(action) { this.action = action; this.phase = 'settling'; this.elapsed = 0; this.stable = 0; }
  advance(dt, standing) {
    this.elapsed += dt;
    if (this.phase === 'playing') {
      if (this.elapsed + 1e-6 >= this.action.duration) { this.phase = 'returning'; this.elapsed = 0; this.stable = 0; }
    } else {
      this.stable = standing ? this.stable + dt : 0;
      if (this.elapsed >= 0.6 && this.stable >= 0.4) {
        this.phase = this.phase === 'settling' ? 'playing' : 'done'; this.elapsed = 0; this.stable = 0;
      } else if (this.elapsed >= 4) this.phase = 'failed';
    }
    return this.phase;
  }
}
