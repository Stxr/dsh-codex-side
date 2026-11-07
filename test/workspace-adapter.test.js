import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { isTemporarySideSummary, patchWorkspaceSource, stampWorkspaceUrls, createWorkspaceResource, installWorkspaceAdapter } from '../workspace-adapter.js';

// Exact native visibility signature and archive semantics of the supported
// release. Tests exercise the resource adapter, not a fabricated visual page.
const native = `function sessionVisible(session, current, archived, archivedFilter) {
  if (session.origin === "subagent") return false;
  if (session.blank && session.id !== current) return false;
  switch (archivedFilter) {
    case "default": return !archived.has(session.id);
    case "show": return true;
    case "only": return archived.has(session.id);
    default: throw new Error('unknown archive mode');
  }
}`;
const sideId = 'side-11111111-2222-4333-8444-555555555555';
const row = side => ({ id: sideId, blank: false, projectionValues: { 'local.codexSide.v1': side } });
const sourceUrl = 'http://127.0.0.1/plugins/??%40deepseek-ai%2Fdsh-client-ui-workspace&rev=abc';

test('temporary and pending plugin sides stay hidden while permanent and ordinary sessions remain', () => {
  assert.equal(isTemporarySideSummary(row({ parentId: 'main', permanent: false })), true);
  assert.equal(isTemporarySideSummary(row({ parentId: 'main', permanent: true })), false);
  assert.equal(isTemporarySideSummary(row({ parentId: null, permanent: false })), false);
  assert.equal(isTemporarySideSummary({ id: sideId }), true, 'a header arriving before metadata cannot flash in the list');
  assert.equal(isTemporarySideSummary({ id: 'side-user-notes' }), false);
  assert.equal(isTemporarySideSummary({ id: 'session-normal' }), false);
});

test('one native predicate filters temporary rows in every archive mode without replacing native rules', () => {
  const visible = vm.runInNewContext(`(${patchWorkspaceSource(native)})`);
  for (const mode of ['default', 'show', 'only']) {
    assert.equal(visible(row({ parentId: 'main', permanent: false }), null, new Set([sideId]), mode), false);
    assert.equal(visible({ id: sideId }, null, new Set(), mode), false);
  }
  const permanent = row({ parentId: 'main', permanent: true });
  assert.equal(visible(permanent, null, new Set(), 'default'), true);
  assert.equal(visible(permanent, null, new Set([sideId]), 'default'), false);
  assert.equal(visible(permanent, null, new Set([sideId]), 'only'), true);
  assert.equal(visible({ id: 'native-child', origin: 'subagent' }, null, new Set(), 'show'), false);
  assert.equal(visible({ id: 'blank', blank: true }, 'other', new Set(), 'default'), false);
  assert.equal(visible({ id: 'blank', blank: true }, 'blank', new Set(), 'default'), true);
});

test('unknown or duplicated native signatures fail explicitly instead of changing arbitrary code', () => {
  assert.throws(() => patchWorkspaceSource('function differentBrowser() {}'), /exactly one known/);
  assert.throws(() => patchWorkspaceSource(native + native), /exactly one known/);
});

test('index cache identity changes only for workspace bundles and remains valid in HTML and JSON', () => {
  const workspace = sourceUrl.replace('http://127.0.0.1/', '');
  const unrelated = 'plugins/??react&rev=r';
  const html = `<link href="${workspace.replaceAll('&', '&amp;')}"><script>const graph=${JSON.stringify({ url: workspace, other: unrelated })}</script>`;
  const patched = stampWorkspaceUrls(html);
  assert.ok(patched.includes('&amp;codex_side_view=1.4.0'));
  assert.ok(patched.includes('&codex_side_view=1.4.0'));
  assert.ok(patched.includes(`"other":"${unrelated}"`));
  assert.equal(stampWorkspaceUrls(patched), patched);
  const escaped = JSON.stringify({ url: workspace }).replaceAll('&', '\\u0026');
  assert.ok(JSON.parse(stampWorkspaceUrls(escaped)).url.endsWith('&codex_side_view=1.4.0'));
});

test('workspace HTTP responses preserve exact native URLs and avoid stale validators for modified code', async () => {
  const reads = [];
  const resource = createWorkspaceResource({ async fetchBundle(request) {
    reads.push(request);
    return new Response(native, { headers: { 'content-type': 'text/javascript', etag: 'native-rev', 'cache-control': 'immutable', 'x-content-type-options': 'nosniff' } });
  } });
  const response = await resource(new Request(sourceUrl + '&codex_side_view=1.4.0', { headers: { 'if-none-match': 'native-rev' } }));
  assert.equal(reads[0].url, sourceUrl);
  assert.equal(reads[0].headers.get('if-none-match'), null);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('etag'), null);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('x-codex-side-visibility'), '1.4.0');
  assert.ok((await response.text()).includes('local.codexSide.v1'));
  const head = await resource(new Request(sourceUrl, { method: 'HEAD' }));
  assert.equal(await head.text(), '');
  assert.equal(head.headers.get('x-codex-side-visibility'), '1.4.0');
  const otherResponse = new Response('other-module');
  const other = createWorkspaceResource({ fetchBundle: async request => { assert.ok(request.url.includes('react')); return otherResponse; } });
  assert.equal(await other(new Request('http://127.0.0.1/plugins/??react&rev=r')), otherResponse);
  const mapResponse = new Response('{}', { headers: { 'content-type': 'application/json' } });
  const map = createWorkspaceResource({ fetchBundle: async () => mapResponse });
  assert.equal(await map(new Request(sourceUrl + '&map')), mapResponse);
});

test('the adapter preflights native code and owns only an exact combo route and index transform', async t => {
  const registered = [];
  const taps = [];
  const cleanups = [];
  const ctx = {
    clientModules: { graph: () => ({ entries: [{ id: '@deepseek-ai/dsh-client-ui-workspace', url: sourceUrl }] }), fetchBundle: async () => new Response(native) },
    webServer: { getOrigin: () => 'http://127.0.0.1', register(route) { registered.push(route); return () => registered.pop(); }, tapIndex(tap) { taps.push(tap); return () => taps.pop(); } },
    effect(callback) { const cleanup = callback(); cleanups.push(cleanup); return cleanup; },
  };
  t.after(() => { for (const cleanup of cleanups.reverse()) cleanup(); });
  await installWorkspaceAdapter(ctx);
  assert.equal(registered.length, 1);
  assert.equal(registered[0].kind, 'exact');
  assert.equal(registered[0].path, '/plugins/');
  assert.equal(taps[0], stampWorkspaceUrls);
});
