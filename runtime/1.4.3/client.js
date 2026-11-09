// Generated from TypeScript by npm run build. Edit src/, not this file.
window.__ModuleLoader__.load({
  id: "@local/dsh-codex-side",
  factory(require) {
    const module = { exports: {} };
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.tsx
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);

// src/shared/protocol.ts
var KEY = "local.codexSide.v1";
var isInternalCommandId = (id) => typeof id === "string" && id.startsWith("side-op-");
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
var errorMessage = (error) => isRecord(error) && typeof error.message === "string" ? error.message : String(error);

// src/client/presentation.ts
var TAB_KIND = "codex-side";
var TAB_TYPE = "@local/dsh-codex-side";
var CONVERSATION_SLOT = "codex.side.conversation";
var LOCALE_NAMESPACE = "codexSidePanel";
var messages = {
  zh: {
    title: "旁支对话",
    keep: "转为永久对话",
    keeping: "正在转换…",
    keepHint: "保留上下文和记录，关闭当前旁支标签页并打开永久会话。",
    loading: "正在加载旁支…",
    retry: "重新连接",
    unavailable: "旁支会话暂不可用。"
  },
  en: {
    title: "Side conversation",
    keep: "Keep as permanent conversation",
    keeping: "Converting…",
    keepHint: "Keep the context and messages, close this side tab, and open the permanent conversation.",
    loading: "Loading side conversation…",
    retry: "Reconnect",
    unavailable: "Side conversation is unavailable."
  }
};
var css = `
  .cs-side{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);font-size:13px;overflow:hidden;display:flex;flex-direction:column;height:100%;width:100%;min-height:0;box-sizing:border-box}
  .cs-side-muted{color:var(--dsw-alias-label-secondary);font-size:12px}
  .cs-side-btn{font:inherit;line-height:1.4;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);padding:5px 9px;border-radius:8px;cursor:pointer}
  .cs-side-btn:hover{background:var(--dsw-alias-bg-layer-2)}
  .cs-side-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
  .cs-side-conversation{display:flex;flex-direction:column;position:relative;flex:1;min-height:0;width:100%;overflow:hidden}
  .cs-side-error{color:var(--dsw-alias-state-error-primary);padding:6px 12px;white-space:pre-wrap;overflow-wrap:anywhere;flex-shrink:0}
  .cs-side-loading{padding:16px}
  .cs-side-actions{display:flex;justify-content:flex-end;padding:8px 12px;flex-shrink:0}
  .cs-side-btn:disabled{opacity:.5;cursor:default}
`;

// src/client/components.tsx
function createSideComponents(ctx, React, t, state, hooks, operations) {
  function FixedChatView(props) {
    return props.renderSlot("conversation.session", { view: "chat" });
  }
  function NativeConversation(props) {
    const session = props.useSession((value) => value);
    const conversation = props.useConversation((value) => value);
    const summaryBlank = props.useSessions((sessions) => sessions.byId[props.sessionId]?.blank);
    const shellPhase = conversation.activeTargets.size > 0 || !session.blank && !session.awaitingFirstTurn || session.running ? "active" : session.promptAttempted ? "engaging" : "blank";
    const settling = shellPhase === "blank" && session.openState === "loading" && summaryBlank !== true;
    const hero = shellPhase === "blank" && (session.openState === "open" || summaryBlank === true);
    return props.renderFactorySlot("conversation.content", {
      variant: "embedded",
      phase: settling ? "settling" : hero ? "hero" : "active",
      hero
    }, { slots: { views: FixedChatView } });
  }
  function SideBody(props) {
    const { childId, SessionProvider, renderSlot } = props;
    const [reference, setReference] = React.useState(null);
    const [error, setError] = React.useState("");
    const [retry, setRetry] = React.useState(0);
    React.useEffect(() => {
      let live = true;
      let retained;
      setError("");
      setReference(null);
      (async () => {
        await ctx.sessions.refresh();
        if (!live) return;
        retained = ctx.sessions.retain(childId, { source: "controllerOperation" });
        await retained.ready;
        if (live) setReference(retained);
      })().catch((error2) => {
        if (live) setError(errorMessage(error2));
      });
      return () => {
        live = false;
        retained?.release();
      };
    }, [childId, retry]);
    return /* @__PURE__ */ React.createElement("div", { className: "cs-side-conversation", "data-codex-side-native": childId }, error ? /* @__PURE__ */ React.createElement("div", { className: "cs-side-error", role: "alert" }, error, /* @__PURE__ */ React.createElement("button", { type: "button", className: "cs-side-btn", onClick: () => setRetry((value) => value + 1) }, t("retry"))) : null, reference ? /* @__PURE__ */ React.createElement(SessionProvider, { session: reference }, renderSlot(CONVERSATION_SLOT, {})) : !error ? /* @__PURE__ */ React.createElement("div", { className: "cs-side-loading cs-side-muted", role: "status" }, t("loading")) : null);
  }
  function SidePanel(props) {
    hooks.useLocale();
    const { tab } = props.useTabInfo();
    const projection = hooks.useProjection(ctx.sessions.binding(props.sessionId));
    const temporaryChildId = projection.childId;
    const childId = temporaryChildId ?? projection.promotedId;
    const [saving, setSaving] = React.useState(false);
    const [error, setError] = React.useState("");
    React.useEffect(() => {
      if (projection.sessionId === props.sessionId && !childId) tab.actions.close();
    }, [props.sessionId, projection.sessionId, childId, tab.actions]);
    return /* @__PURE__ */ React.createElement("section", { className: "cs-side", "aria-label": t("title") }, temporaryChildId ? /* @__PURE__ */ React.createElement("div", { className: "cs-side-actions" }, /* @__PURE__ */ React.createElement(
      "button",
      {
        type: "button",
        className: "cs-side-btn",
        disabled: saving,
        title: t("keepHint"),
        onClick: async () => {
          setSaving(true);
          setError("");
          try {
            await props.promoteAndOpen(props.sessionId, temporaryChildId, tab);
          } catch (error2) {
            setError(errorMessage(error2));
          } finally {
            setSaving(false);
          }
        }
      },
      t(saving ? "keeping" : "keep")
    )) : null, error || projection.error ? /* @__PURE__ */ React.createElement("div", { role: "alert", className: "cs-side-error" }, error || projection.error) : null, childId ? /* @__PURE__ */ React.createElement(SideBody, { ...props, key: childId, childId }) : /* @__PURE__ */ React.createElement("div", { className: "cs-side-loading cs-side-muted", role: "status" }, t("loading")));
  }
  function SideController(props) {
    const binding = ctx.sessions.binding(props.sessionId);
    const projection = hooks.useProjection(binding);
    const mounted = hooks.useSource(ctx.sidebarRight.mounted);
    const failure = hooks.useFailure(props.sessionId);
    const temporary = Boolean(projection.parentId) && !projection.permanent;
    React.useEffect(() => {
      if (!temporary) {
        ctx.sessions.refreshProjections(props.sessionId).catch((error) => state.reportFailure(props.sessionId, error));
      }
    }, [props.sessionId, temporary]);
    React.useEffect(() => {
      if (temporary || mounted !== props.sessionId || projection.sessionId !== props.sessionId) return;
      const previous = state.seen.get(props.sessionId);
      state.seen.set(props.sessionId, { childId: projection.childId, revision: projection.revision });
      if (previous && projection.childId && previous.revision !== projection.revision) operations.reveal(props.sessionId);
    }, [props.sessionId, mounted, temporary, projection.childId, projection.revision, projection.sessionId]);
    if (temporary) return null;
    return projection.error || failure ? /* @__PURE__ */ React.createElement("div", { role: "alert", className: "cs-side-error" }, projection.error || failure) : null;
  }
  function SideCommandView() {
    hooks.useLocale();
    return /* @__PURE__ */ React.createElement("span", { style: { color: "var(--dsw-alias-label-secondary)", fontSize: 12 } }, "/side · ", t("title"));
  }
  return { SidePanel, NativeConversation, SideController, SideCommandView };
}

// src/client/events.ts
function internalCommandDefinition() {
  return {
    kind: "codex-side-internal-command",
    target: "chat",
    match(event) {
      if (!isRecord(event) || event.type !== "command/run" && event.type !== "command/done") return null;
      if (!isRecord(event.data)) return null;
      const id = event.data.commandId;
      if (typeof id !== "string" || !isInternalCommandId(id)) return null;
      return { id, role: event.type === "command/run" ? "start" : "update", exclusive: true };
    },
    start: () => ({}),
    update: (context) => context.state,
    buildViewNode: () => null
  };
}

// src/client/projections.ts
var EMPTY_PROJECTION = Object.freeze({
  sessionId: void 0,
  parentId: null,
  childId: null,
  permanent: false,
  promotedId: null,
  revision: 0,
  error: null,
  ended: null
});
var EMPTY_SOURCE = {
  subscribe: () => () => {
  },
  getSnapshot: () => EMPTY_PROJECTION
};
function nullableString(value) {
  return typeof value === "string" ? value : null;
}
function readProjection(value) {
  if (!isRecord(value)) return EMPTY_PROJECTION;
  return {
    sessionId: typeof value.sessionId === "string" ? value.sessionId : void 0,
    parentId: nullableString(value.parentId),
    childId: nullableString(value.childId),
    permanent: value.permanent === true,
    promotedId: nullableString(value.promotedId),
    revision: typeof value.revision === "number" ? value.revision : 0,
    error: nullableString(value.error),
    ended: nullableString(value.ended)
  };
}
function projectionSource(binding) {
  return binding?.session.projections.faceOf(KEY) ?? EMPTY_SOURCE;
}
function missingProjectionIds(value) {
  if (!isRecord(value) || !Array.isArray(value.ids)) return [];
  const byId = isRecord(value.byId) ? value.byId : {};
  return value.ids.filter((id) => {
    if (typeof id !== "string" || !/^side-[0-9a-f-]{36}$/i.test(id)) return false;
    const summary = byId[id];
    const projectionValues = isRecord(summary) && isRecord(summary.projectionValues) ? summary.projectionValues : void 0;
    return !projectionValues?.[KEY];
  });
}

// src/client/hooks.ts
function createSideHooks(ctx, React, state) {
  function useLocale() {
    React.useSyncExternalStore((listener) => ctx.locale.subscribe(listener), () => ctx.locale.getSnapshot());
  }
  function useSource(source = EMPTY_SOURCE) {
    return React.useSyncExternalStore((listener) => source.subscribe(listener), () => source.getSnapshot());
  }
  function useProjection(binding) {
    const source = React.useMemo(() => projectionSource(binding), [binding]);
    return readProjection(useSource(source));
  }
  function useFailure(sessionId) {
    return React.useSyncExternalStore(state.subscribeFailures, () => state.failure(sessionId));
  }
  return { useLocale, useSource, useProjection, useFailure };
}

// src/client/operations.ts
function commandValue(result, unavailable) {
  if (!isRecord(result)) throw new Error(unavailable);
  if (result.ok !== true) {
    const error = isRecord(result.error) ? result.error.message : result.error;
    throw new Error(error === void 0 ? unavailable : errorMessage(error));
  }
  const value = result.value;
  if (!isRecord(value) || !isRecord(value.result)) throw new Error(unavailable);
  if (value.result.kind === "error") {
    throw new Error(typeof value.result.text === "string" ? value.result.text : unavailable);
  }
  return value;
}
function createSideOperations(ctx, t, state) {
  async function command(sessionId, line) {
    state.clearFailure(sessionId);
    const binding = ctx.sessions.binding(sessionId);
    if (!binding) throw new Error(t("unavailable"));
    const result = await binding.ctx.remote.commands.execute(line, [], new AbortController().signal);
    return commandValue(result, t("unavailable"));
  }
  function reveal(parentId) {
    if (ctx.sidebarRight.mounted.getSnapshot() !== parentId) return;
    const existing = ctx.sidebarRight.openTabs.getSnapshot().find((tab) => tab.sessionId === parentId && tab.kind === TAB_KIND);
    if (existing) {
      ctx.sidebarRight.focus(existing.tabId);
      if (!ctx.sidebarRight.isExpanded()) ctx.sidebarRight.toggleExpanded();
    } else {
      ctx.sidebarRight.openTab(TAB_KIND);
    }
  }
  const promoteAndOpen = async (parentId, childId, tab) => {
    await command(parentId, `/side --keep ${childId}`);
    await ctx.sessions.refresh();
    if (tab.signal.aborted) return;
    const currentChild = readProjection(projectionSource(ctx.sessions.binding(parentId)).getSnapshot()).childId;
    if (currentChild && currentChild !== childId) return;
    const foreground = ctx.sidebarRight.mounted.getSnapshot() === parentId;
    const reference = ctx.sessions.retain(childId, { source: "controllerOperation" });
    state.promotionClosures.add(parentId);
    try {
      tab.actions.close();
      if (foreground) ctx.uiWorkspace.openSession(childId);
    } finally {
      state.promotionClosures.delete(parentId);
      reference.release();
    }
  };
  function closeSide(parentId) {
    if (state.promotionClosures.has(parentId)) return;
    const childId = readProjection(projectionSource(ctx.sessions.binding(parentId)).getSnapshot()).childId;
    if (!childId) return;
    const reference = ctx.sessions.retain(parentId, { source: "controllerOperation" });
    command(parentId, "/side --close").catch((error) => state.reportFailure(parentId, error)).finally(() => reference.release());
  }
  return { command, reveal, promoteAndOpen, closeSide };
}

// src/client/state.ts
function createSideState() {
  const failures = /* @__PURE__ */ new Map();
  const failureListeners = /* @__PURE__ */ new Set();
  function notifyFailures() {
    for (const listener of failureListeners) listener();
  }
  return {
    promotionClosures: /* @__PURE__ */ new Set(),
    seen: /* @__PURE__ */ new Map(),
    subscribeFailures(listener) {
      failureListeners.add(listener);
      return () => {
        failureListeners.delete(listener);
      };
    },
    failure(sessionId) {
      return failures.get(sessionId) ?? "";
    },
    reportFailure(sessionId, error) {
      failures.set(sessionId, errorMessage(error));
      notifyFailures();
    },
    clearFailure(sessionId) {
      if (failures.delete(sessionId)) notifyFailures();
    }
  };
}
function observeMissingProjections(ctx, state) {
  const list = ctx.sessions.list;
  if (!list) return () => {
  };
  const attempted = /* @__PURE__ */ new Set();
  const queue = [];
  let live = true;
  let running = 0;
  function pump() {
    while (live && running < 4 && queue.length > 0) {
      const id = queue.shift();
      if (id === void 0) break;
      running += 1;
      ctx.sessions.refreshProjections(id).catch((error) => {
        if (!live) return;
        const parentId = ctx.sidebarRight.mounted.getSnapshot();
        if (parentId) state.reportFailure(parentId, error);
      }).finally(() => {
        running -= 1;
        pump();
      });
    }
  }
  const discover = () => {
    for (const id of missingProjectionIds(list.getSnapshot())) {
      if (attempted.has(id)) continue;
      attempted.add(id);
      queue.push(id);
    }
    pump();
  };
  const dispose = list.subscribe(discover);
  discover();
  return () => {
    live = false;
    queue.length = 0;
    dispose();
  };
}

// src/client/index.tsx
var inject = ["slots", "sessions", "locale", "sidebarRight", "sidebarRightTabs", "uiConversation", "uiWorkspace"];
function apply(ctx) {
  const React = require("react");
  ctx.effect(() => ctx.locale.register(LOCALE_NAMESPACE, "zh", messages.zh));
  ctx.effect(() => ctx.locale.register(LOCALE_NAMESPACE, "en", messages.en));
  ctx.effect(() => ctx.uiConversation.events.register(internalCommandDefinition()));
  const t = ctx.locale.bind(LOCALE_NAMESPACE);
  const state = createSideState();
  const operations = createSideOperations(ctx, t, state);
  const hooks = createSideHooks(ctx, React, state);
  const { SidePanel, NativeConversation, SideController, SideCommandView } = createSideComponents(ctx, React, t, state, hooks, operations);
  if (ctx.sessions?.list) ctx.effect(() => observeMissingProjections(ctx, state));
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: TAB_TYPE,
    kind: TAB_KIND,
    title: () => t("title"),
    keepMounted: true
  }));
  ctx.effect(() => ctx.sidebarRight.registerCloseHandler(TAB_KIND, operations.closeSide));
  ctx.slots.inject("sidebar.right.pane.tab", () => ctx.slots.register({
    name: "sidebar.right.pane.tab",
    key: TAB_TYPE,
    inject: () => ({ promoteAndOpen: operations.promoteAndOpen }),
    children: { [CONVERSATION_SLOT]: { kind: "single", scope: "session" } }
  }, (props) => /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("style", null, css), /* @__PURE__ */ React.createElement(SidePanel, { ...props }))));
  ctx.slots.inject(CONVERSATION_SLOT, () => ctx.slots.register({ name: CONVERSATION_SLOT }, NativeConversation));
  ctx.slots.inject("conversation.input.dock", () => ctx.slots.register({
    name: "conversation.input.dock",
    id: "local-codex-side-controller",
    order: 30
  }, (props) => /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("style", null, css), /* @__PURE__ */ React.createElement(SideController, { ...props }))));
  ctx.slots.inject("conversation.chat.commandview", () => ctx.slots.register({
    name: "conversation.chat.commandview",
    key: "side"
  }, SideCommandView));
}
    return module.exports;
  }
});
