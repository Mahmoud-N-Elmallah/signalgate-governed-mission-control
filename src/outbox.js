import { getCanonicalAction, OUTBOX_PATH } from './core.js';

const RECORD_KEYS = new Set([
  'schemaVersion',
  'actionId',
  'incidentId',
  'target',
  'message',
  'status',
  'recordedAt',
]);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireText(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('outbox field ' + field + ' must be a non-empty string');
  }
}

function validateEntry(value, lineNumber) {
  if (!isRecord(value)) {
    throw new Error('outbox line ' + lineNumber + ' must contain a JSON object');
  }
  for (const key of Object.keys(value)) {
    if (!RECORD_KEYS.has(key)) {
      throw new Error(
        'outbox line ' + lineNumber + ' contains unknown field ' + key,
      );
    }
  }
  if (value.schemaVersion !== 1) {
    throw new Error(
      'outbox line ' + lineNumber + ' has an unsupported schema version',
    );
  }
  requireText(value.actionId, 'actionId');
  requireText(value.incidentId, 'incidentId');
  requireText(value.target, 'target');
  requireText(value.message, 'message');
  requireText(value.recordedAt, 'recordedAt');
  if (getCanonicalAction(value.actionId) === undefined) {
    throw new Error('outbox line ' + lineNumber + ' has an unknown actionId');
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.recordedAt)) {
    throw new Error('outbox line ' + lineNumber + ' has an invalid recordedAt timestamp');
  }
  const parsedTimestamp = Date.parse(value.recordedAt);
  if (Number.isNaN(parsedTimestamp) || new Date(parsedTimestamp).toISOString() !== value.recordedAt) {
    throw new Error('outbox line ' + lineNumber + ' has an invalid recordedAt timestamp');
  }
  if (value.status !== 'queued') {
    throw new Error('outbox line ' + lineNumber + ' has an unsupported status');
  }
  return {
    schemaVersion: 1,
    actionId: value.actionId,
    incidentId: value.incidentId,
    target: value.target,
    message: value.message,
    status: 'queued',
    recordedAt: value.recordedAt,
  };
}

export function parseOutbox(text) {
  if (typeof text !== 'string') {
    throw new Error('outbox content must be text');
  }
  const entries = [];
  const actionIds = new Set();
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (line.trim() === '') continue;
    const lineNumber = index + 1;
    let value;
    try {
      value = JSON.parse(line);
    } catch {
      throw new Error('outbox line ' + lineNumber + ' is not valid JSON');
    }
    const entry = validateEntry(value, lineNumber);
    if (actionIds.has(entry.actionId)) {
      throw new Error('outbox contains duplicate action ' + entry.actionId);
    }
    actionIds.add(entry.actionId);
    entries.push(entry);
  }
  return entries;
}

export function serializeOutbox(entries) {
  return entries.length === 0
    ? ''
    : entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n';
}

export async function readOutbox(ctx, signal) {
  const target = await ctx.fs.resolve(OUTBOX_PATH, {
    cwd: process.cwd(),
    signal,
  });
  const info = await ctx.fs.stat(target, signal);
  if (info === undefined) {
    return { target, exists: false, version: undefined, entries: [] };
  }
  const text = await ctx.fs.readText(target, signal);
  return {
    target,
    exists: true,
    version: info.version,
    entries: parseOutbox(text),
  };
}

export function matchesAction(entry, action) {
  return (
    entry.actionId === action.actionId &&
    entry.incidentId === action.incidentId &&
    entry.target === action.target &&
    entry.message === action.message
  );
}

function outboxRecord(action, now) {
  return {
    schemaVersion: 1,
    actionId: action.actionId,
    incidentId: action.incidentId,
    target: action.target,
    message: action.message,
    status: 'queued',
    recordedAt: now(),
  };
}

function isStaleWrite(error) {
  return error?.code === 'FS_STALE_VERSION';
}

export async function appendOutboxOnce(
  ctx,
  action,
  signal,
  now = () => new Date().toISOString(),
) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const current = await readOutbox(ctx, signal);
    const existing = current.entries.find(
      (entry) => entry.actionId === action.actionId,
    );
    if (existing !== undefined) {
      if (!matchesAction(existing, action)) {
        throw new Error('outbox action does not match the canonical action');
      }
      return {
        status: 'duplicate',
        entry: existing,
        count: current.entries.length,
      };
    }

    const entry = outboxRecord(action, now);
    try {
      const expected = current.exists
        ? { kind: 'replaceIfVersion', version: current.version }
        : { kind: 'createIfAbsent' };
      await ctx.fs.writeText(
        current.target,
        serializeOutbox([...current.entries, entry]),
        expected,
        signal,
      );
    } catch (error) {
      if (isStaleWrite(error) && attempt === 0) continue;
      if (!isStaleWrite(error)) throw error;
      throw new Error('outbox changed before publication; retry required');
    }

    const verified = await readOutbox(ctx, signal);
    const committed = verified.entries.find(
      (candidate) => candidate.actionId === action.actionId,
    );
    if (committed === undefined || !matchesAction(committed, action)) {
      throw new Error('outbox reread did not contain the expected action');
    }
    return {
      status: 'executed',
      entry: committed,
      count: verified.entries.length,
    };
  }
  throw new Error('outbox publication did not complete');
}
