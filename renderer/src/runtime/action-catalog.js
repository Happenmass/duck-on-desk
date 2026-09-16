// Which action entries the runtime will play, and on what command block.
//
// Two sources, deliberately kept apart:
//
//   duck-lab-action-v1  actions trained on this machine. Admitted by the lab,
//                       which fixes their duration (8 s, or 5 s for the official
//                       roulade recipe).
//   microduck-policy-v1 policies downloaded from the action market. They carry
//                       their own declared duration, and only the zero-command
//                       kind is accepted: every other kind uses the 13 command
//                       slots for meanings this app cannot supply, and feeding
//                       the wrong ones produces an unpredictable motion rather
//                       than an error (see src/market/manifest.js).
const LAB_ID = /^run_[a-f0-9-]{36}$/;
const MARKET_ID = /^mkt_[A-Za-z0-9._~-]{1,200}@[a-f0-9]{12}$/;
const MAX_DURATION_S = 60;

function isLabAction(entry) {
  if (!LAB_ID.test(entry.id) || entry.contract !== 'duck-lab-action-v1') return false;
  if (entry.duration === 8) return true;
  return entry.duration === 5 && entry.task === 'microduck-roulade'
    && entry.policy_observations === 'official-zero-commands-v1';
}

function isMarketAction(entry) {
  return MARKET_ID.test(entry.id) && entry.contract === 'microduck-policy-v1'
    && entry.commandMode === 'zero-commands'
    && Number.isFinite(entry.duration) && entry.duration > 0 && entry.duration <= MAX_DURATION_S;
}

export function normalizeActionCatalog(actions) {
  return (Array.isArray(actions) ? actions : [])
    .filter((entry) => entry && typeof entry.url === 'string' && (isLabAction(entry) || isMarketAction(entry)))
    .map((entry) => ({
      ...entry,
      market: isMarketAction(entry),
      // Both the official roulade recipe and every market action are driven with
      // an all-zero command block for the whole clip.
      officialObservations: entry.policy_observations === 'official-zero-commands-v1'
        || entry.commandMode === 'zero-commands',
    }));
}

export { LAB_ID, MARKET_ID, MAX_DURATION_S };
