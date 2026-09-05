// Pet sounds, all decoded through one AudioContext behind a master gain
// (the mute switch) and two category buses the settings control separately:
// voice (chirps/quacks) and steps (footsteps + landing thumps). Voice banks
// follow the appearance like the official simulator; footsteps and thumps are
// the official CC0 sfx. The window never receives a user gesture, so main.cjs
// sets autoplayPolicy to keep the context running.
const VOICE_BANK = { classic: "duck1", charcoal: "duck2", purple: "duck3", blue: "duck4" };
const SFX_TAKES = { step: "abcde", thump: "abc" };
const CHIRP_TAKES = "abcdefghijkl";
const pick = (takes) => takes[(Math.random() * takes.length) | 0];

const clamp01 = (v) => Math.min(1, Math.max(0, Number(v)));
const BUS_OF = { chirp: "voice", step: "steps", thump: "steps" };

export function createAudio() {
  let ctx;
  let master;
  let muted = false;
  let bank = "duck1";
  const volumes = { voice: 1, steps: 1 };
  const buses = {};
  const buffers = new Map();
  const stats = { chirp: 0, step: 0, thump: 0 };

  const context = () => {
    if (!ctx) {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 1;
      master.connect(ctx.destination);
      for (const name of Object.keys(volumes)) {
        buses[name] = ctx.createGain();
        buses[name].gain.value = volumes[name];
        buses[name].connect(master);
      }
    }
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    return ctx;
  };
  const bufferFor = (url) => {
    if (!buffers.has(url)) {
      buffers.set(url, fetch(url).then((r) => r.arrayBuffer()).then((bytes) => context().decodeAudioData(bytes)));
    }
    return buffers.get(url);
  };
  const play = (url, bus, { gain = 1, rate = 1 } = {}) => {
    const c = context();
    return bufferFor(url).then((buffer) => {
      const source = c.createBufferSource();
      const volume = c.createGain();
      source.buffer = buffer;
      source.playbackRate.value = rate;
      volume.gain.value = gain;
      source.connect(volume).connect(buses[bus] || master);
      source.start();
    }).catch((error) => console.warn("sound failed", url, error));
  };

  return {
    stats,
    isMuted: () => muted,
    setAppearance(name) {
      bank = VOICE_BANK[name] ?? "duck1";
    },
    setMuted(value) {
      muted = !!value;
      if (master) master.gain.value = muted ? 0 : 1;
    },
    // Partial update: { voice?: 0..1, steps?: 0..1 }; unknown or non-finite
    // entries are ignored so a stale settings payload cannot silence a bus.
    setVolumes(next) {
      for (const name of Object.keys(volumes)) {
        if (!next || !Number.isFinite(Number(next[name]))) continue;
        volumes[name] = clamp01(next[name]);
        if (buses[name]) buses[name].gain.value = volumes[name];
      }
    },
    volumes: () => ({ ...volumes }),
    // Sound events from the runtime: { name, gain?, rate?, on? }.
    play(sound) {
      stats[sound.name] = (stats[sound.name] ?? 0) + 1;
      switch (sound.name) {
        case "chirp":
          return play(`./assets/voices/${bank}/chirp_${pick(CHIRP_TAKES)}.wav`, BUS_OF.chirp, { gain: 0.7 });
        case "step":
        case "thump":
          return play(`./assets/sfx/${sound.name}_${pick(SFX_TAKES[sound.name])}.wav`, BUS_OF[sound.name], sound);
        default:
          return undefined;
      }
    },
  };
}
