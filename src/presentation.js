function textBlock(text) {
  return [{ type: 'text', text }];
}

function evidenceLines(evidence = []) {
  return evidence.map(
    (step) => '- ' + step.stage + ': ' + step.status + ' — ' + step.detail,
  );
}

function stateLabel(status) {
  return String(status ?? 'unknown').toUpperCase().replaceAll('-', ' ');
}

function securityMark(decision) {
  return decision === 'allow' ? 'CLEAR' : 'BLOCKED';
}

function fallbackSignal(result) {
  const incident = result.incident ?? {};
  return {
    signalId: incident.incidentId ?? 'unknown',
    domain: 'unified-factory-operations',
    capability: 'factory-orchestration',
    workflow: 'bottleneck-detection-and-human-escalation',
    affectedProcess: 'production-flow',
    operationalObjective: 'Protect throughput and downstream dispatch continuity',
    operation: incident.operation ?? 'Unknown factory operation',
    observedCondition: incident.observedDelay ?? 'No condition supplied',
    impact: incident.impact ?? 'Impact not established',
    severity: incident.severity ?? 'unknown',
    evidence: (incident.evidence ?? []).map((observation) => ({
      source: 'synthetic-fixture',
      observation,
    })),
    uncertainty: incident.uncertainty ?? 'Uncertainty not supplied',
    recommendedResponse: 'Review the bounded synthetic factory response.',
    proposedActionId: result.proposedAction?.actionId ?? 'unknown',
    policyState: result.policy?.status ?? 'blocked',
  };
}

function fallbackSecurity(result) {
  return (
    result.security ?? {
      decision: 'deny',
      trust: 'invalid-input',
      policyVersion: 'security-gate-v1',
      actionBinding: 'mismatched',
      findings: [
        {
          code: 'MISSING_SECURITY_RESULT',
          severity: 'blocking',
          summary: 'The security result was not supplied.',
        },
      ],
      evidence: [
        {
          stage: 'outcome',
          status: 'blocked',
          detail: 'The view cannot claim a clear security state without structured evidence.',
        },
      ],
    }
  );
}

export function formatSecurity(result) {
  return [
    '### SIGNALGATE / SECURITY GATE · ' + securityMark(result.decision),
    '',
    '**Decision:** ' + stateLabel(result.decision),
    '**Trust:** ' + stateLabel(result.trust),
    '**Policy:** ' + result.policyVersion,
    '**Action binding:** ' + stateLabel(result.actionBinding),
    '',
    '**Findings**',
    ...((result.findings ?? []).length === 0
      ? ['- none reported']
      : result.findings.map(
          (item) => '- ' + item.code + ' · ' + item.severity + ' — ' + item.summary,
        )),
    '',
    '**Evidence**',
    ...evidenceLines(result.evidence),
  ].join('\n');
}

export function formatFactory(result) {
  const status = result.status ?? 'ready';
  return [
    '### SIGNALGATE / FACTORY OPERATIONS · ' + stateLabel(status),
    '',
    '**Signal:** ' + result.signalId,
    '**Domain:** ' + result.domain,
    '**Capability:** ' + result.capability,
    '**Workflow:** ' + result.workflow,
    '**Affected process:** ' + result.affectedProcess,
    '**Operational objective:** ' + result.operationalObjective,
    '**Operation:** ' + result.operation,
    '**Severity:** ' + result.severity,
    '**Observed condition:** ' + result.observedCondition,
    '**Impact:** ' + result.impact,
    '**Uncertainty:** ' + result.uncertainty,
    '**Request trust:** ' + stateLabel(result.operatorContext?.trust),
    '',
    '**Recommended response**',
    result.recommendedResponse,
    '',
    '**Action binding:** ' + result.proposedActionId,
    '**Policy:** ' + result.policyState,
    '',
    '**Synthetic evidence**',
    ...(result.evidence ?? []).map(
      (item) => '- ' + item.source + ' — ' + item.observation,
    ),
  ].join('\n');
}

export function formatPlan(result) {
  const signal = result.factorySignal ?? fallbackSignal(result);
  const security = fallbackSecurity(result);
  const action = result.proposedAction ?? {
    actionId: signal.proposedActionId ?? 'not available',
    target: 'not available',
    sideEffect: 'not available',
    message: 'No governed action was supplied.',
  };
  const policy = result.policy ?? {
    status: 'blocked',
    reason: 'The plan did not provide a policy decision.',
  };
  const blocked = result.status !== 'ready' || security.decision !== 'allow';
  return [
    '### SIGNALGATE / FACTORY MISSION · ' + stateLabel(result.status),
    '',
    '**Mission:** ' + action.actionId,
    '**Assessment ticket:** ' + (result.assessmentId ?? 'not-issued'),
    '**Capability:** ' + signal.capability,
    '**Workflow:** ' + signal.workflow,
    '**Factory operation:** ' + signal.operation,
    '**Signal:** ' + signal.signalId + ' · severity ' + signal.severity,
    '**Observed condition:** ' + signal.observedCondition,
    '**Impact:** ' + signal.impact,
    '**Uncertainty:** ' + signal.uncertainty,
    '',
    '**Security gate · ' + securityMark(security.decision) + '**',
    '- Decision: ' + stateLabel(security.decision),
    '- Trust: ' + stateLabel(security.trust),
    '- Policy: ' + security.policyVersion,
    '- Findings: ' + (security.findings ?? []).length,
    '',
    '**Governed action**',
    '- Target: ' + action.target,
    '- Action ID: ' + action.actionId,
    '- Side effect: ' + action.sideEffect,
    '- Message: ' + action.message,
    '',
    '**Policy:** ' + policy.status + ' — ' + policy.reason,
    '**Outbox:** ' +
      (blocked
        ? 'unchanged; no write was attempted'
        : 'unchanged; no write was attempted (approval required)'),
    '',
    '**Evidence**',
    ...evidenceLines(result.evidence),
  ].join('\n');
}

export function formatExecution(result) {
  const signal = result.factorySignal;
  const security = result.security;
  return [
    '### SIGNALGATE / FACTORY MISSION · ' + stateLabel(result.status),
    '',
    '**Action ID:** ' + result.actionId,
    '**Factory signal:** ' + (signal?.signalId ?? 'not available'),
    '**Capability:** ' + (signal?.capability ?? 'not available'),
    '**Operation:** ' + (signal?.operation ?? 'not available'),
    '**Security gate:** ' + securityMark(security?.decision ?? 'deny'),
    '**Target:** ' + result.target,
    '**Message:** ' + result.message,
    '**Side effect:** ' + result.sideEffect,
    '**Approval:** ' + result.approval.status + ' — ' + result.approval.detail,
    '**Outbox:** ' + result.outboxPath,
    '**Verified record count:** ' + result.outboxCount,
    '',
    '**Evidence**',
    ...evidenceLines(result.evidence),
  ].join('\n');
}

export function securityCall(args) {
  return {
    card: 'generic',
    title: 'Security gate · inspect request',
    kind: 'other',
    rawInput: args.request,
  };
}

export function securityResult(_args, result) {
  if (result.isError) {
    return { card: 'generic', title: 'Security gate · ERROR', content: result.content };
  }
  const decision = result.meta?.decision;
  return {
    card: 'generic',
    title: 'Security gate · ' + stateLabel(decision ?? 'completed'),
    content: result.content,
  };
}

export function factoryCall(args) {
  return {
    card: 'generic',
    title: 'Factory operations · synthetic signal',
    kind: 'other',
    rawInput: args.operator_request,
  };
}

export function factoryResult(_args, result) {
  if (result.isError) {
    return { card: 'generic', title: 'Factory operations · ERROR', content: result.content };
  }
  const status = result.meta?.status;
  return {
    card: 'generic',
    title: 'Factory operations · ' + stateLabel(status ?? 'completed'),
    content: result.content,
  };
}

export function planCall(args) {
  return {
    card: 'generic',
    title: 'Factory mission · prepare governed response',
    kind: 'other',
    rawInput: args.operator_request,
  };
}

export function planResult(_args, result) {
  if (result.isError) {
    return { card: 'generic', title: 'Factory mission · ERROR', content: result.content };
  }
  const status = result.meta?.status;
  return {
    card: 'generic',
    title: 'Factory mission · ' + stateLabel(status ?? 'completed'),
    content: result.content,
  };
}

export function executeCall(args) {
  return {
    card: 'generic',
    title: 'Factory mission · execute exact action',
    kind: 'other',
    rawInput: args.action_id,
  };
}

export function executeResult(_args, result) {
  if (result.isError) {
    return { card: 'generic', title: 'Factory mission · ERROR', content: result.content };
  }
  const status = result.meta?.status;
  return {
    card: 'generic',
    title: 'Factory mission · ' + stateLabel(status ?? 'completed'),
    content: result.content,
  };
}

export function renderSecurity(_args, result) {
  return textBlock(formatSecurity(result));
}

export function renderFactory(_args, result) {
  return textBlock(formatFactory(result));
}

export function renderPlan(_args, result) {
  return textBlock(formatPlan(result));
}

export function renderExecution(_args, result) {
  return textBlock(formatExecution(result));
}
