import assert from 'node:assert/strict';
import test from 'node:test';

import { buildPlan, canonicalAction } from '../src/core.js';
import { canonicalFactorySignal } from '../src/factory.js';
import { assessCanonicalAction } from '../src/security.js';
import {
  executeCall,
  executeResult,
  formatFactory,
  formatExecution,
  formatPlan,
  formatSecurity,
  planCall,
  planResult,
  renderExecution,
  renderFactory,
  renderPlan,
  renderSecurity,
} from '../src/presentation.js';

test('native presentation keeps the workflow legible and neutral', () => {
  const plan = buildPlan('Review the synthetic delay and prepare the escalation.');
  const planText = formatPlan(plan);
  assert.match(planText, /requires-approval/i);
  assert.match(planText, /no write was attempted/);
  assert.match(planText, /prod-delay-001/);
  assert.match(planText, /factory-orchestration/);
  assert.match(planText, /bottleneck-detection-and-human-escalation/);
  assert.match(planText, /Uncertainty/);
  assert.doesNotMatch(planText, /Magna/i);
  assert.deepEqual(planCall({ operator_request: 'Review delay' }).card, 'generic');
  assert.deepEqual(renderPlan({}, plan)[0].type, 'text');
  assert.match(
    planResult({}, { isError: false, meta: { status: 'ready' }, content: renderPlan({}, plan) }).title,
    /ready/i,
  );
  assert.match(formatSecurity({}), /BLOCKED/);
});

test('execution presentation shows approval, evidence, and outcome', () => {
  const action = canonicalAction();
  const execution = {
    status: 'executed',
    actionId: action.actionId,
    target: action.target,
    message: action.message,
    sideEffect: action.sideEffect,
    factorySignal: canonicalFactorySignal(),
    security: assessCanonicalAction(action.actionId),
    approval: { status: 'allowed-once', detail: 'The current operator approved the exact action.' },
    outboxPath: '.dsh-signal-gate/outbox.jsonl',
    outboxCount: 1,
    evidence: [
      { stage: 'factory-assessment', status: 'verified', detail: 'Signal loaded.' },
      { stage: 'security-gate', status: 'verified', detail: 'Action allowed.' },
      { stage: 'proposal', status: 'verified', detail: 'Action reconstructed.' },
      { stage: 'policy', status: 'verified', detail: 'Approval granted.' },
      { stage: 'approval', status: 'granted', detail: 'Approval outcome: allowed-once.' },
      { stage: 'action-attempt', status: 'verified', detail: 'One record published.' },
      { stage: 'post-action-read', status: 'verified', detail: 'Record matches.' },
      { stage: 'outcome', status: 'verified', detail: 'Complete.' },
    ],
  };
  const text = formatExecution(execution);

  assert.match(text, /FACTORY MISSION · EXECUTED/);
  assert.match(text, /allowed-once/);
  assert.match(text, /Verified record count/);
  assert.match(text, /Escalation: synthetic assembly line cycle completion is 38 minutes behind plan/);
  assert.match(text, /post-action-read: verified/);
  assert.match(text, /Security gate:\*\* CLEAR/);
  assert.deepEqual(executeCall({ action_id: action.actionId }).card, 'generic');
  assert.match(executeResult({}, { isError: false, meta: { status: 'executed' }, content: [] }).title, /executed/i);
  assert.match(executeResult({}, { isError: true, content: [] }).title, /ERROR/);
  assert.deepEqual(renderExecution({}, execution)[0].type, 'text');
});

test('standalone native cards expose factory and security state', () => {
  const factory = {
    status: 'ready',
    operatorContext: { trust: 'operator-request' },
    ...canonicalFactorySignal(),
  };
  const security = assessCanonicalAction(canonicalAction().actionId);

  assert.match(formatFactory(factory), /FACTORY OPERATIONS · READY/);
  assert.match(formatFactory(factory), /unified-factory-operations/);
  assert.match(formatSecurity(security), /SECURITY GATE · CLEAR/);
  assert.deepEqual(renderFactory({}, factory)[0].type, 'text');
  assert.deepEqual(renderSecurity({}, security)[0].type, 'text');
});
