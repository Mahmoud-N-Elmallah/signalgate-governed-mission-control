import {
  ACTION_ID,
  canonicalIncident,
  hasInstructionLikeContent,
  normalizeOperatorRequest,
} from './core.js';

export const FACTORY_SIGNAL_ID = 'prod-delay-001';
export const FACTORY_DOMAIN = 'unified-factory-operations';
export const FACTORY_CAPABILITY = 'factory-orchestration';
export const FACTORY_WORKFLOW = 'bottleneck-detection-and-human-escalation';

const OUT_OF_FIXTURE_MARKERS = [
  /quality|defect|camera|inspection|vision/i,
  /maintenance|condition[-\s]?monitoring|vibration|bearing/i,
  /material[-\s]?flow|robot|\bamr\b/i,
  /utility|compressed[-\s]?air|electricity|energy|sustainability|leak/i,
];
const FACTORY_CONTEXT_MARKERS = [
  /synthetic|production|factory|bottleneck|assembly|cycle|dispatch|takt|buffer|\bline\b|production[-\s]?flow|operations[-\s]?control|\bdelay\b|\baction\b|execute|escalat|approval/i,
];

function signalEvidence() {
  return [
    {
      source: 'synthetic-fixture',
      observation: 'Synthetic line telemetry shows sustained cycle delay',
    },
    {
      source: 'synthetic-fixture',
      observation: 'The delay is present across the current operating window',
    },
  ];
}

export function canonicalFactorySignal() {
  const incident = canonicalIncident();
  return {
    signalId: FACTORY_SIGNAL_ID,
    scope: 'supported',
    domain: FACTORY_DOMAIN,
    capability: FACTORY_CAPABILITY,
    workflow: FACTORY_WORKFLOW,
    affectedProcess: 'production-flow',
    operationalObjective: 'Protect throughput and downstream dispatch continuity',
    operation: incident.operation,
    observedCondition: incident.observedDelay,
    impact: incident.impact,
    severity: incident.severity,
    evidence: signalEvidence(),
    uncertainty: incident.uncertainty,
    recommendedResponse:
      'Escalate the production-flow bottleneck to operations-control for human review.',
    proposedActionId: ACTION_ID,
    policyState: 'requires-approval',
  };
}

function failedFactoryPlan() {
  return {
    status: 'failed',
    operatorContext: {
      summary: 'The factory request could not be normalized.',
      trust: 'invalid-input',
    },
    ...canonicalFactorySignal(),
    uncertainty:
      'No factory signal was accepted because the request failed validation',
    proposedActionId: 'not-issued',
    recommendedResponse: 'No action was prepared.',
    policyState: 'blocked',
  };
}

function unsupportedFactoryPlan(request) {
  return {
    status: 'blocked',
    operatorContext: {
      summary: request,
      trust: 'unsupported-domain',
    },
    signalId: 'not-issued',
    scope: 'unsupported',
    domain: FACTORY_DOMAIN,
    capability: 'not-available',
    workflow: 'scope-check',
    affectedProcess: 'not-established',
    operationalObjective: 'not-established',
    operation: 'Unsupported factory workflow',
    observedCondition: 'No supported production-flow signal was identified',
    impact: 'No governed action was prepared',
    severity: 'unknown',
    evidence: [
      {
        source: 'request-boundary',
        observation: 'The request does not match the bundled production-flow fixture.',
      },
    ],
    uncertainty: 'No supported synthetic factory signal was accepted',
    recommendedResponse: 'Use a supported production-flow bottleneck request.',
    proposedActionId: 'not-issued',
    policyState: 'blocked',
  };
}

function isSupportedFactoryRequest(request) {
  if (OUT_OF_FIXTURE_MARKERS.some((marker) => marker.test(request))) return false;
  return FACTORY_CONTEXT_MARKERS.some((marker) => marker.test(request));
}

export function buildFactoryPlan(operatorRequest) {
  try {
    const request = normalizeOperatorRequest(operatorRequest);
    if (!isSupportedFactoryRequest(request)) return unsupportedFactoryPlan(request);
    return {
      status: 'ready',
      operatorContext: {
        summary: request,
        trust: hasInstructionLikeContent(request)
          ? 'untrusted-content'
          : 'operator-request',
      },
      ...canonicalFactorySignal(),
    };
  } catch {
    return failedFactoryPlan();
  }
}
