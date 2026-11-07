window.__ModuleLoader__.load({
  id: '@local/dsh-codex-side',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const KEY = 'local.codexSide.v1';
    const TAB_KIND = 'codex-side';
    const TAB_TYPE = '@local/dsh-codex-side';
    const CONVERSATION_SLOT = 'codex.side.conversation';
    const EMPTY = Object.freeze({ childId: null, revision: 0, error: null });
    const EMPTY_SOURCE = { subscribe: () => () => {}, getSnapshot: () => EMPTY };
    const css = `
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
    return {
      inject: ['slots', 'sessions', 'locale', 'sidebarRight', 'sidebarRightTabs', 'uiConversation', 'uiWorkspace'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register('codexSidePanel', 'zh', {
          title: '旁支对话', keep: '转为永久对话', keeping: '正在转换…',
          keepHint: '保留上下文和记录，关闭当前旁支标签页并打开永久会话。',
          loading: '正在加载旁支…', retry: '重新连接', unavailable: '旁支会话暂不可用。',
        }));
        ctx.effect(() => ctx.locale.register('codexSidePanel', 'en', {
          title: 'Side conversation', keep: 'Keep as permanent conversation', keeping: 'Converting…',
          keepHint: 'Keep the context and messages, close this side tab, and open the permanent conversation.',
          loading: 'Loading side conversation…', retry: 'Reconnect', unavailable: 'Side conversation is unavailable.',
        }));
        // These native command records commit recovery state, not a second human
        // invocation. Claim only our IDs so both new and historical Chat rows are
        // omitted without changing the log, other commands, or their error rows.
        ctx.effect(() => ctx.uiConversation.events.register({
          kind: 'codex-side-internal-command', target: 'chat',
          match(event) {
            if (event.type !== 'command/run' && event.type !== 'command/done') return null;
            const id = event.data.commandId;
            if (typeof id !== 'string' || !id.startsWith('side-op-')) return null;
            return { id, role: event.type === 'command/run' ? 'start' : 'update', exclusive: true };
          },
          start: () => ({}), update: context => context.state, buildViewNode: () => null,
        }));
        const t = ctx.locale.bind('codexSidePanel');
        const promotionClosures = new Set();
        const seen = new Map();
        const failures = new Map();
        const failureListeners = new Set();
        function reportFailure(sessionId, error) {
          failures.set(sessionId, error?.message ?? String(error));
          for (const listener of failureListeners) listener();
        }
        function useFailure(sessionId) {
          return React.useSyncExternalStore(listener => { failureListeners.add(listener); return () => failureListeners.delete(listener); }, () => failures.get(sessionId) ?? '');
        }
        // Older checkpoints may not have summary metadata yet. Read only those
        // side projections, without retaining/resuming Agents or reading Client logs.
        if (ctx.sessions?.list) ctx.effect(() => {
          const attempted = new Set();
          const queue = [];
          let live = true;
          let running = 0;
          function pump() {
            while (live && running < 4 && queue.length) {
              const id = queue.shift();
              running += 1;
              ctx.sessions.refreshProjections(id).catch(error => {
                if (!live) return;
                const parentId = ctx.sidebarRight.mounted.getSnapshot();
                if (parentId) reportFailure(parentId, error);
              }).finally(() => { running -= 1; pump(); });
            }
          }
          function discover() {
            const list = ctx.sessions.list.getSnapshot();
            for (const id of list.ids) {
              if (!/^side-[0-9a-f-]{36}$/i.test(id) || list.byId[id]?.projectionValues?.[KEY] || attempted.has(id)) continue;
              attempted.add(id); queue.push(id);
            }
            pump();
          }
          const dispose = ctx.sessions.list.subscribe(discover);
          discover();
          return () => { live = false; queue.length = 0; dispose(); };
        });
        function reveal(parentId) {
          if (ctx.sidebarRight.mounted.getSnapshot() !== parentId) return;
          const existing = ctx.sidebarRight.openTabs.getSnapshot().find(tab => tab.sessionId === parentId && tab.kind === TAB_KIND);
          if (existing) {
            ctx.sidebarRight.focus(existing.tabId);
            if (!ctx.sidebarRight.isExpanded()) ctx.sidebarRight.toggleExpanded();
          } else ctx.sidebarRight.openTab(TAB_KIND);
        }
        function useLocale() {
          React.useSyncExternalStore(f => ctx.locale.subscribe(f), () => ctx.locale.getSnapshot());
        }
        function useSource(source = EMPTY_SOURCE) {
          return React.useSyncExternalStore(f => source.subscribe(f), () => source.getSnapshot());
        }
        function useProjection(binding) {
          const source = React.useMemo(() => binding?.session.projections.faceOf(KEY) ?? EMPTY_SOURCE, [binding]);
          return useSource(source) ?? EMPTY;
        }
        async function command(sessionId, line) {
          if (failures.delete(sessionId)) for (const listener of failureListeners) listener();
          const binding = ctx.sessions.binding(sessionId);
          if (!binding) throw new Error(t('unavailable'));
          const result = await binding.ctx.remote.commands.execute(line, [], new AbortController().signal);
          if (!result.ok) throw new Error(result.error.message);
          if (!result.value || result.value.result.kind === 'error') throw new Error(result.value?.result.text ?? t('unavailable'));
          return result.value;
        }
        async function promoteAndOpen(parentId, childId, tab) {
          await command(parentId, `/side --keep ${childId}`);
          await ctx.sessions.refresh();
          // A manual close, another side, or a later selection supersedes this
          // UI handoff. Tab actions remain scoped to their original occurrence.
          if (tab.signal.aborted) return;
          const currentChild = ctx.sessions.binding(parentId)?.session.projections.faceOf(KEY).getSnapshot()?.childId;
          if (currentChild && currentChild !== childId) return;
          const foreground = ctx.sidebarRight.mounted.getSnapshot() === parentId;
          const reference = ctx.sessions.retain(childId, { source: 'controllerOperation' });
          promotionClosures.add(parentId);
          try {
            tab.actions.close();
            if (foreground) ctx.uiWorkspace.openSession(childId);
          } finally {
            promotionClosures.delete(parentId);
            reference.release();
          }
        }
        // Use the same embedded Conversation adapter as the shipped Sidebar chat.
        // The render-position Session comes from the retained child's SessionProvider.
        function FixedChatView(props) {
          return props.renderSlot('conversation.session', { view: 'chat' });
        }
        function NativeConversation(props) {
          const session = props.useSession(value => value);
          const conversation = props.useConversation(value => value);
          const summaryBlank = props.useSessions(state => state.byId[props.sessionId]?.blank);
          const shellPhase = conversation.activeTargets.size > 0 || (!session.blank && !session.awaitingFirstTurn) || session.running
            ? 'active' : session.promptAttempted ? 'engaging' : 'blank';
          const settling = shellPhase === 'blank' && session.openState === 'loading' && summaryBlank !== true;
          const hero = shellPhase === 'blank' && (session.openState === 'open' || summaryBlank === true);
          return props.renderFactorySlot('conversation.content', {
            variant: 'embedded', phase: settling ? 'settling' : hero ? 'hero' : 'active', hero,
          }, { slots: { views: FixedChatView } });
        }
        function SideBody(props) {
          const { childId, SessionProvider, renderSlot } = props;
          const [reference, setReference] = React.useState(null);
          const [error, setError] = React.useState('');
          const [retry, setRetry] = React.useState(0);
          React.useEffect(() => {
            let live = true;
            let retained;
            setError('');
            setReference(null);
            (async () => {
              // Host command completion can precede the Client Session catalogue.
              await ctx.sessions.refresh();
              if (!live) return;
              retained = ctx.sessions.retain(childId, { source: 'controllerOperation' });
              await retained.ready;
              if (live) setReference(retained);
            })().catch(error => { if (live) setError(error.message); });
            return () => { live = false; retained?.release(); };
          }, [childId, retry]);
          return h('div', { className: 'cs-side-conversation', 'data-codex-side-native': childId },
            error ? h('div', { className: 'cs-side-error', role: 'alert' }, error,
              h('button', { type: 'button', className: 'cs-side-btn', onClick: () => setRetry(value => value + 1) }, t('retry'))) : null,
            reference ? h(SessionProvider, { session: reference }, renderSlot(CONVERSATION_SLOT, {}))
              : !error ? h('div', { className: 'cs-side-loading cs-side-muted', role: 'status' }, t('loading')) : null);
        }
        function SidePanel(props) {
          useLocale();
          const { tab } = props.useTabInfo();
          const state = useProjection(ctx.sessions.binding(props.sessionId));
          const childId = state.childId ?? state.promotedId;
          const [saving, setSaving] = React.useState(false);
          const [error, setError] = React.useState('');
          React.useEffect(() => {
            if (state.sessionId === props.sessionId && !childId) tab.actions.close();
          }, [props.sessionId, state.sessionId, childId, tab.actions]);
          return h('section', { className: 'cs-side', 'aria-label': t('title') },
            state.childId ? h('div', { className: 'cs-side-actions' },
              h('button', { type: 'button', className: 'cs-side-btn', disabled: saving,
                title: t('keepHint'), onClick: async () => {
                  setSaving(true); setError('');
                  try { await props.promoteAndOpen(props.sessionId, state.childId, tab); }
                  catch (error) { setError(error.message); }
                  finally { setSaving(false); }
                },
              }, t(saving ? 'keeping' : 'keep'))) : null,
            error || state.error ? h('div', { role: 'alert', className: 'cs-side-error' }, error || state.error) : null,
            childId ? h(SideBody, { ...props, key: childId, childId })
              : h('div', { className: 'cs-side-loading cs-side-muted', role: 'status' }, t('loading')));
        }
        function SideController(props) {
          const binding = ctx.sessions.binding(props.sessionId);
          const state = useProjection(binding);
          const mounted = useSource(ctx.sidebarRight.mounted);
          const failure = useFailure(props.sessionId);
          const temporary = Boolean(state.parentId) && !state.permanent;
          React.useEffect(() => {
            if (!temporary) ctx.sessions.refreshProjections(props.sessionId).catch(error => reportFailure(props.sessionId, error));
          }, [props.sessionId, temporary]);
          React.useEffect(() => {
            if (temporary || mounted !== props.sessionId || state.sessionId !== props.sessionId) return;
            const previous = seen.get(props.sessionId);
            seen.set(props.sessionId, { childId: state.childId, revision: state.revision });
            if (previous && state.childId && previous.revision !== state.revision) reveal(props.sessionId);
          }, [props.sessionId, mounted, temporary, state.childId, state.revision, state.sessionId]);
          if (temporary) return null;
          return state.error || failure ? h('div', { role: 'alert', className: 'cs-side-error' }, state.error || failure) : null;
        }
        ctx.effect(() => ctx.sidebarRightTabs.register({ id: TAB_TYPE, kind: TAB_KIND, title: () => t('title'), keepMounted: true }));
        ctx.effect(() => ctx.sidebarRight.registerCloseHandler(TAB_KIND, parentId => {
          if (promotionClosures.has(parentId)) return;
          const parent = ctx.sessions.binding(parentId);
          const childId = parent?.session.projections.faceOf(KEY).getSnapshot()?.childId;
          if (!childId) return;
          const reference = ctx.sessions.retain(parentId, { source: 'controllerOperation' });
          command(parentId, '/side --close').catch(error => reportFailure(parentId, error)).finally(() => reference.release());
        }));
        ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab', key: TAB_TYPE,
          inject: () => ({ promoteAndOpen }),
          children: { [CONVERSATION_SLOT]: { kind: 'single', scope: 'session' } },
        }, props => h(React.Fragment, null, h('style', null, css), h(SidePanel, props))));
        ctx.slots.inject(CONVERSATION_SLOT, () => ctx.slots.register({ name: CONVERSATION_SLOT }, NativeConversation));
        ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({ name: 'conversation.input.dock', id: 'local-codex-side-controller', order: 30 }, props => h(React.Fragment, null, h('style', null, css), h(SideController, props))));
        ctx.slots.inject('conversation.chat.commandview', () => ctx.slots.register({ name: 'conversation.chat.commandview', key: 'side' }, () => {
          useLocale();
          return h('span', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: 12 } }, '/side · ', t('title'));
        }));
      },
    };
  },
});
