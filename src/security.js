import { createHash } from 'node:crypto';

import { getCanonicalAction, hasInstructionLikeContent } from './core.js';

export const SECURITY_POLICY_VERSION = 'security-gate-v1';
const MAX_INPUT_LENGTH = 400;
const CONTENT_KINDS = new Set([
  'operator-request',
  'factory-signal',
  'proposed-action',
]);

function finding(code, severity, summary) {
  return { code, severity, summary };
}

function securityEvidence(stage, status, detail) {
  return { stage, status, detail };
}

function identityPart(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  return { type: typeof value };
}

function baseAssessment({ request, actionId, target, message, contentKind }) {
  const identity = createHash('sha256')
    .update(JSON.stringify([
      identityPart(request),
      identityPart(actionId),
      identityPart(target),
      identityPart(message),
      identityPart(contentKind),
    ]))
    .digest('hex')
    .slice(0, 16);
  return {
    assessmentId: SECURITY_POLICY_VERSION + ':' + identity,
    policyVersion: SECURITY_POLICY_VERSION,
    actionBinding: actionId === null ? 'not-applicable' : 'mismatched',
    findings: [],
    evidence: [],
  };
}

function deny(base, trust, code, summary, actionBinding = base.actionBinding) {
  return {
    ...base,
    decision: 'deny',
    trust,
    actionBinding,
    findings: [finding(code, 'blocking', summary)],
    evidence: [
      securityEvidence('input', trust === 'invalid-input' ? 'failed' : 'verified', 'Input was bounded and inspected.'),
      securityEvidence('policy', 'blocked', summary),
      securityEvidence(
        'action',
        base.actionBinding === 'not-applicable' ? 'verified' : 'blocked',
        base.actionBinding === 'not-applicable'
          ? 'No action binding was requested.'
          : 'The proposed action binding did not pass validation.',
      ),
      securityEvidence('outcome', 'blocked', 'The request cannot continue to approval or execution.'),
    ],
  };
}

export function blockAssessment(assessment, code, summary) {
  return deny(assessment, 'invalid-input', code, summary, 'mismatched');
}

export function assessSecurity({
  request = '',
  actionId = null,
  target = null,
  message = null,
  contentKind = 'operator-request',
} = {}) {
  const base = baseAssessment({ request, actionId, target, message, contentKind });
  if (!CONTENT_KINDS.has(contentKind)) {
    return deny(
      base,
      'invalid-input',
      'UNSUPPORTED_CONTENT_KIND',
      'The inspected content kind is not supported.',
    );
  }
  if (typeof request !== 'string' || request.length > MAX_INPUT_LENGTH) {
    return deny(
      base,
      'invalid-input',
      'INVALID_REQUEST',
      'The inspected request is missing or exceeds the input limit.',
    );
  }
  if (
    (target !== null && typeof target !== 'string') ||
    (message !== null && typeof message !== 'string') ||
    (typeof target === 'string' && target.length > MAX_INPUT_LENGTH) ||
    (typeof message === 'string' && message.length > MAX_INPUT_LENGTH)
  ) {
    return deny(
      base,
      'invalid-input',
      'INVALID_ACTION_FIELDS',
      'The inspected action fields are malformed.',
    );
  }

  const normalizedRequest = request.trim();
  if (normalizedRequest.length === 0 && actionId === null) {
    return deny(
      base,
      'invalid-input',
      'INVALID_REQUEST',
      'The inspected request is missing or empty.',
    );
  }
  if (actionId !== null && typeof actionId !== 'string') {
    return deny(
      base,
      'invalid-input',
      'INVALID_ACTION_ID',
      'The inspected action identity is malformed.',
    );
  }
  if (contentKind === 'proposed-action' && actionId === null) {
    return deny(
      base,
      'invalid-input',
      'INCOMPLETE_ACTION',
      'A proposed action must include a canonical action identity.',
      'mismatched',
    );
  }
  if (
    hasInstructionLikeContent(normalizedRequest) ||
    hasInstructionLikeContent(target ?? '') ||
    hasInstructionLikeContent(message ?? '')
  ) {
    return deny(
      base,
      'untrusted-content',
      'UNTRUSTED_INSTRUCTION',
      'Instruction-like content cannot change policy or authorize an action.',
    );
  }

  if (actionId !== null) {
    const action = getCanonicalAction(actionId);
    if (action === undefined) {
      return deny(
        base,
        'untrusted-content',
        'UNKNOWN_ACTION',
        'Unknown action identities cannot reach approval or the outbox.',
      );
    }
    if (target !== null && target !== action.target) {
      return deny(
        base,
        'untrusted-content',
        'TARGET_MISMATCH',
        'The proposed target does not match the canonical action.',
        'mismatched',
      );
    }
    if (message !== null && message !== action.message) {
      return deny(
        base,
        'untrusted-content',
        'MESSAGE_MISMATCH',
        'The proposed message does not match the canonical action.',
        'mismatched',
      );
    }
    if (target === null || message === null) {
      return deny(
        base,
        'invalid-input',
        'INCOMPLETE_ACTION',
        'A proposed action must include its target and message for exact binding.',
        'mismatched',
      );
    }
  }

  return {
    ...base,
    decision: 'allow',
    trust: 'trusted-request',
    actionBinding: actionId === null ? 'not-applicable' : 'matched',
    findings: [finding('CANONICAL_INPUT', 'info', 'Input matched the bounded security contract.')],
    evidence: [
      securityEvidence('input', 'verified', 'Input was bounded and inspected.'),
      securityEvidence('policy', 'verified', 'No blocking policy condition was found.'),
      securityEvidence(
        'action',
        'verified',
        actionId === null
          ? 'No action binding was requested.'
          : 'The proposed target and message match the canonical action.',
      ),
      securityEvidence(
        'outcome',
        'verified',
        actionId === null
          ? 'The content may continue to a governed plan.'
          : 'The canonical action may continue to native approval.',
      ),
    ],
  };
}

export function assessCanonicalAction(actionId) {
  const action = getCanonicalAction(actionId);
  return assessSecurity({
    actionId,
    target: action?.target ?? null,
    message: action?.message ?? null,
    contentKind: 'proposed-action',
  });
}
