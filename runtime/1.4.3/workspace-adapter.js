// Generated from TypeScript by npm run build. Edit src/, not this file.

// src/host/workspace-adapter.ts
var WORKSPACE_ID = "@deepseek-ai/dsh-client-ui-workspace";
var REVISION = "1.4.0";
var MARKER = "codex_side_view";
function isTemporarySideSummary(session) {
  if (typeof session !== "object" || session === null) return false;
  const summary = session;
  const projections = summary.projectionValues;
  const side = typeof projections === "object" && projections !== null ? projections["local.codexSide.v1"] : void 0;
  if (side && typeof side === "object") {
    const state = side;
    return Boolean(state.parentId) && state.permanent !== true;
  }
  return typeof summary.id === "string" && /^side-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(summary.id);
}
function patchWorkspaceSource(source) {
  const pattern = /function sessionVisible\(session, current, archived, archivedFilter\) \{\s*if \(session\.origin === "subagent"\) return false;/g;
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1) throw new Error("Unsupported Harness workspace browser: /side requires exactly one known sessionVisible entry.");
  const predicate = isTemporarySideSummary.toString().replace(/\/\/[^\n]*/g, "").replace(/\n\s*/g, " ");
  return source.replace(pattern, (match) => match.replace("{", `{ if ((${predicate})(session)) return false;`));
}
function hasWorkspace(reference) {
  try {
    return decodeURIComponent(reference).includes(WORKSPACE_ID);
  } catch {
    return false;
  }
}
function stampWorkspaceUrls(html) {
  return html.replace(/\/?plugins\/\?\?[^\s"'<>]+/g, (reference) => {
    if (!hasWorkspace(reference) || reference.includes(MARKER + "=")) return reference;
    const amp = reference.includes("&amp;") ? "&amp;" : reference.includes("\\u0026") ? "\\u0026" : "&";
    return reference + amp + MARKER + "=" + REVISION;
  });
}
function createWorkspaceResource(clientModules) {
  return async (request) => {
    const originalUrl = request.url.replace(/&codex_side_view=[^&]*/g, "");
    if (!hasWorkspace(originalUrl)) return clientModules.fetchBundle(new Request(originalUrl, { method: request.method, headers: request.headers, signal: request.signal }));
    const headers = new Headers(request.headers);
    headers.delete("if-none-match");
    headers.delete("if-modified-since");
    const response = await clientModules.fetchBundle(new Request(originalUrl, {
      method: request.method === "HEAD" ? "GET" : request.method,
      headers,
      signal: request.signal
    }));
    if (!response.ok || !response.headers.get("content-type")?.includes("javascript")) {
      return request.method === "HEAD" ? new Response(null, { status: response.status, headers: response.headers }) : response;
    }
    const source = patchWorkspaceSource(await response.text());
    const outputHeaders = new Headers(response.headers);
    outputHeaders.delete("etag");
    outputHeaders.delete("last-modified");
    outputHeaders.set("cache-control", "no-store");
    outputHeaders.set("content-length", String(Buffer.byteLength(source)));
    outputHeaders.set("x-codex-side-visibility", REVISION);
    return new Response(request.method === "HEAD" ? null : source, { status: response.status, headers: outputHeaders });
  };
}
async function installWorkspaceAdapter(ctx) {
  const entry = ctx.clientModules.graph().entries.find((entry2) => entry2.id === WORKSPACE_ID);
  if (!entry) throw new Error("Harness workspace Client package is unavailable.");
  const response = await ctx.clientModules.fetchBundle(new Request(new URL(entry.url, ctx.webServer.getOrigin() + "/")));
  if (!response.ok) throw new Error("Cannot read the native Harness workspace Client bundle.");
  patchWorkspaceSource(await response.text());
  ctx.effect(() => ctx.webServer.register({ kind: "exact", path: "/plugins/", resource: createWorkspaceResource(ctx.clientModules) }));
  ctx.effect(() => ctx.webServer.tapIndex(stampWorkspaceUrls));
}
export {
  createWorkspaceResource,
  installWorkspaceAdapter,
  isTemporarySideSummary,
  patchWorkspaceSource,
  stampWorkspaceUrls
};
