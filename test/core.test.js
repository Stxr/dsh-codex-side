import test from 'node:test';
import assert from 'node:assert/strict';
import { importRuntime } from './runtime.js';
const { fold, initState, initTranscriptState, metadataView, transcriptView, parseInput, KEY, TRANSCRIPT_KEY, MARKER, RESULT, SIDE_POLICY, isTemporary, blockSideTool, keyedQueue } = await importRuntime('core.js');
const event = (type, seq, data) => ({ type, seq, time: seq, data });
const row = (role, text, id = role) => ({ id, role, content: [{ type: 'text', text }] });

test('command grammar preserves multiline questions and literal control words', () => {
  assert.deepEqual(parseInput(''), { action: 'open', question: '' });
  assert.deepEqual(parseInput('为什么\n这样设计？'), { action: 'ask', question: '为什么\n这样设计？' });
  assert.equal(parseInput('close').question, 'close');
  assert.equal(parseInput('--ask --close').question, '--close');
  assert.equal(parseInput('--new 为什么').action, 'new');
  assert.equal(parseInput('--close').action, 'close');
  assert.throws(() => parseInput('--ask'));
});

test('--keep parses an optional expected child id without consuming question text', () => {
  assert.deepEqual(parseInput('--keep'), { action: 'keep', question: '' });
  assert.deepEqual(parseInput('  --keep side-expected_123  '), { action: 'keep', question: '', childId: 'side-expected_123' });
  assert.deepEqual(parseInput('--ask --keep'), { action: 'ask', question: '--keep' });
  assert.deepEqual(parseInput('--keeper'), { action: 'ask', question: '--keeper' });
});

test('only an unconverted child is temporary; promotion keeps its origin', () => {
  const parent = initState({ id: 'main' });
  assert.equal(parent.permanent, false);
  assert.equal(parent.promotedId, null);
  assert.equal(isTemporary(parent), false);
  const child = fold(initState({ id: 'child' }), event('developer/message', 0, {
    message: row('developer', MARKER + '{"parentId":"main"}'),
  }));
  assert.equal(isTemporary(child), true);
  assert.equal(isTemporary({ ...child, permanent: true }), false);
});

test('inherited commands and messages never become the side transcript or active child', () => {
  const state = initState({ id: 'child' }, 100);
  const before = event('user/message', 20, row('user', 'Continue editing files'));
  assert.equal(fold(state, before), state);
  assert.equal(fold(state, event('command/run', 21, { name: 'side', commandId: 'old' })), state);
  const boundary = fold(state, event('developer/message', 101, { message: row('developer', MARKER + '{"parentId":"main"}\n' + SIDE_POLICY) }));
  assert.equal(boundary.parentId, 'main');
  assert.equal(boundary.childId, null);
  assert.equal(boundary.messages.length, 0);
  const updated = fold(boundary, event('user/message', 102, row('user', 'Explain the current task')));
  const answered = fold(updated, event('assistant/message', 104, { message: row('assistant', 'Explanation') }));
  assert.deepEqual(answered.messages.map(m => m.text), ['Explain the current task', 'Explanation']);
});

test('only matching successful side command lifecycle changes parent side link', () => {
  let s = initState({ id: 'main' });
  s = fold(s, event('command/run', 1, { name: 'side', commandId: 'cmd' }));
  const arbitrary = fold(s, event('command/done', 2, { commandId: 'other', kind: 'success', text: RESULT + '{"parentId":"main","childId":"bad"}' }));
  assert.equal(arbitrary, s);
  s = fold(s, event('command/done', 2, { commandId: 'cmd', kind: 'success', text: RESULT + '{"parentId":"main","childId":"side-a"}' }));
  assert.equal(s.childId, 'side-a');
  assert.equal(s.revision, 1);
  assert.deepEqual(s.messages, []);
  s = fold(s, event('command/run', 3, { name: 'side', commandId: 'cmd2' }));
  s = fold(s, event('command/done', 4, { commandId: 'cmd2', kind: 'error', text: 'Cannot close' }));
  assert.equal(s.childId, 'side-a');
  assert.equal(s.error, 'Cannot close');
  s = fold(s, event('command/run', 5, { name: 'side', commandId: 'cmd3' }));
  s = fold(s, event('command/done', 6, { commandId: 'cmd3', kind: 'success', text: RESULT + '{"parentId":"main","childId":null}' }));
  assert.equal(s.childId, null);
  assert.equal(s.error, null);
});

test('keep detaches without expanding, retains the converted view, and a new side clears it', () => {
  let s = initState({ id: 'main' });
  let seq = 0;
  const complete = result => {
    const commandId = `command-${seq}`;
    s = fold(s, event('command/run', seq++, { name: 'side', commandId }));
    s = fold(s, event('command/done', seq++, {
      commandId, kind: 'success', text: RESULT + JSON.stringify({ parentId: 'main', ...result }),
    }));
  };
  complete({ action: 'open', childId: 'side-a' });
  const revision = s.revision;
  complete({ action: 'keep', childId: null, promotedId: 'side-a' });
  assert.equal(s.childId, null);
  assert.equal(s.promotedId, 'side-a');
  assert.equal(s.revision, revision, 'conversion must not reopen a user-collapsed sidebar');
  for (const action of ['status', 'stop', 'close', 'keep']) {
    complete({ action, childId: null, ...(action === 'keep' ? { promotedId: 'side-a' } : {}) });
    assert.equal(s.promotedId, 'side-a', action);
    assert.equal(s.revision, revision, action);
  }
  complete({ action: 'open', childId: 'side-b' });
  assert.equal(s.childId, 'side-b');
  assert.equal(s.promotedId, null);
  assert.equal(s.revision, revision + 1);
});

test('a matched child promotion lifecycle preserves transcript and origin across replay', () => {
  let s = initState({ id: 'child' }, 10);
  s = fold(s, event('developer/message', 10, { message: row('developer', MARKER + '{"parentId":"main"}') }));
  s = fold(s, event('user/message', 11, row('user', 'A side question')));
  s = fold(s, event('assistant/message', 12, { message: row('assistant', 'A useful answer') }));
  const before = s;
  const result = RESULT + '{"parentId":"child","childId":null,"action":"promoted"}';
  s = fold(s, event('command/done', 13, { commandId: 'unmatched', kind: 'success', text: result }));
  assert.equal(s, before);
  s = fold(s, event('command/run', 14, { name: 'side', commandId: 'promote' }));
  s = fold(s, event('command/done', 15, { commandId: 'promote', kind: 'success', text: result }));
  assert.equal(s.permanent, true);
  assert.equal(isTemporary(s), false);
  assert.equal(s.parentId, 'main');
  assert.equal(s.childId, null);
  assert.equal(s.boundary, before.boundary);
  assert.equal(s.revision, before.revision);
  assert.deepEqual(s.messages, before.messages);
  assert.deepEqual(s.sideCommands, []);
});

test('non-side events preserve projection identity and transcript is bounded', () => {
  let s = initState({ id: 'main' });
  assert.equal(fold(s, event('tool/call', 1, {})), s);
  s = fold(s, event('developer/message', 2, { message: row('developer', MARKER + '{"parentId":"main"}') }));
  for (let i = 0; i < 100; i++) s = fold(s, event('user/message', i + 3, row('user', String(i), String(i))));
  assert.equal(s.messages.length, 80);
  assert.equal(s.messages[0].text, '20');
});

test('summary metadata retains the original key and excludes transcript and checkpoint internals', () => {
  assert.equal(KEY, 'local.codexSide.v1');
  assert.equal(TRANSCRIPT_KEY, 'local.codexSide.transcript.v1');
  let state = fold(initState({ id: 'child' }, 10), event('developer/message', 10, {
    message: row('developer', MARKER + '{"parentId":"main"}'),
  }));
  state = fold(state, event('user/message', 11, row('user', 'Private transcript text')));
  state = fold(state, event('command/run', 12, { name: 'side', commandId: 'pending' }));
  state = fold(state, event('turn/end', 13, { reason: { kind: 'completed' } }));
  assert.deepEqual(metadataView(state), {
    sessionId: 'child', parentId: 'main', childId: null, permanent: false,
    promotedId: null, revision: 0, error: null, ended: 'completed',
  });
  assert.equal(state.messages.length, 1, 'legacy v4 checkpoint state retains its transcript');
  assert.deepEqual(state.sideCommands, ['pending']);
});

test('the separate transcript ignores inherited history and bounds its own state and view to four messages', () => {
  const header = { id: 'child' };
  let transcript = initTranscriptState(header, 100);
  assert.equal(fold(transcript, event('user/message', 99, row('user', 'Inherited main instruction'))), transcript);
  assert.equal(fold(transcript, event('user/message', 100, row('user', 'No side boundary yet'))), transcript);
  const boundary = event('developer/message', 101, { message: row('developer', MARKER + '{"parentId":"main"}') });
  transcript = fold(transcript, boundary);
  let full = fold(initState(header, 100), boundary);
  for (let i = 0; i < 100; i++) {
    const next = i % 2 === 0
      ? event('user/message', 102 + i, row('user', String(i), `message-${i}`))
      : event('assistant/message', 102 + i, { message: row('assistant', String(i), `message-${i}`) });
    transcript = fold(transcript, next);
    full = fold(full, next);
    assert.ok(transcript.messages.length <= 4, 'the dedicated projection state must remain bounded during replay');
  }
  assert.deepEqual(transcript.messages.map(message => message.text), ['96', '97', '98', '99']);
  assert.deepEqual(transcriptView(transcript).messages.map(message => message.text), ['96', '97', '98', '99']);
  assert.equal(full.messages.length, 80, 'the original v4 state remains compatible with existing checkpoints');
  assert.equal(full.messages[0].text, '20');
  assert.equal(Object.hasOwn(metadataView(full), 'messages'), false);
});

test('transcript view limits message text without changing stored answers and survives promotion', () => {
  let state = fold(initTranscriptState({ id: 'child' }), event('developer/message', 0, {
    message: row('developer', MARKER + '{"parentId":"main"}'),
  }));
  state = fold(state, event('user/message', 1, row('user', 'q'.repeat(6000))));
  state = fold(state, event('assistant/message', 2, { message: row('assistant', 'a'.repeat(6001)) }));
  state = fold(state, event('turn/end', 3, { reason: { kind: 'error', error: { message: 'Answer interrupted' } } }));
  const before = structuredClone(state.messages);
  const view = transcriptView(state);
  assert.deepEqual(view, {
    ended: 'Answer interrupted',
    messages: [
      { id: 'user', role: 'user', text: 'q'.repeat(6000), truncated: false },
      { id: 'assistant', role: 'assistant', text: 'a'.repeat(6000), truncated: true },
    ],
  });
  assert.deepEqual(state.messages, before);
  state = fold(state, event('command/run', 4, { name: 'side', commandId: 'side-op-promote' }));
  state = fold(state, event('command/done', 5, {
    commandId: 'side-op-promote', kind: 'success',
    text: RESULT + '{"parentId":"child","childId":null,"action":"promoted"}',
  }));
  assert.equal(state.permanent, true);
  assert.deepEqual(transcriptView(state), view);
});

test('side tools block delegation and worktrees, leave ordinary exploration available', () => {
  for (const name of ['subagent', 'subagent_fork', 'send_message', 'interrupt_agent', 'create_worktree', 'workflow', 'side_conversation', 'create_goal', 'schedule_create']) assert.equal(blockSideTool(name), true, name);
  for (const name of ['read', 'grep', 'glob', 'bash', 'web_fetch', 'web_search']) assert.equal(blockSideTool(name), false, name);
  assert.match(SIDE_POLICY, /Only user messages submitted after that boundary/);
  assert.match(SIDE_POLICY, /unless the user explicitly requests that mutation/);
});

test('operations serialize per parent, remain independent and recover after failure', async () => {
  const enqueue = keyedQueue();
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  const order = [];
  const a = enqueue('main', async () => { order.push('start'); await blocked; throw new Error('expected'); });
  const b = enqueue('main', async () => { order.push('after'); return 2; });
  assert.equal(await enqueue('other', async () => 3), 3);
  assert.deepEqual(order, ['start']);
  release();
  await assert.rejects(a, /expected/);
  assert.equal(await b, 2);
  assert.deepEqual(order, ['start', 'after']);
});
