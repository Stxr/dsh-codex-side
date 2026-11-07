import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { isInternalCommandId } from '../core.js';

// Exercise the shipped plain-JS Client registration; no React component is
// mounted and this is not a visual/browser test.
async function internalDefinition(t) {
  let plugin;
  const definitions = [];
  const cleanups = [];
  const noop = () => {};
  vm.runInNewContext(await readFile(new URL('../client.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load(entry) {
      plugin = entry.factory(name => {
        assert.equal(name, 'react');
        return { createElement() { throw new Error('This test must not render React'); } };
      });
    } } },
  });
  plugin.apply({
    effect(callback) { const cleanup = callback(); cleanups.push(cleanup); return cleanup; },
    locale: { register: () => noop, bind: () => key => key },
    uiConversation: { events: { register(definition) { definitions.push(definition); return noop; } } },
    sidebarRightTabs: { register: () => noop },
    sidebarRight: { registerCloseHandler: () => noop },
    slots: { inject: () => noop },
  });
  t.after(() => { for (const cleanup of cleanups.reverse()) cleanup?.(); });
  assert.equal(definitions.length, 1);
  assert.equal(definitions[0].target, 'chat');
  return definitions[0];
}

test('internal state commands produce no Chat node, including done-only historical windows', async t => {
  const definition = await internalDefinition(t);
  for (const type of ['command/run', 'command/done']) {
    const id = 'side-op-a-persisted-legacy-id';
    const match = definition.match({ type, data: { commandId: id, name: 'side', kind: 'success' } });
    assert.equal(isInternalCommandId(id), true);
    assert.equal(match.id, id);
    assert.equal(match.role, type === 'command/run' ? 'start' : 'update');
    assert.equal(match.exclusive, true, 'the native command definition and fallback must not build a duplicate');
    assert.equal(definition.buildViewNode(), null);
  }
  const state = {};
  assert.equal(definition.update({ state }), state);
});

test('real side commands, their failures and unrelated events remain owned by native Chat', async t => {
  const definition = await internalDefinition(t);
  for (const type of ['command/run', 'command/done']) {
    for (const id of ['human-command-id', 'side-op', '', undefined]) {
      assert.equal(definition.match({ type, data: { commandId: id, name: 'side', kind: 'error', text: 'Actual operation failed' } }), null);
    }
  }
  assert.equal(definition.match({ type: 'assistant/message', data: { commandId: 'side-op-not-a-command' } }), null);
});
