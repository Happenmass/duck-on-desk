import "./styles.css";
import { createDuckRuntime } from "./runtime/duck-runtime.js";
import { AutonomyAdapter } from "./adapters/autonomy-adapter.js";
import { createAudio } from "./adapters/audio.js";
import { createBehaviours } from "./agent-visual-adapter.js";
import { connectPetBridge } from "./pet-bridge.js";

const stage = document.getElementById("stage");
const themeConfig = window.themeConfig || {};
const audio = createAudio();
audio.setMuted(themeConfig.duckMuted === true);
audio.setVolumes({ voice: themeConfig.duckVoiceVolume, steps: themeConfig.duckStepVolume });

const policyUrl = (name) => (window.electronAPI ? `pet-model://policy/${encodeURIComponent(name)}` : `/policies/${encodeURIComponent(name)}`);

try {
  const runtime = await createDuckRuntime({
    container: stage,
    policyUrl,
    onSound: (sound) => audio.play(sound),
    appearance: themeConfig.duckAppearance || "classic",
    stilts: Number(themeConfig.duckStilts) || 0,
  });
  audio.setAppearance(runtime.snapshot().appearance);
  const autonomy = new AutonomyAdapter(runtime);
  const behaviours = createBehaviours({ runtime, autonomy });
  window.__duckRuntime = runtime;
  window.__duckAudio = audio;
  if (window.electronAPI) connectPetBridge({ api: window.electronAPI, runtime, behaviours, audio });
  window.addEventListener("beforeunload", () => { behaviours.dispose(); autonomy.dispose(); runtime.dispose(); }, { once: true });
} catch (error) {
  console.error("Duck on Desk renderer failed to start", error);
}
