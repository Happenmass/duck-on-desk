// Pet sounds, all decoded through one AudioContext behind a master gain
// (the mute switch). Voice banks follow the appearance like the official
// simulator; footsteps and thumps are the official CC0 sfx. The window never
// receives a user gesture, so main.cjs sets autoplayPolicy to keep the
// context running.
const VOICE_BANK = { classic: "duck1", charcoal: "duck2", purple: "duck3", blue: "duck4" };
const SFX_TAKES = { step: "abcde", thump: "abc" };
const CHIRP_TAKES = "abcdefghijkl";
const pick = (takes) => takes[(Math.random() * takes.length) | 0];

export function createAudio() {
  let ctx;
  let master;
  let muted = false;
  let bank = "duck1";
  const buffers = new Map();
  const stats = { chirp: 0, step: 0, thump: 0 };

  const context = () => {
    if (!ctx) {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 1;
      master.connect(ctx.destination);
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
  const play = (url, { gain = 1, rate = 1 } = {}) => {
    const c = context();
    return bufferFor(url).then((buffer) => {
      const source = c.createBufferSource();
      const volume = c.createGain();
      source.buffer = buffer;
      source.playbackRate.value = rate;
      volume.gain.value = gain;
      source.connect(volume).connect(master);
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
    // Sound events from the runtime: { name, gain?, rate?, on? }.
    play(sound) {
      stats[sound.name] = (stats[sound.name] ?? 0) + 1;
      switch (sound.name) {
        case "chirp":
          return play(`./assets/voices/${bank}/chirp_${pick(CHIRP_TAKES)}.wav`, { gain: 0.7 });
        case "step":
        case "thump":
          return play(`./assets/sfx/${sound.name}_${pick(SFX_TAKES[sound.name])}.wav`, sound);
        default:
          return undefined;
      }
    },
  };
}
