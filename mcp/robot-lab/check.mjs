// Installation check: only initialize/list tools; never import user scripts.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 12)) throw new Error('Node.js 22.12+ required');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'duck-mcp-check-'));
const client = new Client({ name: 'duck-install-check', version: '1.0.0' });
try {
  await client.connect(new StdioClientTransport({ command: process.execPath,
    args: [fileURLToPath(new URL('./server.mjs', import.meta.url))],
    env: { ...process.env, DUCK_LAB_HOME: home }, stderr: 'pipe' }));
  const result = await client.listTools();
  if (!result.tools.some(tool => tool.name === 'lab_docs_search')) throw new Error('Robot Lab tools missing');
  console.log(JSON.stringify({ ok: true, tools: result.tools.length }));
} finally {
  await client.close();
  fs.rmSync(home, { recursive: true, force: true });
}
