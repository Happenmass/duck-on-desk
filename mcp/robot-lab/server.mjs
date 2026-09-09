import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { ExperimentStore, ARTIFACTS, LabError } from './store.mjs';
import { templates } from './templates.mjs';
import labModule from './jobs.cjs';
const jobs = labModule.createLabJobs();

const here = path.dirname(fileURLToPath(import.meta.url));
const store = new ExperimentStore(path.join(process.env.DUCK_LAB_HOME || path.join(os.homedir(), '.duck-on-desk', 'robot-lab'), 'experiments'));
const docs = Object.fromEntries(['overview', 'scripts', 'backends'].map(id => [id, fs.readFileSync(path.join(here, 'docs', `${id}.md`), 'utf8')]));
const device = z.enum(['cpu', 'mps', 'cuda']);
const configSchema = z.object({
  schema_version: z.literal(1), mode: z.enum(['probe', 'robot']).optional(), task: z.enum(['microduck-flat-walk','microduck-headstand-hold','microduck-headstand','microduck-headstand-dance']), algorithm: z.literal('ppo'),
  training_device: device, inference_device: device, policy_initialization:z.enum(['official','random']).optional(), ppo_profile:z.enum(['legacy-v1','local-ppo-v2']).optional(),
  reset_on_pose_loss:z.boolean().optional(), hold_episode_steps:z.number().int().min(0).max(50000).optional(),
  physics_backend: z.enum(['mujoco_cpu', 'mujoco_warp_cuda']),
  seed: z.number().int().min(0).max(2147483647), max_iterations: z.number().int().min(1).max(2000),
  environments: z.number().int().min(1).max(32).optional(), rollout_steps: z.number().int().min(8).max(256).optional(),
  learning_rate: z.number().min(0.000001).max(0.01).optional(), target_speed: z.number().min(0).max(0.25).optional(),
}).strict();
function config(record) {
  try { return configSchema.parse(JSON.parse(record.files['training.json'])); }
  catch { throw new LabError('INVALID_CONFIG', 'training.json must match the schema in lab://docs/scripts.'); }
}
function worker(payload) {
  return new Promise((resolve, reject) => {
    const child = spawn(jobs.python(), [path.join(here, 'worker.py')], {
      env: { ...process.env, PYTHONUTF8:'1', PYTHONIOENCODING:'utf-8', PYTORCH_ENABLE_MPS_FALLBACK: '0' }, stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '', bytes = 0, failure;
    const stop = (code, message) => { failure ||= new LabError(code, message); child.kill('SIGKILL'); };
    const timer = setTimeout(() => stop('WORKER_TIMEOUT', 'Worker exceeded 45 seconds.'), 45000);
    child.stdout.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > 1024 * 1024) stop('OUTPUT_LIMIT', 'Worker output exceeded 1 MiB.');
      else stdout += chunk;
    });
    child.stderr.on('data', chunk => { bytes += chunk.length; if (bytes > 1024 * 1024) stop('OUTPUT_LIMIT', 'Worker output exceeded 1 MiB.'); });
    child.stdin.on('error', () => {});
    child.once('error', () => { clearTimeout(timer); reject(new LabError('PYTHON_UNAVAILABLE', 'Run lab_environment_setup first, or set DUCK_LAB_PYTHON to a Python interpreter with training dependencies installed.')); });
    child.once('close', code => {
      clearTimeout(timer);
      if (failure) return reject(failure);
      try {
        const result = JSON.parse(stdout);
        if (code !== 0 || result.ok === false) return reject(new LabError(result.code || 'WORKER_FAILED', result.message || `Requested ${payload.device} backend is unavailable; no fallback was used.`));
        resolve(result);
      } catch (error) { reject(new LabError('WORKER_FAILED', 'Worker did not return valid JSON.')); }
    });
    child.stdin.end(JSON.stringify(payload));
  });
}
const server = new McpServer({ name: 'duck-robot-lab', version: '0.2.0' });
function register(name, description, inputSchema, fn, readOnly = true, executes = false) {
  server.registerTool(name, { description, inputSchema,
    annotations: { readOnlyHint: readOnly, destructiveHint: false, openWorldHint: executes } }, async args => {
    try {
      const result = await fn(args);
      return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    } catch (error) {
      const result = { ok: false, code: error.code || 'INTERNAL_ERROR', message: error.message };
      return { isError: true, content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
  });
}
const docId = z.enum(['overview', 'scripts', 'backends']);
register('lab_docs_search', 'Search the versioned Robot Lab API and backend documentation.', { query: z.string().min(1).max(200), limit: z.number().int().min(1).max(20).default(8) }, ({ query, limit }) => {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = Object.entries(docs).flatMap(([id, content]) => content.split('\n').flatMap((line, i) =>
    terms.some(term => line.toLowerCase().includes(term)) ? [{ doc_id: id, line: i + 1, text: line }] : []));
  return { matches: matches.slice(0, limit), total: matches.length };
});
register('lab_docs_read', 'Read API documentation by ID with line pagination.', { doc_id: docId, start_line: z.number().int().min(1).default(1), limit: z.number().int().min(1).max(150).default(100) }, ({ doc_id, start_line, limit }) => {
  const lines = docs[doc_id].split('\n');
  return { doc_id, total_lines: lines.length, start_line, text: lines.slice(start_line - 1, start_line - 1 + limit).join('\n') };
});
for (const [id, text] of Object.entries(docs)) {
  server.registerResource(id, `lab://docs/${id}`, { mimeType: 'text/markdown', description: `Robot Lab ${id}` }, async uri => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text }] }));
}
register('lab_environment_setup', 'Download pinned model assets and install an isolated Python/PyTorch environment for selected devices. Returns immediately; poll lab_environment_status. Does not start training or modify system/custom Python. Downloads from Hugging Face, GitHub, PyPI and PyTorch.', {training_device:device,inference_device:device,pythonPath:z.string().max(4096).optional()}, input=>jobs.setup(input), false, true);
register('lab_environment_status', 'Read environment setup progress, readiness or retryable failure.', {}, ()=>jobs.environment());
register('lab_backends_inspect', 'Inspect actual local PyTorch devices. This does not run user scripts or start robot training.', {}, () => worker({ operation: 'inspect' }));
register('lab_experiment_create', 'Create a versioned draft. mode=robot uses real MuJoCo PPO reward/network templates; probe is a synthetic device check. Does not execute code.', { name: z.string().min(1).max(120), mode: z.enum(['probe','robot']).default('probe'), task:z.enum(['microduck-flat-walk','microduck-headstand-hold','microduck-headstand','microduck-headstand-dance']).default('microduck-flat-walk') }, ({ name, mode, task }) => {
  if (mode === 'probe') { if(task!=='microduck-flat-walk')throw new LabError('WRONG_MODE','Action training requires mode=robot.');return store.create(name, templates); }
  const d = task==='microduck-headstand-hold'?jobs.holdDefaults():task==='microduck-headstand'?jobs.headstandDefaults():task==='microduck-headstand-dance'?jobs.actionDefaults():jobs.defaults();
  return store.create(name, {'reward.py':d.reward,'strategy.py':d.strategy,'training.json':JSON.stringify({schema_version:1,mode:'robot',task,algorithm:'ppo',physics_backend:'mujoco_cpu',training_device:d.training_device,inference_device:d.inference_device,policy_initialization:d.policy_initialization,ppo_profile:d.ppo_profile,reset_on_pose_loss:d.reset_on_pose_loss,hold_episode_steps:d.hold_episode_steps,max_iterations:d.iterations,environments:d.environments,rollout_steps:d.rollout_steps,learning_rate:d.learning_rate,target_speed:d.target_speed,seed:d.seed},null,2)});
}, false);
register('lab_experiment_read', 'Read the current experiment revision and optionally one artifact.', { experiment_id: z.string(), artifact: z.enum(ARTIFACTS).optional() }, ({ experiment_id, artifact }) => {
  const record = store.read(experiment_id);
  return { ...store.summary(record), ...(artifact ? { artifact, content: record.files[artifact] } : {}) };
});
register('lab_experiment_write', 'Save reward.py, strategy.py or training.json using expected_revision. Draft writes do not execute code.', {
  experiment_id: z.string(), artifact: z.enum(ARTIFACTS), content: z.string().max(65536), expected_revision: z.number().int().positive(),
}, ({ experiment_id, artifact, content, expected_revision }) => store.write(experiment_id, artifact, content, expected_revision), false);
register('lab_experiment_validate', 'Validate configuration and Python syntax/signatures without executing user scripts. Not a physics or runtime correctness check.', { experiment_id: z.string() }, async ({ experiment_id }) => {
  const record = store.read(experiment_id); const settings = config(record);
  return { ...await worker({ operation: 'validate', files: record.files, robot: settings.mode === 'robot' }), revision: record.revision, robot_training_validated: false };
});
register('lab_backend_probe', 'EXECUTES the saved Python scripts with local user privileges in a child process, not a sandbox. Runs three synthetic gradient steps and inference on the requested device. No robot physics, PPO training, export, or pet activation. No CPU fallback.', {
  experiment_id: z.string(), expected_revision: z.number().int().positive(), device,
}, async ({ experiment_id, expected_revision, device }) => {
  const record = store.read(experiment_id);
  if (record.revision !== expected_revision) throw new LabError('REVISION_CONFLICT', 'Reread the experiment before executing a changed revision.');
  const settings = config(record);
  if (settings.mode === 'robot') throw new LabError('WRONG_MODE', 'Use lab_training_start for a robot draft.');
  return { ...await worker({ operation: 'probe', files: record.files, device, seed: settings.seed }), experiment_id, revision: record.revision, artifacts: store.summary(record).artifacts };
}, false, true);
register('lab_training_defaults', 'Read real robot PPO settings and editable reward/network templates.', {task:z.enum(['microduck-flat-walk','microduck-headstand-hold','microduck-headstand','microduck-headstand-dance']).default('microduck-flat-walk')}, ({task}) => task==='microduck-headstand-hold'?jobs.holdDefaults():task==='microduck-headstand'?jobs.headstandDefaults():task==='microduck-headstand-dance'?jobs.actionDefaults():jobs.defaults());
register('lab_training_start', 'EXECUTES this exact saved robot draft with local user privileges, not a sandbox. Starts bounded real MuJoCo CPU rollouts with PyTorch MPS/CUDA/CPU training and evaluation, checkpoint and ONNX export. No cloud jobs or device fallback.', {
  experiment_id: z.string(), expected_revision: z.number().int().positive(),
}, async ({experiment_id, expected_revision}) => {
  const record = store.read(experiment_id);
  if (record.revision !== expected_revision) throw new LabError('REVISION_CONFLICT', 'Reread the draft before running a changed revision.');
  const settings = config(record);
  if (settings.mode !== 'robot' || settings.physics_backend !== 'mujoco_cpu') throw new LabError('WRONG_MODE', 'Real training requires mode=robot and physics_backend=mujoco_cpu.');
  const {max_iterations, mode, schema_version, task, algorithm, physics_backend, ...options} = settings;
  const job = jobs.start({...options,hold_episode_steps:options.hold_episode_steps??400,reset_on_pose_loss:options.reset_on_pose_loss??true,ppo_profile:options.ppo_profile||'legacy-v1',policy_initialization:options.policy_initialization||'official',task,iterations:max_iterations,reward:record.files['reward.py'],strategy:record.files['strategy.py'],source:{experiment_id,revision:record.revision}});
  return {...job,experiment_id,revision:record.revision};
}, false, true);
register('lab_training_resume', 'Continue a stopped/completed compatible-network run from its saved PPO checkpoint in a new run. Restores actor, critic and optimizer; preserves the original reward, settings and exploration schedule. additional_iterations adds to saved progress. Executes the original trusted scripts locally.', {
  run_id:z.string(), additional_iterations:z.number().int().min(1).max(2000),
}, ({run_id,additional_iterations}) => jobs.resume(run_id,{additional_iterations}), false, true);
register('lab_training_list', 'List recent real training jobs shared with the Robot Lab window.', {}, () => ({jobs:jobs.list()}));
register('lab_training_get', 'Read real rollout progress, evaluation, export manifest and failures.', {run_id:z.string()}, ({run_id}) => jobs.get(run_id));
register('lab_training_cancel', 'Request cancellation of a real training job at the next rollout boundary.', {run_id:z.string()}, ({run_id}) => jobs.cancel(run_id), false);
register('lab_policy_artifact', 'Get a completed policy/manifest or a stopped/completed resumable checkpoint path in the user model cache. ONNX hash is verified. Applying requires browser physics evaluation in Robot Lab.', {run_id:z.string(),kind:z.enum(['policy.onnx','manifest.json','checkpoint.pt','preview.json']).default('policy.onnx')}, ({run_id,kind}) => ({path:jobs.artifact(run_id,kind)}));
register('lab_actions_list', 'List trained actions admitted by native and browser action evaluation. Built-in peck is always available on ordinary feet.', {}, () => ({builtin:[{id:'peck',name:'啄地'}],trained:jobs.actions()}));
server.server.onclose = () => jobs.dispose();
await server.connect(new StdioServerTransport());
