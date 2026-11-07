const WORKSPACE_ID = '@deepseek-ai/dsh-client-ui-workspace';
const REVISION = '1.4.0';
const MARKER = 'codex_side_view';

// Kept self-contained because this predicate is inserted into the native
// browser's shared visibility function. It never changes the Session catalogue.
export function isTemporarySideSummary(session) {
  const side = session.projectionValues?.['local.codexSide.v1'];
  if (side) return Boolean(side.parentId) && side.permanent !== true;
  // The header may arrive before its first projection checkpoint. Reserve only
  // this plugin's exact UUID form; metadata reads resolve old permanent rows.
  return /^side-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(session.id);
}

export function patchWorkspaceSource(source) {
  const pattern = /function sessionVisible\(session, current, archived, archivedFilter\) \{\s*if \(session\.origin === "subagent"\) return false;/g;
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1) throw new Error('Unsupported Harness workspace browser: /side requires exactly one known sessionVisible entry.');
  const predicate = isTemporarySideSummary.toString().replace(/\/\/[^\n]*/g, '').replace(/\n\s*/g, ' ');
  return source.replace(pattern, match => match.replace('{', `{ if ((${predicate})(session)) return false;`));
}

function hasWorkspace(reference) {
  try { return decodeURIComponent(reference).includes(WORKSPACE_ID); } catch { return false; }
}

export function stampWorkspaceUrls(html) {
  // Cover both the serialized boot graph and HTML preload attributes. Do not
  // mutate graph/service objects or any unrelated script's cache identity.
  return html.replace(/\/?plugins\/\?\?[^\s"'<>]+/g, reference => {
    if (!hasWorkspace(reference) || reference.includes(MARKER + '=')) return reference;
    const amp = reference.includes('&amp;') ? '&amp;' : reference.includes('\\u0026') ? '\\u0026' : '&';
    return reference + amp + MARKER + '=' + REVISION;
  });
}

export function createWorkspaceResource(clientModules) {
  return async request => {
    const originalUrl = request.url.replace(/&codex_side_view=[^&]*/g, '');
    const workspace = hasWorkspace(originalUrl);
    if (!workspace) return clientModules.fetchBundle(new Request(originalUrl, { method: request.method, headers: request.headers, signal: request.signal }));
    const headers = new Headers(request.headers);
    headers.delete('if-none-match');
    headers.delete('if-modified-since');
    const response = await clientModules.fetchBundle(new Request(originalUrl, {
      method: request.method === 'HEAD' ? 'GET' : request.method, headers, signal: request.signal,
    }));
    if (!response.ok || !response.headers.get('content-type')?.includes('javascript')) {
      return request.method === 'HEAD' ? new Response(null, { status: response.status, headers: response.headers }) : response;
    }
    const source = patchWorkspaceSource(await response.text());
    const outputHeaders = new Headers(response.headers);
    outputHeaders.delete('etag');
    outputHeaders.delete('last-modified');
    outputHeaders.set('cache-control', 'no-store');
    outputHeaders.set('content-length', String(Buffer.byteLength(source)));
    outputHeaders.set('x-codex-side-visibility', REVISION);
    return new Response(request.method === 'HEAD' ? null : source, { status: response.status, headers: outputHeaders });
  };
}

export async function installWorkspaceAdapter(ctx) {
  // This DSH release has no list-visibility extension. Add just the predicate at
  // the HTTP resource boundary; retain the native browser, grouping, search,
  // permissions and complete Session catalogue. No application file is edited.
  const entry = ctx.clientModules.graph().entries.find(entry => entry.id === WORKSPACE_ID);
  if (!entry) throw new Error('Harness workspace Client package is unavailable.');
  const response = await ctx.clientModules.fetchBundle(new Request(new URL(entry.url, ctx.webServer.getOrigin() + '/')));
  if (!response.ok) throw new Error('Cannot read the native Harness workspace Client bundle.');
  patchWorkspaceSource(await response.text());
  // Native /plugins/ is a prefix route. The public exact route wins for combos;
  // nested package assets and chunks continue through their original owner.
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/plugins/', resource: createWorkspaceResource(ctx.clientModules) }));
  ctx.effect(() => ctx.webServer.tapIndex(stampWorkspaceUrls));
}
