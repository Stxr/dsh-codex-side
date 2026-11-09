export declare const TAB_KIND = "codex-side";
export declare const TAB_TYPE = "@local/dsh-codex-side";
export declare const CONVERSATION_SLOT = "codex.side.conversation";
export declare const LOCALE_NAMESPACE = "codexSidePanel";
export declare const messages: {
    readonly zh: {
        readonly title: "旁支对话";
        readonly keep: "转为永久对话";
        readonly keeping: "正在转换…";
        readonly keepHint: "保留上下文和记录，关闭当前旁支标签页并打开永久会话。";
        readonly loading: "正在加载旁支…";
        readonly retry: "重新连接";
        readonly unavailable: "旁支会话暂不可用。";
    };
    readonly en: {
        readonly title: "Side conversation";
        readonly keep: "Keep as permanent conversation";
        readonly keeping: "Converting…";
        readonly keepHint: "Keep the context and messages, close this side tab, and open the permanent conversation.";
        readonly loading: "Loading side conversation…";
        readonly retry: "Reconnect";
        readonly unavailable: "Side conversation is unavailable.";
    };
};
export declare const css = "\n  .cs-side{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);font-size:13px;overflow:hidden;display:flex;flex-direction:column;height:100%;width:100%;min-height:0;box-sizing:border-box}\n  .cs-side-muted{color:var(--dsw-alias-label-secondary);font-size:12px}\n  .cs-side-btn{font:inherit;line-height:1.4;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);padding:5px 9px;border-radius:8px;cursor:pointer}\n  .cs-side-btn:hover{background:var(--dsw-alias-bg-layer-2)}\n  .cs-side-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}\n  .cs-side-conversation{display:flex;flex-direction:column;position:relative;flex:1;min-height:0;width:100%;overflow:hidden}\n  .cs-side-error{color:var(--dsw-alias-state-error-primary);padding:6px 12px;white-space:pre-wrap;overflow-wrap:anywhere;flex-shrink:0}\n  .cs-side-loading{padding:16px}\n  .cs-side-actions{display:flex;justify-content:flex-end;padding:8px 12px;flex-shrink:0}\n  .cs-side-btn:disabled{opacity:.5;cursor:default}\n";
