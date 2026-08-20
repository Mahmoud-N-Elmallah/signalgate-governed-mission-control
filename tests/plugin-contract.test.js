import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { apply, inject, name } from '../src/index.js';
import { createFakeContext, tool } from './support/fakes.js';

test('exports a DSH bundle entry and four registered tools', async () => {
  const packageJson = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  );
  const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8');

  assert.equal(name, 'mission-control');
  assert.deepEqual(inject, ['tools', 'fs', 'approval', 'systemPrompt']);
  assert.equal(packageJson.dsh.bundle.patch, './cordis.patch.yml');
  assert.match(patch, /id:\s*signal-gate-mission-control/);
  assert.match(patch, /name:\s*'@dsh-showcase\/governed-mission-control'/);

  const fake = createFakeContext();
  apply(fake.ctx);
  assert.deepEqual(
    fake.registeredTools.map(({ name: toolName }) => toolName),
    [
      'security_command_assess',
      'factory_operations_plan',
      'mission_control_plan',
      'mission_control_execute',
    ],
  );
  assert.match(fake.sections[0].text, /SignalGate/);
  assert.equal(tool(fake.registeredTools, 'security_command_assess').parameters.type, 'object');
  assert.equal(tool(fake.registeredTools, 'factory_operations_plan').parameters.type, 'object');
  assert.equal(tool(fake.registeredTools, 'mission_control_plan').parameters.type, 'object');
  assert.deepEqual(
    tool(fake.registeredTools, 'security_command_assess').parameters.required,
    ['request'],
  );
  assert.deepEqual(
    tool(fake.registeredTools, 'factory_operations_plan').parameters.required,
    ['operator_request'],
  );
  assert.deepEqual(
    tool(fake.registeredTools, 'mission_control_plan').parameters.required,
    ['operator_request'],
  );
  assert.deepEqual(
    tool(fake.registeredTools, 'mission_control_execute').parameters.required,
    ['action_id', 'assessment_id'],
  );
});
