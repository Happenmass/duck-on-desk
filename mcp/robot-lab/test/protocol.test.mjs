import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

test('MCP protocol: docs, versioned writes, invalid drafts, CPU and available GPU execution', { timeout: 180000 }, async () => {
  const { stdout } = await promisify(execFile)(process.execPath, [fileURLToPath(new URL('../first-round.mjs', import.meta.url))], { env: process.env, timeout: 170000, maxBuffer: 1024 * 1024 });
  const report = JSON.parse(stdout);
  assert.equal(report.ok, true);
  assert.equal(report.tool_count, 14);
  assert.ok(report.call_count >= 20);
});
