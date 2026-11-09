import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { runtimeFile } from './runtime.js';

// Invoke the actual callback injected into the native tab registration. No
// React component, owner hook, or substitute browser is rendered in this test.
async function fixture(t, options = {}) {
  let plugin;
  let promote;
  let onClose;
  let mounted = 'parent';
  let childId = 'child';
  const controller = new AbortController();
  const events = [];
  const cleanups = [];
  const noop = () => {};
  vm.runInNewContext(await readFile(runtimeFile('client.js'), 'utf8'), {
    AbortController,
    window: { __ModuleLoader__: { load(entry) {
      plugin = entry.factory(name => {
        assert.equal(name, 'react');
        return { createElement() { throw new Error('This test does not render React'); } };
      });
    } } },
  });
  const binding = {
    session: { projections: { faceOf: () => ({ getSnapshot: () => ({ childId }) }) } },
    ctx: { remote: { commands: { async execute(line) {
      events.push(line);
      if (line.includes('--keep')) {
        if (options.gate) await options.gate;
        if (options.commandError) return { ok: false, error: { message: options.commandError } };
      }
      return { ok: true, value: { result: { kind: 'success', text: 'done' } } };
    } } } },
  };
  plugin.apply({
    effect(callback) { const cleanup = callback(); cleanups.push(cleanup); return cleanup; },
    locale: { register: () => noop, bind: () => key => key },
    uiConversation: { events: { register: () => noop } },
    sidebarRightTabs: { register: () => noop },
    sidebarRight: {
      mounted: { getSnapshot: () => mounted },
      registerCloseHandler(kind, handler) { assert.equal(kind, 'codex-side'); onClose = handler; return noop; },
    },
    uiWorkspace: { openSession(id) { events.push('open:' + id); mounted = id; } },
    sessions: {
      binding: id => id === 'parent' ? binding : undefined,
      async refresh() { events.push('refresh'); if (options.refreshError) throw new Error(options.refreshError); },
      retain(id, source) {
        assert.equal(source.source, 'controllerOperation');
        events.push('hold:' + id);
        return { release() { events.push('release:' + id); } };
      },
    },
    slots: {
      inject(name, callback) { callback(); return noop; },
      register(definition) {
        if (definition.name === 'sidebar.right.pane.tab') promote = definition.inject().promoteAndOpen;
        return noop;
      },
    },
  });
  t.after(() => { for (const cleanup of cleanups.reverse()) cleanup?.(); });
  const tab = { signal: controller.signal, actions: { close() {
    events.push('close');
    if (options.closeError) throw new Error(options.closeError);
    onClose('parent');
    controller.abort();
  } } };
  return { events, run: () => promote('parent', 'child', tab), onClose,
    select: id => { mounted = id; }, replaceSide: id => { childId = id; }, abortTab: () => controller.abort() };
}

test('button callback waits for conversion, closes just the side tab, then opens the same permanent Session', async t => {
  let release;
  const f = await fixture(t, { gate: new Promise(resolve => { release = resolve; }) });
  const operation = f.run();
  assert.deepEqual(f.events, ['/side --keep child']);
  release();
  await operation;
  assert.deepEqual(f.events, ['/side --keep child', 'refresh', 'hold:child', 'close', 'open:child', 'release:child']);
  assert.equal(f.events.includes('/side --close'), false, 'stale temporary Client metadata must not run archive cleanup on handoff');
});

test('conversion or catalogue failure preserves the tab and selection', async t => {
  for (const options of [{ commandError: 'conversion failed' }, { refreshError: 'connection lost' }]) {
    const f = await fixture(t, options);
    await assert.rejects(f.run(), new RegExp(options.commandError ?? options.refreshError));
    assert.ok(!f.events.includes('close'));
    assert.ok(!f.events.includes('open:child'));
    assert.ok(!f.events.includes('hold:child'));
  }
});

test('a manually ended tab or a replacement side supersedes the pending handoff', async t => {
  for (const change of [f => f.abortTab(), f => f.replaceSide('new-side')]) {
    let release;
    const f = await fixture(t, { gate: new Promise(resolve => { release = resolve; }) });
    const operation = f.run();
    change(f); release();
    await operation;
    assert.deepEqual(f.events, ['/side --keep child', 'refresh']);
  }
});

test('later navigation keeps its selection while the original scoped side tab closes', async t => {
  let release;
  const f = await fixture(t, { gate: new Promise(resolve => { release = resolve; }) });
  const operation = f.run();
  f.select('another-conversation'); release();
  await operation;
  assert.deepEqual(f.events, ['/side --keep child', 'refresh', 'hold:child', 'close', 'release:child']);
});

test('close failure releases the handoff reference and restores ordinary close cleanup', async t => {
  const f = await fixture(t, { closeError: 'close failed' });
  await assert.rejects(f.run(), /close failed/);
  assert.equal(f.events.at(-1), 'release:child');
  assert.ok(!f.events.includes('open:child'));
  f.onClose('parent');
  assert.equal(f.events.at(-1), '/side --close', 'temporary manual closes must still stop and archive normally');
});
