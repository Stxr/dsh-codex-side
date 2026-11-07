import test from 'node:test';
import assert from 'node:assert/strict';
import { retitleSide, titleInput } from '../title.js';

// Chunk assembly uses the real native LLM SDK. Host integration tests separately
// replay the accepted events through the strict released V4 codec.
function pendingFixture(chunks) {
  const question = { id: 'q', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '修复旁支转换后的自动跳转' }] };
  let accepted;
  const requests = [];
  const agent = { id: 'child', inbox: { nextTurn: [question], nextStep: [] },
    model: { current: () => ({ provider: 'test', model: 'test' }) },
    session: { id: 'child', surface: { nodes: [] }, ownEvents: () => [{ type: 'agent/inbox/spliced', seq: 9, data: { inserted: [question] } }] } };
  const ctx = {
    llm: { async prepareCall(config) { return { config, async *stream(options) { requests.push(options); yield* chunks; } }; } },
    sessionTitle: { get: () => accepted, rename(session, title) { accepted = { title, eventSeq: 10 }; return accepted; } },
  };
  return { ctx, agent, requests, title: () => accepted?.title };
}
function textChunks(text, finish = 'stop') {
  return [{ type: 'block-start', blockType: 'text', index: 0 }, { type: 'text-delta', text, index: 0 },
    { type: 'block-end', index: 0, block: { type: 'text', text } }, { type: 'finish', reason: { kind: finish } }];
}

test('title input is a bounded JSON prefix for long CJK, emoji, escapes, and controls', () => {
  for (const question of ['问题'.repeat(10000), '😀'.repeat(10000), '\u0000'.repeat(10000), '"\\'.repeat(10000)]) {
    const input = titleInput(question);
    assert.ok(Buffer.byteLength(input) <= 8192);
    const value = JSON.parse(input);
    assert.deepEqual(Object.keys(value), ['question']);
    assert.ok(question.startsWith(value.question));
    assert.ok(!/[\ud800-\udbff]$/.test(value.question));
  }
});

test('pending AI title accepts a single plain heading and receives no inherited chat or tools', async () => {
  const f = pendingFixture(textChunks('**修复旁支跳转**\nAn explanation that must not enter the title'));
  const result = await retitleSide(f.ctx, f.agent, new AbortController().signal);
  assert.equal(result.status, 'ai');
  assert.equal(f.title(), '修复旁支跳转');
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].purpose, 'session-title');
  assert.equal(f.requests[0].tools, undefined);
  assert.deepEqual(JSON.parse(f.requests[0].messages[0].content[0].text), { question: '修复旁支转换后的自动跳转' });
});

test('empty and token-limited AI output use the last question fallback', async () => {
  for (const chunks of [textChunks(''), textChunks('Incomplete', 'max-tokens')]) {
    const f = pendingFixture(chunks);
    const result = await retitleSide(f.ctx, f.agent, new AbortController().signal);
    assert.equal(result.status, 'fallback');
    assert.equal(f.title(), '修复旁支转换后的自动跳转');
  }
});

test('title model tool-call output is rejected without executing any tools', async () => {
  const f = pendingFixture([
    { type: 'block-start', blockType: 'tool-call', index: 0 },
    { type: 'tool-call-delta', index: 0, id: 'call', name: 'unwanted', argumentsDelta: '{}' },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'call', name: 'unwanted', arguments: '{}' } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]);
  const result = await retitleSide(f.ctx, f.agent, new AbortController().signal);
  assert.equal(result.status, 'fallback');
  assert.equal(f.title(), '修复旁支转换后的自动跳转');
});
