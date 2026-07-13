import test from 'node:test';
import assert from 'node:assert/strict';

import { assertHttpUrl, friendlyError } from '../src/httpUtil.js';
import { extFor, sanitize } from '../src/assets.js';

test('accepts absolute HTTP(S) provider download URLs only', () => {
  assert.equal(assertHttpUrl('https://media.example.com/file.png'), 'https://media.example.com/file.png');
  assert.throws(() => assertHttpUrl('file:///etc/passwd'), /不支持/);
  assert.throws(() => assertHttpUrl('not a URL'), /无效/);
});

test('turns provider authentication and moderation errors into safe guidance', () => {
  assert.equal(friendlyError(401, '{"error":{"message":"auth failed"}}'), 'API Key 无效或无权限,请联系管理员');
  assert.equal(friendlyError(400, '{"error":{"message":"safety rejected"}}'), '提示词触发了安全审核,请调整内容后重试');
});

test('asset path helpers keep identifiers inside their owning directory', () => {
  assert.equal(sanitize('../../alice?'), '.._.._alice_');
  assert.equal(extFor({ mimeType: 'video/mp4' }), 'mp4');
  assert.equal(extFor({ mimeType: 'audio/mpeg' }), 'mp3');
  assert.equal(extFor({ mimeType: 'image/webp' }), 'png');
});
