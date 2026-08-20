import { randomUUID } from 'node:crypto';
import { defineTool } from '@deepseek-ai/dsh-tools';

import {
  ACTION_ID,
  OUTBOX_PATH,
  buildPlan,
  canonicalAction,
  canonicalIncident,
  evidence,
  getCanonicalAction,
} from './core.js';
import { buildFactoryPlan, canonicalFactorySignal } from './factory.js';
import { assessCanonicalAction, assessSecurity, blockAssessment } from './security.js';
import { appendOutboxOnce, matchesAction, readOutbox } from './outbox.js';
import {
  executeCall,
  executeResult,
  factoryCall,
  factoryResult,
  planCall,
  planResult,
  renderExecution,
  renderFactory,
  renderPlan,
  renderSecurity,
  securityCall,
  securityResult,
} from './presentation.js';

export const name = 'mission-control';
export const inject = ['tools', 'fs', 'approval', 'systemPrompt'];

const MAX_PLAN_TICKETS = 32;
const PLAN_TICKET_TTL_MS = 15 * 60 * 1000;

const EVIDENCE_STAGES = [
  'factory-assessment',
  'security-gate',
  'proposal',
  'policy',
  'approval',
  'action-attempt',
  'post-action-read',
  'outcome',
];
const EVIDENCE_STATUSES = [
  'verified',
  'required',
  'granted',
  'denied',
  'blocked',
  'skipped',
  'failed',
  'duplicate',
];

const EVIDENCE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    stage: { type: 'string', enum: EVIDENCE_STAGES, required: true },
    status: { type: 'string', enum: EVIDENCE_STATUSES, required: true },
    detail: { type: 'string', required: true },
  },
};

const INCIDENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    incidentId: { type: 'string', required: true },
    operation: { type: 'string', required: true },
    observedDelay: { type: 'string', required: true },
    impact: { type: 'string', required: true },
    uncertainty: { type: 'string', required: true },
    evidence: { type: 'array', items: { type: 'string' }, required: true },
    severity: { type: 'string', enum: ['low', 'medium', 'high'], required: true },
  },
};

const ACTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    actionId: { type: 'string', const: ACTION_ID, required: true },
    incidentId: { type: 'string', const: 'prod-delay-001', required: true },
    target: { type: 'string', const: 'operations-control', required: true },
    message: { type: 'string', required: true },
    sideEffect: { type: 'string', const: 'local-outbox-append', required: true },
    state: { type: 'string', enum: ['awaiting-approval'], required: true },
  },
};

const FACTORY_EVIDENCE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    source: { type: 'string', required: true },
    observation: { type: 'string', required: true },
  },
};

const FACTORY_SIGNAL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    signalId: { type: 'string', required: true },
    scope: { type: 'string', enum: ['supported', 'unsupported'], required: true },
    domain: { type: 'string', required: true },
    capability: { type: 'string', required: true },
    workflow: { type: 'string', required: true },
    affectedProcess: { type: 'string', required: true },
    operationalObjective: { type: 'string', required: true },
    operation: { type: 'string', required: true },
    observedCondition: { type: 'string', required: true },
    impact: { type: 'string', required: true },
    severity: { type: 'string', enum: ['low', 'medium', 'high', 'unknown'], required: true },
    evidence: { type: 'array', items: FACTORY_EVIDENCE_SCHEMA, required: true },
    uncertainty: { type: 'string', required: true },
    recommendedResponse: { type: 'string', required: true },
    proposedActionId: { type: 'string', required: true },
    policyState: { type: 'string', enum: ['requires-approval', 'blocked'], required: true },
  },
};

const OPERATOR_CONTEXT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: { type: 'string', required: true },
    trust: {
      type: 'string',
      enum: ['operator-request', 'untrusted-content', 'unsupported-domain', 'invalid-input'],
      required: true,
    },
  },
  required: true,
};

const FINDING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    code: { type: 'string', required: true },
    severity: { type: 'string', enum: ['info', 'blocking'], required: true },
    summary: { type: 'string', required: true },
  },
};

const SECURITY_EVIDENCE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    stage: { type: 'string', enum: ['input', 'policy', 'action', 'outcome'], required: true },
    status: { type: 'string', enum: ['verified', 'blocked', 'failed'], required: true },
    detail: { type: 'string', required: true },
  },
};

const SECURITY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    assessmentId: { type: 'string', required: true },
    decision: { type: 'string', enum: ['allow', 'deny'], required: true },
    trust: {
      type: 'string',
      enum: ['trusted-request', 'untrusted-content', 'invalid-input'],
      required: true,
    },
    policyVersion: { type: 'string', const: 'security-gate-v1', required: true },
    actionBinding: {
      type: 'string',
      enum: ['not-applicable', 'matched', 'mismatched'],
      required: true,
    },
    findings: { type: 'array', items: FINDING_SCHEMA, required: true },
    evidence: { type: 'array', items: SECURITY_EVIDENCE_SCHEMA, required: true },
  },
};

const FACTORY_OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      status: { type: 'string', enum: ['ready', 'blocked', 'failed'], required: true },
      operatorContext: OPERATOR_CONTEXT_SCHEMA,
      ...FACTORY_SIGNAL_SCHEMA.properties,
    },
  },
  render: renderFactory,
  presentationMeta: (_args, value) => ({ status: value.status }),
};

const PLAN_OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      status: { type: 'string', enum: ['ready', 'blocked', 'failed'], required: true },
      assessmentId: { type: 'string', required: true },
      operatorContext: OPERATOR_CONTEXT_SCHEMA,
      incident: { ...INCIDENT_SCHEMA, required: true },
      factorySignal: { ...FACTORY_SIGNAL_SCHEMA, required: true },
      security: { ...SECURITY_SCHEMA, required: true },
      proposedAction: { ...ACTION_SCHEMA, required: true },
      policy: {
        type: 'object',
        additionalProperties: false,
        properties: {
          status: { type: 'string', enum: ['requires-approval', 'blocked'], required: true },
          reason: { type: 'string', required: true },
        },
        required: true,
      },
      evidence: { type: 'array', items: EVIDENCE_SCHEMA, required: true },
    },
  },
  render: renderPlan,
  presentationMeta: (_args, value) => ({
    status: value.status,
    actionId: value.proposedAction.actionId,
  }),
};

const EXECUTION_OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      status: {
        type: 'string',
        enum: ['denied', 'executed', 'duplicate', 'failed'],
        required: true,
      },
      actionId: { type: 'string', required: true },
      target: { type: 'string', required: true },
      message: { type: 'string', required: true },
      sideEffect: { type: 'string', const: 'local-outbox-append', required: true },
      factorySignal: { ...FACTORY_SIGNAL_SCHEMA, required: true },
      security: { ...SECURITY_SCHEMA, required: true },
      approval: {
        type: 'object',
        additionalProperties: false,
        properties: {
          status: {
            type: 'string',
            enum: [
              'not-requested',
              'allowed-once',
              'rejected',
              'cancelled',
              'unavailable',
              'error',
            ],
            required: true,
          },
          detail: { type: 'string', required: true },
        },
        required: true,
      },
      outboxPath: { type: 'string', const: OUTBOX_PATH, required: true },
      outboxCount: { type: 'integer', required: true },
      evidence: { type: 'array', items: EVIDENCE_SCHEMA, required: true },
    },
  },
  render: renderExecution,
  presentationMeta: (_args, value) => ({
    status: value.status,
    actionId: value.actionId,
  }),
};

const GUIDANCE = [
  'SignalGate is a governed unified-factory operations workflow for one bundled synthetic production bottleneck.',
  'Use factory_operations_plan for the bounded factory-orchestration signal and security_command_assess for suspicious requests or proposed actions.',
  'Call mission_control_plan before mission_control_execute. Use only the exact action_id and assessment_id returned by the plan.',
  'Never invent or modify a target, message, authorization flag, or file path. Explain approval-required, denied, duplicate, and verified states clearly.',
].join(' ');

function safeFailureDetail(error, fallback) {
  if (error?.code !== undefined) return fallback + ' (' + error.code + ').';
  return fallback + '.';
}

function ownerIdentity(agent) {
  if (agent === undefined || agent === null) return undefined;
  if (typeof agent === 'string') return agent.trim() === '' ? undefined : agent;
  if (typeof agent === 'object') {
    for (const field of ['id', 'agentId', 'sessionId']) {
      if (typeof agent[field] === 'string' && agent[field].trim() !== '') {
        return field + ':' + agent[field];
      }
    }
  }
  return undefined;
}

function issuePlanTicket(planTickets, actionId, agent) {
  const now = Date.now();
  for (const [ticketId, ticket] of planTickets) {
    if (ticket.expiresAt <= now) planTickets.delete(ticketId);
  }
  const assessmentId = 'mission:' + randomUUID();
  planTickets.set(assessmentId, {
    actionId,
    owner: ownerIdentity(agent),
    expiresAt: now + PLAN_TICKET_TTL_MS,
  });
  if (planTickets.size > MAX_PLAN_TICKETS) {
    planTickets.delete(planTickets.keys().next().value);
  }
  return assessmentId;
}

function executionSecurity(planTickets, actionId, assessmentId, agent) {
  const assessment = assessCanonicalAction(actionId);
  if (assessment.decision !== 'allow') return assessment;
  if (typeof assessmentId !== 'string' || assessmentId.trim() === '') {
    return blockAssessment(
      assessment,
      'ASSESSMENT_REQUIRED',
      'A valid plan assessment ticket is required before execution.',
    );
  }
  const ticket = planTickets.get(assessmentId);
  if (ticket?.actionId !== actionId) {
    return blockAssessment(
      assessment,
      'ASSESSMENT_MISMATCH',
      'The plan assessment ticket does not bind to the canonical action.',
    );
  }
  if (ticket.expiresAt <= Date.now()) {
    return blockAssessment(
      assessment,
      'ASSESSMENT_EXPIRED',
      'The plan assessment ticket has expired and a new plan is required.',
    );
  }
  const owner = ownerIdentity(agent);
  if (owner === undefined) {
    return blockAssessment(
      assessment,
      'ASSESSMENT_OWNER_REQUIRED',
      'A valid owning operator session is required before execution.',
    );
  }
  if (ticket.owner !== owner) {
    return blockAssessment(
      assessment,
      'ASSESSMENT_MISMATCH',
      'The plan assessment ticket belongs to a different operator session.',
    );
  }
  return assessment;
}

function factorySignalFromPlan(factoryPlan) {
  const { status: _status, operatorContext: _operatorContext, ...signal } = factoryPlan;
  return signal;
}

function planEvidence(factoryPlan, security, policyStatus, policyDetail) {
  const factoryReady = factoryPlan.status === 'ready';
  return [
    evidence(
      'factory-assessment',
      factoryReady ? 'verified' : 'failed',
      factoryReady
        ? 'The bounded synthetic factory signal was normalized.'
        : 'The factory request failed normalization.',
    ),
    evidence(
      'security-gate',
      security.decision === 'allow' ? 'verified' : 'blocked',
      security.decision === 'allow'
        ? 'The request passed the deterministic security gate.'
        : security.findings[0].summary,
    ),
    evidence(
      'proposal',
      factoryReady ? 'verified' : 'failed',
      factoryReady
        ? 'One canonical target, message, and action identity were reconstructed.'
        : 'No trusted factory request was accepted for planning.',
    ),
    evidence('policy', policyStatus, policyDetail),
    evidence('approval', 'skipped', 'Approval is requested only by mission_control_execute.'),
    evidence('action-attempt', 'skipped', 'No write was attempted during planning.'),
    evidence('post-action-read', 'skipped', 'No post-action read was needed during planning.'),
    evidence(
      'outcome',
      security.decision === 'allow' && factoryReady ? 'required' : 'blocked',
      security.decision === 'allow' && factoryReady
        ? 'Execution remains pending the exact ticket and native approval.'
        : 'The blocked plan cannot reach execution.',
    ),
  ];
}

function buildIntegratedPlan(operatorRequest, planTickets, exec) {
  const factoryPlan = buildFactoryPlan(operatorRequest);
  let baseline;
  try {
    baseline = buildPlan(operatorRequest);
  } catch {
    baseline = undefined;
  }

  const action = baseline?.proposedAction ?? canonicalAction();
  const incident = baseline?.incident ?? canonicalIncident();
  const security = assessSecurity({
    request: operatorRequest,
    actionId: action.actionId,
    target: action.target,
    message: action.message,
    contentKind: 'proposed-action',
  });
  const scopedSecurity =
    typeof operatorRequest === 'string' && operatorRequest.trim() === ''
      ? blockAssessment(
          security,
          'INVALID_REQUEST',
          'The inspected request is missing or empty.',
        )
      : factoryPlan.status === 'blocked' && security.decision === 'allow'
        ? blockAssessment(
            security,
            'UNSUPPORTED_FACTORY_DOMAIN',
            'The request is outside the bundled production-flow factory scope.',
          )
        : security;
  const owner = ownerIdentity(exec?.agent);
  const ready =
    baseline !== undefined &&
    factoryPlan.status === 'ready' &&
    scopedSecurity.decision === 'allow' &&
    owner !== undefined;
  const policyReason = ready
    ? 'The local outbox append remains blocked until native operator approval.'
    : scopedSecurity.decision !== 'allow'
      ? scopedSecurity.findings[0].summary
      : owner === undefined
        ? 'The plan did not receive an owning operator session; no execution ticket was issued.'
        : 'The factory request failed validation; no governed action can proceed.';
  const assessmentId = ready
    ? issuePlanTicket(planTickets, action.actionId, exec.agent)
    : 'not-issued';

  return {
    status: ready ? 'ready' : 'blocked',
    assessmentId,
    operatorContext: factoryPlan.operatorContext,
    incident,
    factorySignal: factorySignalFromPlan(factoryPlan),
    security: scopedSecurity,
    proposedAction: action,
    policy: {
      status: ready ? 'requires-approval' : 'blocked',
      reason: policyReason,
    },
    evidence: planEvidence(
      factoryPlan,
      scopedSecurity,
      ready ? 'required' : 'blocked',
      policyReason,
    ),
  };
}

function executionEvidence(action, security, policyStatus, policyDetail) {
  return [
    evidence('factory-assessment', 'verified', 'The canonical synthetic factory signal was loaded.'),
    evidence(
      'security-gate',
      security.decision === 'allow' ? 'verified' : 'blocked',
      security.decision === 'allow'
        ? 'The canonical action passed the deterministic security gate.'
        : security.findings[0].summary,
    ),
    evidence('proposal', 'verified', 'Canonical action ' + action.actionId + ' was reconstructed.'),
    evidence('policy', policyStatus, policyDetail),
  ];
}

function executionValue(
  status,
  action,
  security,
  approvalStatus,
  approvalDetail,
  outboxCount,
  steps,
) {
  return {
    status,
    actionId: action.actionId,
    target: action.target,
    message: action.message,
    sideEffect: action.sideEffect,
    factorySignal: canonicalFactorySignal(),
    security,
    approval: {
      status: approvalStatus,
      detail: approvalDetail,
    },
    outboxPath: OUTBOX_PATH,
    outboxCount,
    evidence: steps,
  };
}

function unknownActionValue(actionId) {
  const action = {
    actionId: typeof actionId === 'string' ? actionId : 'unknown',
    target: 'none',
    message: 'No canonical action was selected.',
    sideEffect: 'local-outbox-append',
  };
  const security = assessCanonicalAction(actionId);
  return executionValue(
    'denied',
    action,
    security,
    'not-requested',
    'The action id is not recognized.',
    0,
    [
      ...executionEvidence(
        action,
        security,
        'blocked',
        'Unknown actions cannot reach approval or the outbox.',
      ),
      evidence('approval', 'skipped', 'Approval was not requested.'),
      evidence('action-attempt', 'skipped', 'No write was attempted.'),
      evidence('post-action-read', 'skipped', 'No post-action reread was needed.'),
      evidence('outcome', 'denied', 'The request was rejected before any side effect.'),
    ],
  );
}

async function executeMissionControl(ctx, planTickets, args, exec) {
  const action = getCanonicalAction(args.action_id);
  const security = executionSecurity(
    planTickets,
    args.action_id,
    args.assessment_id,
    exec?.agent,
  );
  if (action === undefined) return unknownActionValue(args.action_id);
  if (security.decision !== 'allow') {
    return executionValue(
      'denied',
      action,
      security,
      'not-requested',
      security.findings[0].summary,
      0,
      [
        ...executionEvidence(action, security, 'blocked', security.findings[0].summary),
        evidence('approval', 'skipped', 'Approval was not requested.'),
        evidence('action-attempt', 'skipped', 'No write was attempted.'),
        evidence('post-action-read', 'skipped', 'No post-action reread was needed.'),
        evidence('outcome', 'denied', 'The action was rejected before approval.'),
      ],
    );
  }
  let current;
  try {
    current = await readOutbox(ctx, exec.signal);
  } catch (error) {
    return executionValue(
      'failed',
      action,
      security,
      'not-requested',
      'Approval was not requested because the outbox could not be read.',
      0,
      [
        ...executionEvidence(action, security, 'failed', safeFailureDetail(error, 'Outbox read failed')),
        evidence('approval', 'skipped', 'Approval was not requested.'),
        evidence('action-attempt', 'skipped', 'No write was attempted.'),
        evidence('post-action-read', 'skipped', 'No post-action reread was needed.'),
        evidence('outcome', 'failed', 'The action failed closed before approval.'),
      ],
    );
  }

  const existing = current.entries.find((entry) => entry.actionId === action.actionId);
  if (existing !== undefined) {
    if (!matchesAction(existing, action)) {
      return executionValue(
        'failed',
        action,
        security,
        'not-requested',
        'The existing outbox record does not match the canonical action.',
        current.entries.length,
        [
          ...executionEvidence(
            action,
            security,
            'failed',
            'Existing outbox state failed canonical action validation.',
          ),
          evidence('approval', 'skipped', 'Approval was not requested.'),
          evidence('action-attempt', 'skipped', 'No write was attempted.'),
          evidence('post-action-read', 'failed', 'The existing record could not be treated as verified.'),
          evidence('outcome', 'failed', 'The action failed closed without a side effect.'),
        ],
      );
    }
    return executionValue(
      'duplicate',
      action,
      security,
      'not-requested',
      'The exact action already has a local outbox record.',
      current.entries.length,
      [
        ...executionEvidence(action, security, 'verified', 'Existing outbox state was read before approval.'),
        evidence('approval', 'skipped', 'Approval was not requested for a duplicate.'),
        evidence('action-attempt', 'duplicate', 'No second record was appended.'),
        evidence('post-action-read', 'verified', 'Existing record matches the canonical action.'),
        evidence('outcome', 'duplicate', 'Replay returned the existing verified result.'),
      ],
    );
  }

  let approvalOutcome;
  try {
    approvalOutcome = await ctx.approval.request({
      agent: exec.agent,
      toolName: 'mission_control_execute',
      callId: exec.callId,
      reason:
        'Approve one local outbox append to ' +
        action.target +
        ' with this exact message: ' +
        action.message,
      signal: exec.signal,
    });
  } catch (error) {
    return executionValue(
      'failed',
      action,
      security,
      'error',
      safeFailureDetail(error, 'Approval request failed'),
      current.entries.length,
      [
        ...executionEvidence(action, security, 'required', 'Approval was required before the write.'),
        evidence('approval', 'failed', 'The approval seam failed closed.'),
        evidence('action-attempt', 'skipped', 'No write was attempted.'),
        evidence('post-action-read', 'skipped', 'No post-action reread was needed.'),
        evidence('outcome', 'failed', 'The action did not reach the outbox.'),
      ],
    );
  }

  if (approvalOutcome !== 'allowed-once') {
    const status = ['rejected', 'cancelled', 'unavailable'].includes(approvalOutcome)
      ? approvalOutcome
      : 'unavailable';
    return executionValue(
      'denied',
      action,
      security,
      status,
      'The exact action was not granted by the current operator.',
      current.entries.length,
      [
        ...executionEvidence(action, security, 'required', 'The side effect remained blocked until approval.'),
        evidence('approval', 'denied', 'Approval outcome: ' + status + '.'),
        evidence('action-attempt', 'skipped', 'No write was attempted.'),
        evidence('post-action-read', 'skipped', 'No post-action reread was needed.'),
        evidence('outcome', 'denied', 'The outbox is unchanged.'),
      ],
    );
  }

  try {
    const committed = await appendOutboxOnce(ctx, action, exec.signal);
    if (committed.status === 'duplicate') {
      return executionValue(
        'duplicate',
        action,
        security,
        'allowed-once',
        'Approval was granted, but another verified execution won the race.',
        committed.count,
        [
          ...executionEvidence(action, security, 'verified', 'Approval was granted for the canonical action.'),
          evidence('approval', 'granted', 'Approval outcome: allowed-once.'),
          evidence('action-attempt', 'duplicate', 'The action was already committed by a concurrent retry.'),
          evidence('post-action-read', 'verified', 'The existing record matches the canonical action.'),
          evidence('outcome', 'duplicate', 'No second record was appended.'),
        ],
      );
    }
    return executionValue(
      'executed',
      action,
      security,
      'allowed-once',
      'The current operator approved the exact action.',
      committed.count,
      [
        ...executionEvidence(action, security, 'verified', 'Approval was granted for the canonical action.'),
        evidence('approval', 'granted', 'Approval outcome: allowed-once.'),
        evidence('action-attempt', 'verified', 'One local outbox record was atomically published.'),
        evidence('post-action-read', 'verified', 'The outbox contains the matching action record.'),
        evidence('outcome', 'verified', 'The governed factory escalation is complete.'),
      ],
    );
  } catch (error) {
    return executionValue(
      'failed',
      action,
      security,
      'allowed-once',
      'Approval was granted, but the local outbox operation failed closed.',
      current.entries.length,
      [
        ...executionEvidence(action, security, 'verified', 'Approval was granted for the canonical action.'),
        evidence('approval', 'granted', 'Approval outcome: allowed-once.'),
        evidence('action-attempt', 'failed', safeFailureDetail(error, 'Outbox write failed')),
        evidence('post-action-read', 'failed', 'The expected verified record was not established.'),
        evidence('outcome', 'failed', 'The plugin did not claim a successful side effect.'),
      ],
    );
  }
}

export function apply(ctx) {
  const planTickets = new Map();

  ctx.systemPrompt.section({
    name: 'signal-gate:guidance',
    order: 145,
    text: GUIDANCE,
  });

  ctx.tools.register(
    defineTool({
      name: 'security_command_assess',
      description:
        'Inspect bounded operator content or a proposed canonical action with a deterministic security gate. This tool is read-only, never authorizes a side effect, and never writes the outbox.',
      parameters: {
        request: {
          type: 'string',
          required: true,
          description: 'The bounded content to inspect as untrusted input.',
        },
        action_id: {
          type: 'string',
          description: 'Optional action identity to bind and validate.',
        },
        target: {
          type: 'string',
          description: 'Optional proposed target to compare with the canonical action.',
        },
        message: {
          type: 'string',
          description: 'Optional proposed message to compare with the canonical action.',
        },
        content_kind: {
          type: 'string',
          enum: ['operator-request', 'factory-signal', 'proposed-action'],
          description: 'The bounded content category under inspection.',
        },
      },
      output: {
        schema: SECURITY_SCHEMA,
        render: renderSecurity,
        presentationMeta: (_args, value) => ({ decision: value.decision }),
      },
      execute: (args) =>
        Promise.resolve(
          assessSecurity({
            request: args.request,
            actionId: args.action_id ?? null,
            target: args.target ?? null,
            message: args.message ?? null,
            contentKind: args.content_kind ?? 'operator-request',
          }),
        ),
      presentCall: securityCall,
      presentResult: securityResult,
    }),
  );

  ctx.tools.register(
    defineTool({
      name: 'factory_operations_plan',
      description:
        'Normalize the bundled synthetic factory signal and prepare a bounded response. This tool is read-only and never writes or requests approval.',
      parameters: {
        operator_request: {
          type: 'string',
          required: true,
          description: 'The operator request about the bounded synthetic factory signal.',
        },
      },
      output: FACTORY_OUTPUT,
      execute: (args) => Promise.resolve(buildFactoryPlan(args.operator_request)),
      presentCall: factoryCall,
      presentResult: factoryResult,
    }),
  );

  ctx.tools.register(
    defineTool({
      name: 'mission_control_plan',
      description:
        'Combine the bounded factory signal, deterministic security gate, and governed action proposal. This tool is read-only and never writes the outbox.',
      parameters: {
        operator_request: {
          type: 'string',
          required: true,
          description: 'The operator request about the synthetic production delay.',
        },
      },
      output: PLAN_OUTPUT,
      execute: (args, exec) =>
        Promise.resolve(buildIntegratedPlan(args.operator_request, planTickets, exec)),
      presentCall: planCall,
      presentResult: planResult,
    }),
  );

  ctx.tools.register(
    defineTool({
      name: 'mission_control_execute',
      description:
        'Execute only the exact action_id and assessment_id returned by a ready mission_control_plan. The plugin reconstructs the target and message, requests native DSH approval, writes only after allowed-once approval, rereads the outbox, and prevents duplicates.',
      parameters: {
        action_id: {
          type: 'string',
          required: true,
          description: 'The exact action_id returned by mission_control_plan.',
        },
        assessment_id: {
          type: 'string',
          required: true,
          description: 'The exact assessment_id returned by the ready mission_control_plan result.',
        },
      },
      output: EXECUTION_OUTPUT,
      execute: (args, exec) => executeMissionControl(ctx, planTickets, args, exec),
      presentCall: executeCall,
      presentResult: executeResult,
    }),
  );
}
