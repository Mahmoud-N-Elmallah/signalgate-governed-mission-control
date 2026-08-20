export const OUTBOX_PATH = '.dsh-signal-gate/outbox.jsonl';

const FIXTURE = Object.freeze({
  incidentId: 'prod-delay-001',
  operation: 'Synthetic assembly line',
  observedDelay: 'Cycle completion is 38 minutes behind the expected window',
  impact: 'Downstream dispatch is at risk within the current operating window',
  uncertainty: 'Synthetic fixture only; no live production system was queried',
  evidence: Object.freeze([
    'Synthetic line telemetry shows sustained cycle delay',
    'The delay is present across the current operating window',
  ]),
  severity: 'high',
  allowedTarget: 'operations-control',
  canonicalMessage:
    'Escalation: synthetic assembly line cycle completion is 38 minutes behind plan. Downstream dispatch is at risk. Review the attached synthetic observations.',
  actionId: 'prod-delay-001:ops-escalation:v1',
});

const INJECTION_MARKERS = [
  /ignore\s+(?:all\s+)?(?:prior\s+)?instructions?/i,
  /disregard\s+(?:all\s+)?(?:prior|previous|earlier)\s+(?:instructions?|directions?)/i,
  /treat\s+(?:this|the\s+(?:request|action))\s+as\s+(?:already\s+)?authorized/i,
  /ignore\s+(?:all\s+)?(?:security|safety)\s+(?:rules?|controls?|checks?)/i,
  /skip\s+(?:the\s+)?approval/i,
  /bypass\s+(?:the\s+)?(?:approval|authorization|authorisation|security|safety|controls?|checks?)/i,
  /bypass\s+(?:the\s+)?policy/i,
  /override\s+(?:the\s+)?(?:policy|approval|authorization|authorisation|security|safety)/i,
  /approve(?:d)?\s+(?:by|from)\s+(?:the\s+)?(?:system|model|user)/i,
  /(?:already|has)\s+approved\s+(?:this\s+)?(?:exact\s+)?(?:action|request)/i,
  /write\s+(?:to\s+)?(?:the\s+)?outbox/i,
  /change\s+(?:the\s+)?(?:target|message)/i,
  /use\s+(?:a\s+)?different\s+(?:target|message)/i,
  /invent(?:ed|ing)\s+(?:a\s+)?(?:ticket|action|assessment)/i,
  /(?:pretend|claim)\s+(?:that\s+)?(?:approval|authorization)\s+(?:exists|was granted)/i,
];

export const ACTION_ID = FIXTURE.actionId;

export function hasInstructionLikeContent(value) {
  return (
    typeof value === 'string' &&
    INJECTION_MARKERS.some((marker) => marker.test(value))
  );
}

export function normalizeOperatorRequest(value) {
  if (typeof value !== 'string') {
    throw new Error('operator_request must be a string');
  }
  const request = value.trim();
  if (request.length === 0) {
    throw new Error('operator_request must not be empty');
  }
  if (request.length > 400) {
    throw new Error('operator_request must be 400 characters or fewer');
  }
  return request;
}

function copyIncident() {
  return {
    incidentId: FIXTURE.incidentId,
    operation: FIXTURE.operation,
    observedDelay: FIXTURE.observedDelay,
    impact: FIXTURE.impact,
    uncertainty: FIXTURE.uncertainty,
    evidence: [...FIXTURE.evidence],
    severity: FIXTURE.severity,
  };
}

export function canonicalIncident() {
  return copyIncident();
}

export function canonicalAction() {
  return {
    actionId: FIXTURE.actionId,
    incidentId: FIXTURE.incidentId,
    target: FIXTURE.allowedTarget,
    message: FIXTURE.canonicalMessage,
    sideEffect: 'local-outbox-append',
    state: 'awaiting-approval',
  };
}

export function getCanonicalAction(actionId) {
  return actionId === FIXTURE.actionId ? canonicalAction() : undefined;
}

export function buildPlan(operatorRequest) {
  const request = normalizeOperatorRequest(operatorRequest);
  const injectionDetected = hasInstructionLikeContent(request);

  return {
    status: 'ready',
    operatorContext: {
      summary: request,
      trust: injectionDetected ? 'untrusted-content' : 'operator-request',
    },
    incident: copyIncident(),
    proposedAction: canonicalAction(),
    policy: {
      status: 'requires-approval',
      reason:
        'Appending an operations notification is a side effect and requires explicit operator approval.',
    },
    evidence: [
      evidence('fixture', 'verified', 'Bundled synthetic incident fixture selected.'),
      evidence(
        'proposal',
        'verified',
        'One canonical target, message, and action identity were reconstructed.',
      ),
      evidence(
        'policy',
        'required',
        injectionDetected
          ? 'Untrusted instruction-like incident content was retained as context; it cannot authorize an action.'
          : 'The local outbox append remains blocked until approval.',
      ),
    ],
  };
}

export function evidence(stage, status, detail) {
  return { stage, status, detail };
}
