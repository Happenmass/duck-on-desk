import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';

export const ARTIFACTS = ['reward.py', 'strategy.py', 'training.json'];
export const hash = text => createHash('sha256').update(text).digest('hex');
export class LabError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
export class ExperimentStore {
  constructor(root) {
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    this.root = fs.realpathSync(root);
  }
  file(id) {
    if (!/^exp_[a-f0-9-]{36}$/.test(id)) throw new LabError('INVALID_ID', 'Use an experiment ID returned by lab_experiment_create.');
    const file = path.join(this.root, `${id}.json`);
    if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) throw new LabError('INVALID_PATH', 'Experiment records cannot be symbolic links.');
    return file;
  }
  create(name, files) {
    const record = { id: `exp_${randomUUID()}`, name, revision: 1, updatedAt: new Date().toISOString(), files, history: [] };
    fs.writeFileSync(this.file(record.id), JSON.stringify(record, null, 2), { flag: 'wx', mode: 0o600 });
    return this.summary(record);
  }
  read(id) {
    try { return JSON.parse(fs.readFileSync(this.file(id), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') throw new LabError('NOT_FOUND', 'Experiment does not exist.'); throw error; }
  }
  summary(record) {
    return { id: record.id, name: record.name, revision: record.revision, updatedAt: record.updatedAt,
      artifacts: Object.entries(record.files).map(([name, content]) => ({ name, sha256: hash(content), bytes: Buffer.byteLength(content) })) };
  }
  write(id, name, content, expectedRevision) {
    if (!ARTIFACTS.includes(name)) throw new LabError('INVALID_ARTIFACT', 'Only reward.py, strategy.py and training.json are writable.');
    if (Buffer.byteLength(content) > 65536) throw new LabError('CONTENT_TOO_LARGE', 'Artifact must be at most 64 KiB.');
    const file = this.file(id), lock = `${file}.lock`;
    let fd;
    try { fd = fs.openSync(lock, 'wx', 0o600); }
    catch (error) { if (error.code === 'EEXIST') throw new LabError('WRITE_BUSY', 'Another writer holds this experiment; reread before retrying.'); throw error; }
    let temporary;
    try {
      const current = this.read(id);
      if (current.revision !== expectedRevision) throw new LabError('REVISION_CONFLICT', `Expected ${expectedRevision}; current revision is ${current.revision}. Read before retrying.`);
      const history = [...current.history, { revision: current.revision, files: current.files }].slice(-10);
      const next = { ...current, revision: current.revision + 1, updatedAt: new Date().toISOString(), history, files: { ...current.files, [name]: content } };
      temporary = `${file}.${randomUUID()}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify(next, null, 2), { mode: 0o600, flag: 'wx' });
      fs.renameSync(temporary, file);
      return this.summary(next);
    } finally {
      if (temporary && fs.existsSync(temporary)) fs.unlinkSync(temporary);
      fs.closeSync(fd); fs.unlinkSync(lock);
    }
  }
}
