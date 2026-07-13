import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';

import { validateContract } from '../src/knowledge.js';

test('the unified DSL accepts deliberate cycles and projects a graph', async () => {
  const content = await fs.readFile(new URL('../contracts/gimage-media-orchestration.yaml', import.meta.url), 'utf8');
  const result = validateContract(content);
  assert.equal(result.valid, true);
  assert.equal(result.diagnostics.length, 0);
  assert.equal(result.projection.summary.paragraphs, 7);
  assert.ok(result.projection.edges.some((edge) => edge.source === 'respond_rejection' && edge.target === 'intake_request'));
});

test('the unified DSL flags dangling state and paragraph references', () => {
  const result = validateContract(`dsl: gimage/1
id: broken_contract
title: Broken
entities:
  - id: task
    states: [draft]
paragraphs:
  - id: begin
    steps:
      - kind: change
        entity: task
        from: draft
        to: done
        next: missing
`);
  assert.equal(result.valid, false);
  assert.ok(result.diagnostics.some((item) => item.path.endsWith('.to')));
  assert.ok(result.diagnostics.some((item) => item.path.endsWith('.next')));
});
