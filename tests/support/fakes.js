export function createFakeContext({
  outboxText = null,
  approvalOutcome = 'allowed-once',
  staleWrites = 0,
} = {}) {
  let exists = outboxText !== null;
  let text = exists ? outboxText : '';
  let version = 1;
  const registeredTools = [];
  const approvalCalls = [];
  const writes = [];
  const sections = [];
  let remainingStaleWrites = staleWrites;

  const fs = {
    async resolve(path) {
      return { path };
    },
    async stat() {
      return exists ? { version: 'v' + version } : undefined;
    },
    async readText() {
      if (!exists) {
        const error = new Error('not found');
        error.code = 'FS_NOT_FOUND';
        throw error;
      }
      return text;
    },
    async writeText(_target, nextText, expected) {
      writes.push({ nextText, expected });
      if (remainingStaleWrites > 0) {
        remainingStaleWrites -= 1;
        const error = new Error('stale');
        error.code = 'FS_STALE_VERSION';
        throw error;
      }
      if (expected.kind === 'createIfAbsent' && exists) {
        const error = new Error('already exists');
        error.code = 'FS_NOT_OBSERVED';
        throw error;
      }
      if (
        expected.kind === 'replaceIfVersion' &&
        (!exists || expected.version !== 'v' + version)
      ) {
        const error = new Error('stale');
        error.code = 'FS_STALE_VERSION';
        throw error;
      }
      exists = true;
      text = nextText;
      version += 1;
      return { operation: 'update', version: 'v' + version, before: '', after: text };
    },
  };

  const ctx = {
    fs,
    approval: {
      async request(request) {
        approvalCalls.push(request);
        return typeof approvalOutcome === 'function'
          ? approvalOutcome(request)
          : approvalOutcome;
      },
    },
    systemPrompt: {
      section(section) {
        sections.push(section);
      },
    },
    tools: {
      register(tool) {
        registeredTools.push(tool);
        return () => undefined;
      },
    },
  };

  return {
    ctx,
    registeredTools,
    approvalCalls,
    writes,
    sections,
    getOutbox() {
      return exists ? text : null;
    },
  };
}

export function tool(namedTools, name) {
  const found = namedTools.find((candidate) => candidate.name === name);
  if (found === undefined) throw new Error('test tool not registered: ' + name);
  return found;
}

export function execution(agent = {}) {
  return {
    agent,
    callId: 'call-001',
    signal: new AbortController().signal,
  };
}
