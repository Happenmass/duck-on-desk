export function createReachyAudio() {
  let context, gain, muted = false, volume = 1, robot = false, generation = 0;
  const buffers = new Map(), sources = new Set();
  function stop() {
    generation++;
    for (const source of sources) { try { source.stop(); } catch {} }
    sources.clear();
  }
  const audio = {
    setAppearance() {},
    setMuted(value) {
      muted = !!value;
      if (gain) gain.gain.value = muted ? 0 : volume;
      if (muted) stop();
    },
    setVolumes(values) {
      if (Number.isFinite(values?.voice)) volume = Math.max(0, Math.min(1, values.voice));
      if (gain) gain.gain.value = muted ? 0 : volume;
    },
    setRobotConnected(value) {
      robot = !!value;
      if (robot) stop();
    },
    async play(sound) {
      const name = typeof sound === "string" ? sound : sound.name;
      if (muted || !volume || !["chirp", "error", "sleep", "wake"].includes(name)) return;
      const epoch = generation;
      if (robot || epoch !== generation || muted) return;
      if (!context) {
        context = new AudioContext(); gain = context.createGain();
        gain.gain.value = muted ? 0 : volume; gain.connect(context.destination);
      }
      await context.resume();
      try {
        if (!buffers.has(name)) buffers.set(name, fetch(`./assets/reachy-mini/${name}.wav`).then(r => r.arrayBuffer()).then(b => context.decodeAudioData(b)));
        const buffer = await buffers.get(name);
        if (robot || epoch !== generation || muted) return;
        const source = context.createBufferSource(); source.buffer = buffer;
        source.connect(gain); sources.add(source);
        source.onended = () => sources.delete(source); source.start();
      } catch { buffers.delete(name); }
    },
    dispose() { stop(); void context?.close(); },
  };
  return audio;
}
