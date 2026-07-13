import test from 'node:test';
import assert from 'node:assert/strict';

import { loadModels } from '../src/providers.js';
import { getProvider, providerValue } from '../src/providerRegistry.js';

test('curated catalog keeps exactly two image and one core video model', async () => {
  const models = await loadModels();
  assert.deepEqual(models.filter((model) => model.modality === 'image').map((model) => model.id), [
    'google/gemini-3.1-flash-lite-image',
    'openai/gpt-image-2',
  ]);
  assert.deepEqual(models.filter((model) => model.modality === 'video').map((model) => model.id), [
    'bytedance/doubao-seedance-2.0',
  ]);
});

test('providers are resolved from the portable registry instead of hard-coded endpoints', async () => {
  const zenmux = await getProvider('zenmux');
  const minimax = await getProvider('minimax');
  assert.equal(zenmux.adapter, 'multi-protocol');
  assert.equal(providerValue(zenmux, 'openaiBase'), 'https://zenmux.ai/api/v1');
  assert.equal(providerValue(minimax, 'base'), 'https://api.minimaxi.com/v1');
});
