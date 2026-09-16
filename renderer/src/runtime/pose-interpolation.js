export function poseTweenProgress(now, startedAt, durationMs) {
  if (!Number.isFinite(now) || !Number.isFinite(startedAt) || !Number.isFinite(durationMs) || durationMs <= 0) return 1;
  return Math.min(1, Math.max(0, (now - startedAt) / durationMs));
}

export function frameBlend(deltaMs, responseMs = 35) {
  if (!Number.isFinite(deltaMs) || deltaMs <= 0) return 0;
  if (!Number.isFinite(responseMs) || responseMs <= 0) return 1;
  return 1 - Math.exp(-deltaMs / responseMs);
}
