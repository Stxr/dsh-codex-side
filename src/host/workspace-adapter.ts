import type { ClientModules, WorkspaceAdapterContext } from './types.js';

const WORKSPACE_ID = '@deepseek-ai/dsh-client-ui-workspace';
const REVISION = '1.4.0';
const MARKER = 'codex_side_view';

/** 此函数会以源码插入原生浏览器，必须保持闭包无外部依赖。 */
export function isTemporarySideSummary(session: unknown): boolean {
  if (typeof session !== 'object' || session === null) return false;
  const summary = session as Record<string, unknown>;
  const projections = summary.projectionValues;
  const side = typeof projections === 'object' && projections !== null
    ? (projections as Record<string, unknown>)['local.codexSide.v1'] : undefined;
  if (side && typeof side === 'object') {
    const state = side as Record<string, unknown>;
    return Boolean(state.parentId) && state.permanent !== true;
  }
  // 首个投影 checkpoint 可能晚于 header，只预留本插件的精确 UUID 格式。
  return typeof summary.id === 'string' && /^side-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(summary.id);
}

export function patchWorkspaceSource(source: string): string {
  const pattern = /function sessionVisible\(session, current, archived, archivedFilter\) \{\s*if \(session\.origin === "subagent"\) return false;/g;
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1) throw new Error('Unsupported Harness workspace browser: /side requires exactly one known sessionVisible entry.');
  const predicate = isTemporarySideSummary.toString().replace(/\/\/[^\n]*/g, '').replace(/\n\s*/g, ' ');
  return source.replace(pattern, match => match.replace('{', `{ if ((${predicate})(session)) return false;`));
}

function hasWorkspace(reference: string): boolean {
  try { return decodeURIComponent(reference).includes(WORKSPACE_ID); } catch { return false; }
}

export function stampWorkspaceUrls(html: string): string {
  // 同时覆盖 boot graph 和 HTML preload，不修改原 graph/service 对象。
  return html.replace(/\/?plugins\/\?\?[^\s"'<>]+/g, reference => {
    if (!hasWorkspace(reference) || reference.includes(MARKER + '=')) return reference;
    const amp = reference.includes('&amp;') ? '&amp;' : reference.includes('\\u0026') ? '\\u0026' : '&';
    return reference + amp + MARKER + '=' + REVISION;
  });
}

export function createWorkspaceResource(clientModules: Pick<ClientModules, 'fetchBundle'>) {
  return async (request: Request): Promise<Response> => {
    const originalUrl = request.url.replace(/&codex_side_view=[^&]*/g, '');
    if (!hasWorkspace(originalUrl)) return clientModules.fetchBundle(new Request(originalUrl, { method: request.method, headers: request.headers, signal: request.signal }));
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

export async function installWorkspaceAdapter(ctx: WorkspaceAdapterContext): Promise<void> {
  // 此宿主版本没有列表可见性注册点；只在公开 HTTP 边界加判断，保留原生目录。
  const entry = ctx.clientModules.graph().entries.find(entry => entry.id === WORKSPACE_ID);
  if (!entry) throw new Error('Harness workspace Client package is unavailable.');
  const response = await ctx.clientModules.fetchBundle(new Request(new URL(entry.url, ctx.webServer.getOrigin() + '/')));
  if (!response.ok) throw new Error('Cannot read the native Harness workspace Client bundle.');
  patchWorkspaceSource(await response.text());
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/plugins/', resource: createWorkspaceResource(ctx.clientModules) }));
  ctx.effect(() => ctx.webServer.tapIndex(stampWorkspaceUrls));
}
