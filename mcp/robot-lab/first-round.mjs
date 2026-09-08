import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'duck-lab-mcp-'));
const client = new Client({ name: 'coding-agent-first-round', version: '1.0.0' });
const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(here, 'server.mjs')],
  env: { ...process.env, DUCK_LAB_HOME: home }, stderr: 'pipe' });
const report = { timestamp: new Date().toISOString(), transport: 'MCP stdio / official SDK client', calls: [], cuda_status: 'pending_hardware_verification', robot_training_status: 'tested_separately_by_training_round'  };
async function call(name, args = {}, expectedError) {
  const result = await client.callTool({ name, arguments: args });
  const data = result.structuredContent || JSON.parse(result.content[0].text);
  report.calls.push({ tool: name, isError: Boolean(result.isError), result: data });
  if (expectedError) { assert.equal(result.isError, true); assert.equal(data.code, expectedError); }
  else assert.ok(!result.isError, JSON.stringify(data));
  return data;
}
try {
  await client.connect(transport);
  const tools = await client.listTools();
  assert.equal(tools.tools.length, 14);
  report.tools = tools.tools.map(t => t.name);
  const resources = await client.listResources();
  assert.equal(resources.resources.length, 3);
  const resource = await client.readResource({ uri: 'lab://docs/scripts' });
  assert.match(resource.contents[0].text, /reward\(observation/);
  const search = await call('lab_docs_search', { query: 'MPS', limit: 3 });
  assert.ok(search.matches.length > 0 && search.matches.length <= 3);
  await call('lab_docs_read', { doc_id: 'scripts', start_line: 1, limit: 100 });
  const capabilities = await call('lab_backends_inspect');
  let draft = await call('lab_experiment_create', { name: 'Coding Agent first round: script and device contract' });
  const id = draft.id;
  await call('lab_experiment_read', { experiment_id: id, artifact: 'reward.py' });
  // Authored through MCP, rather than invoking internal store/worker functions.
  const reward = 'def reward(observation, action, next_observation):\n    """Synthetic feature penalty, not a robot locomotion reward."""\n    return -0.03 * action.square().sum(dim=-1) - 0.1 * next_observation[:, 2].square()\n';
  draft = await call('lab_experiment_write', { experiment_id: id, artifact: 'reward.py', content: reward, expected_revision: draft.revision });
  await call('lab_experiment_write', { experiment_id: id, artifact: 'reward.py', content: reward, expected_revision: 1 }, 'REVISION_CONFLICT');
  const strategy = 'import torch\n\ndef build_policy(observation_dim, action_dim):\n    return torch.nn.Sequential(torch.nn.Linear(observation_dim, 32), torch.nn.Tanh(), torch.nn.Linear(32, action_dim), torch.nn.Tanh())\n';
  draft = await call('lab_experiment_write', { experiment_id: id, artifact: 'strategy.py', content: strategy, expected_revision: draft.revision });
  const settings = { schema_version: 1, task: 'microduck-flat-walk', algorithm: 'ppo', training_device: 'mps', inference_device: 'mps', physics_backend: 'mujoco_cpu', seed: 42, max_iterations: 10 };
  draft = await call('lab_experiment_write', { experiment_id: id, artifact: 'training.json', content: JSON.stringify(settings), expected_revision: draft.revision });
  await call('lab_experiment_validate', { experiment_id: id });
  await call('lab_experiment_read', { experiment_id: '../outside' }, 'INVALID_ID');
  await call('lab_backend_probe', { experiment_id: id, expected_revision: 1, device: 'cpu' }, 'REVISION_CONFLICT');
  for (const device of ['cpu', 'mps', 'cuda']) {
    if (capabilities.model_devices[device]) {
      const probe = await call('lab_backend_probe', { experiment_id: id, expected_revision: draft.revision, device });
      assert.equal(probe.parameter_device, device);
      assert.equal(probe.inference_device, device);
      assert.ok(probe.parameter_l1_change > 0);
      assert.equal(probe.robot_environment_steps, 0);
      if (device === 'cuda') report.cuda_status = 'synthetic_probe_passed_not_robot_training';
    } else {
      await call('lab_backend_probe', { experiment_id: id, expected_revision: draft.revision, device }, 'BACKEND_UNAVAILABLE');
    }
  }
  // Both semantic config validation and Python parsing failures are real tool results.
  draft = await call('lab_experiment_write', { experiment_id: id, artifact: 'training.json', content: '{}', expected_revision: draft.revision });
  await call('lab_experiment_validate', { experiment_id: id }, 'INVALID_CONFIG');
  draft = await call('lab_experiment_write', { experiment_id: id, artifact: 'training.json', content: JSON.stringify(settings), expected_revision: draft.revision });
  draft = await call('lab_experiment_write', { experiment_id: id, artifact: 'reward.py', content: 'def broken(', expected_revision: draft.revision });
  await call('lab_experiment_validate', { experiment_id: id }, 'SCRIPT_OR_BACKEND_ERROR');
  draft = await call('lab_experiment_write', { experiment_id: id, artifact: 'reward.py', content: 'def reward(observation, action, next_observation):\n    return action\n', expected_revision: draft.revision });
  await call('lab_experiment_validate', { experiment_id: id });
  await call('lab_backend_probe', { experiment_id: id, expected_revision: draft.revision, device: 'cpu' }, 'SCRIPT_OR_BACKEND_ERROR');
  draft = await call('lab_experiment_write', { experiment_id: id, artifact: 'reward.py', content: reward, expected_revision: draft.revision });
  await call('lab_experiment_validate', { experiment_id: id });
  report.ok = true;
} finally {
  await client.close();
  // No model weights or user configuration changes are left by the test.
  fs.rmSync(home, { recursive: true, force: true });
}
if (process.env.DUCK_LAB_REPORT) {
  fs.mkdirSync(path.dirname(process.env.DUCK_LAB_REPORT), { recursive: true });
  fs.writeFileSync(process.env.DUCK_LAB_REPORT, JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify({ ok: report.ok, tool_count: report.tools.length, call_count: report.calls.length,
  probes: report.calls.filter(c => c.tool === 'lab_backend_probe').map(c => c.result), cuda_status: report.cuda_status }, null, 2));
