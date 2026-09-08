import "./styles.css";
import { createDuckRuntime } from "./runtime/duck-runtime.js";
import { AutonomyAdapter } from "./adapters/autonomy-adapter.js";
import { createAudio } from "./adapters/audio.js";
import { createBehaviours } from "./agent-visual-adapter.js";
import { connectPetBridge } from "./pet-bridge.js";
import { createReachyRuntime } from "./runtime/reachy-runtime.js";
import { createReachyAudio } from "./adapters/reachy-audio.js";

const stage = document.getElementById("stage");
// additionalArguments are a launch-time snapshot; query current prefs on every
// reload so switching robots (and switching back) never restores stale values.
const api = window.electronAPI;
// A rejected invoke must not kill the whole renderer: fall back to the snapshot.
const runtimeConfig = await api?.getPetRuntimeConfig?.()?.catch((error) => {
  console.warn("Pet runtime config unavailable; using launch snapshot", error);
  return null;
});
const themeConfig = { ...(window.themeConfig || {}), ...runtimeConfig };
const reachy = themeConfig.petRobot === "reachy-mini" || (!api && new URLSearchParams(location.search).get("robot") === "reachy-mini");
const audio = reachy ? createReachyAudio() : createAudio();
api?.onPetRobotChange?.(() => location.reload());
audio.setMuted(themeConfig.duckMuted === true);
audio.setVolumes({ voice: themeConfig.duckVoiceVolume, steps: themeConfig.duckStepVolume });

const policyUrl = (name) => (window.electronAPI ? `pet-model://policy/${encodeURIComponent(name)}` : `/policies/${encodeURIComponent(name)}`);

try {
  const runtime = reachy ? await createReachyRuntime({ container: stage, api, audio }) : await createDuckRuntime({
    container: stage,
    policyUrl,
    onSound: (sound) => audio.play(sound),
    appearance: themeConfig.duckAppearance || "classic",
    stilts: Number(themeConfig.duckStilts) || 0,
    locomotion: themeConfig.duckLocomotion || "legs",
  });
  if (!reachy) {
    const applyLab = url => runtime.setLabPolicy(url);
    if (themeConfig.labPolicyUrl) await applyLab(themeConfig.labPolicyUrl).catch(error => console.error("Lab policy rejected", error));
    api?.onDuckWalkPolicyChange?.(url => applyLab(url).catch(error => console.error("Lab policy rejected", error)));
  }
  audio.setAppearance(runtime.snapshot().appearance);
  if (reachy && !api) runtime.applyVisual(new URLSearchParams(location.search).get("state") || "duck-idle");
  const autonomy = reachy ? { dispose() {} } : new AutonomyAdapter(runtime);
  let reachyVisual = "duck-idle";
  const behaviours = reachy ? {
    apply: file => { reachyVisual = file; runtime.applyVisual(file); },
    eye: (dx, dy) => runtime.eye(dx, dy),
    current: () => reachyVisual, dispose() {},
  } : createBehaviours({ runtime, autonomy });
  window.__duckRuntime = runtime;
  window.__duckAudio = audio;
  const bridge = api ? connectPetBridge({ api, runtime, behaviours, audio }) : null;
  if (reachy) api?.onReachyLocalSound?.((name) => { void audio.play(name); });
  window.addEventListener("beforeunload", () => { bridge?.dispose(); behaviours.dispose(); autonomy.dispose(); runtime.dispose(); audio.dispose?.(); }, { once: true });
} catch (error) {
  console.error("Duck on Desk renderer failed to start", error);
}
