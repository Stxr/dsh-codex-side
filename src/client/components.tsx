import { errorMessage } from '../shared/protocol';
import type {
  ClientContext, FixedChatViewProps, NativeConversationProps, ReactRuntime, SessionReference,
  SideBodyProps, SideControllerProps, SidePanelProps, Translate,
} from './host';
import type { SideHooks } from './hooks';
import type { SideOperations } from './operations';
import { CONVERSATION_SLOT } from './presentation';
import type { SideState } from './state';

/** Component closures belong to apply; importing this module never touches React or the host. */
export function createSideComponents(
  ctx: ClientContext, React: ReactRuntime, t: Translate,
  state: SideState, hooks: SideHooks, operations: SideOperations,
) {
  // Use the same embedded Conversation adapter as the shipped Sidebar chat.
  // The render-position Session comes from the retained child's SessionProvider.
  function FixedChatView(props: FixedChatViewProps) {
    return props.renderSlot('conversation.session', { view: 'chat' });
  }

  function NativeConversation(props: NativeConversationProps) {
    const session = props.useSession(value => value);
    const conversation = props.useConversation(value => value);
    const summaryBlank = props.useSessions(sessions => sessions.byId[props.sessionId]?.blank);
    const shellPhase = conversation.activeTargets.size > 0
      || (!session.blank && !session.awaitingFirstTurn) || session.running
      ? 'active' : session.promptAttempted ? 'engaging' : 'blank';
    const settling = shellPhase === 'blank' && session.openState === 'loading' && summaryBlank !== true;
    const hero = shellPhase === 'blank' && (session.openState === 'open' || summaryBlank === true);
    return props.renderFactorySlot('conversation.content', {
      variant: 'embedded', phase: settling ? 'settling' : hero ? 'hero' : 'active', hero,
    }, { slots: { views: FixedChatView } });
  }

  function SideBody(props: SideBodyProps) {
    const { childId, SessionProvider, renderSlot } = props;
    const [reference, setReference] = React.useState<SessionReference | null>(null);
    const [error, setError] = React.useState('');
    const [retry, setRetry] = React.useState(0);
    React.useEffect(() => {
      let live = true;
      let retained: SessionReference | undefined;
      setError('');
      setReference(null);
      (async () => {
        // Host command completion can precede the Client Session catalogue.
        await ctx.sessions.refresh();
        if (!live) return;
        retained = ctx.sessions.retain(childId, { source: 'controllerOperation' });
        await retained.ready;
        if (live) setReference(retained);
      })().catch((error: unknown) => { if (live) setError(errorMessage(error)); });
      return () => { live = false; retained?.release(); };
    }, [childId, retry]);
    return <div className="cs-side-conversation" data-codex-side-native={childId}>
      {error ? <div className="cs-side-error" role="alert">
        {error}
        <button type="button" className="cs-side-btn" onClick={() => setRetry(value => value + 1)}>{t('retry')}</button>
      </div> : null}
      {reference ? <SessionProvider session={reference}>{renderSlot(CONVERSATION_SLOT, {})}</SessionProvider>
        : !error ? <div className="cs-side-loading cs-side-muted" role="status">{t('loading')}</div> : null}
    </div>;
  }

  function SidePanel(props: SidePanelProps) {
    hooks.useLocale();
    const { tab } = props.useTabInfo();
    const projection = hooks.useProjection(ctx.sessions.binding(props.sessionId));
    const temporaryChildId = projection.childId;
    const childId = temporaryChildId ?? projection.promotedId;
    const [saving, setSaving] = React.useState(false);
    const [error, setError] = React.useState('');
    React.useEffect(() => {
      if (projection.sessionId === props.sessionId && !childId) tab.actions.close();
    }, [props.sessionId, projection.sessionId, childId, tab.actions]);
    return <section className="cs-side" aria-label={t('title')}>
      {temporaryChildId ? <div className="cs-side-actions">
        <button type="button" className="cs-side-btn" disabled={saving} title={t('keepHint')}
          onClick={async () => {
            setSaving(true);
            setError('');
            try { await props.promoteAndOpen(props.sessionId, temporaryChildId, tab); }
            catch (error: unknown) { setError(errorMessage(error)); }
            finally { setSaving(false); }
          }}>{t(saving ? 'keeping' : 'keep')}</button>
      </div> : null}
      {error || projection.error ? <div role="alert" className="cs-side-error">{error || projection.error}</div> : null}
      {childId ? <SideBody {...props} key={childId} childId={childId} />
        : <div className="cs-side-loading cs-side-muted" role="status">{t('loading')}</div>}
    </section>;
  }

  function SideController(props: SideControllerProps) {
    const binding = ctx.sessions.binding(props.sessionId);
    const projection = hooks.useProjection(binding);
    const mounted = hooks.useSource(ctx.sidebarRight.mounted);
    const failure = hooks.useFailure(props.sessionId);
    const temporary = Boolean(projection.parentId) && !projection.permanent;
    React.useEffect(() => {
      if (!temporary) {
        ctx.sessions.refreshProjections(props.sessionId)
          .catch((error: unknown) => state.reportFailure(props.sessionId, error));
      }
    }, [props.sessionId, temporary]);
    React.useEffect(() => {
      if (temporary || mounted !== props.sessionId || projection.sessionId !== props.sessionId) return;
      const previous = state.seen.get(props.sessionId);
      state.seen.set(props.sessionId, { childId: projection.childId, revision: projection.revision });
      if (previous && projection.childId && previous.revision !== projection.revision) operations.reveal(props.sessionId);
    }, [props.sessionId, mounted, temporary, projection.childId, projection.revision, projection.sessionId]);
    if (temporary) return null;
    return projection.error || failure
      ? <div role="alert" className="cs-side-error">{projection.error || failure}</div> : null;
  }

  function SideCommandView() {
    hooks.useLocale();
    return <span style={{ color: 'var(--dsw-alias-label-secondary)', fontSize: 12 }}>/side · {t('title')}</span>;
  }

  return { SidePanel, NativeConversation, SideController, SideCommandView };
}
