// Steps and landings are real servo takes, not the old footfall samples: this
// pins the thing that breaks silently -- a take referenced by the adapter but
// missing from the shipped assets plays nothing, with only a console warning.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SERVO_DIR = path.join(__dirname, "..", "renderer", "public", "assets", "servo");
const audioModule = () => import("../renderer/src/adapters/audio.js");

function stubAudio() {
  const fetched = [];
  const param = (value = 0) => ({ value, setValueAtTime() {}, linearRampToValueAtTime() {} });
  const node = (kind, extra = {}) => ({ kind, out: null, connect(target) { this.out = target; return target; }, ...extra });
  class Ctx {
    constructor() { this.currentTime = 0; this.sampleRate = 48000; this.state = "running"; this.destination = node("destination"); }
    resume() { return Promise.resolve(); }
    createGain() { return node("gain", { gain: param(1) }); }
    createBufferSource() { return node("source", { buffer: null, playbackRate: param(1), start() {} }); }
    decodeAudioData() { return Promise.resolve({ decoded: true }); }
  }
  globalThis.AudioContext = Ctx;
  globalThis.fetch = (url) => {
    fetched.push(url);
    return Promise.resolve({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) });
  };
  return fetched;
}

const reaches = (n, target) => {
  for (let hop = n, i = 0; hop && i < 8; hop = hop.out, i++) if (hop === target) return true;
  return false;
};

test("every servo take the adapter can pick is actually shipped", async () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "renderer", "src", "adapters", "audio.js"), "utf8");
  const takes = /SERVO_TAKES = \{ step: "(\w+)", thump: "(\w+)" \}/.exec(source);
  assert.ok(takes, "SERVO_TAKES should stay a literal the test can read");
  for (const [name, letters] of [["step", takes[1]], ["thump", takes[2]]]) {
    for (const letter of letters) {
      const file = path.join(SERVO_DIR, `${name}_${letter}.wav`);
      assert.ok(fs.existsSync(file), `${file} is referenced but missing`);
      assert.ok(fs.statSync(file).size > 1024, `${file} is too small to be a take`);
    }
  }
});

test("a step plays a servo take on the steps bus at the requested gain and rate", async () => {
  const fetched = stubAudio();
  const { createAudio } = await audioModule();
  const audio = createAudio();
  audio.setVolumes({ voice: 1, steps: 0.5 });

  await audio.play({ name: "step", gain: 0.2, rate: 1.1 });
  assert.match(fetched[0], /^\.\/assets\/servo\/step_[a-e]\.wav$/);

  await audio.play({ name: "thump", gain: 0.3, rate: 0.6 });
  assert.match(fetched[1], /^\.\/assets\/servo\/thump_[a-c]\.wav$/);
  assert.equal(audio.stats.step, 1);
  assert.equal(audio.stats.thump, 1);
});

test("the take is routed through the steps bus, not straight to the master", async () => {
  stubAudio();
  const { createAudio } = await audioModule();
  const audio = createAudio();
  audio.setVolumes({ voice: 1, steps: 0.25 });
  let source = null;
  const realCreate = globalThis.AudioContext.prototype.createBufferSource;
  globalThis.AudioContext.prototype.createBufferSource = function () { source = realCreate.call(this); return source; };

  await audio.play({ name: "step", gain: 0.2, rate: 1.1 });
  globalThis.AudioContext.prototype.createBufferSource = realCreate;

  assert.equal(source.playbackRate.value, 1.1, "rate reaches the source");
  const stepsBus = [source.out, source.out?.out].find((n) => n && n.gain?.value === 0.25);
  assert.ok(stepsBus, "the take must pass through the steps bus");
  assert.equal(source.out.gain.value, 0.2, "per-hit gain sits before the bus");
  assert.ok(reaches(source, stepsBus));
});
