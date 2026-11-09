import { createSideComponents } from './components';
import { internalCommandDefinition } from './events';
import type { ClientContext, ReactRuntime, SideControllerProps, SidePanelProps } from './host';
import { createSideHooks } from './hooks';
import { createSideOperations } from './operations';
import { CONVERSATION_SLOT, css, LOCALE_NAMESPACE, messages, TAB_KIND, TAB_TYPE } from './presentation';
import { createSideState, observeMissingProjections } from './state';

/** The module-loader factory supplies require; React remains a host dependency. */
declare const require: (id: 'react') => ReactRuntime;

export const inject = ['slots', 'sessions', 'locale', 'sidebarRight', 'sidebarRightTabs', 'uiConversation', 'uiWorkspace'];

export function apply(ctx: ClientContext): void {
  const React = require('react');
  ctx.effect(() => ctx.locale.register(LOCALE_NAMESPACE, 'zh', messages.zh));
  ctx.effect(() => ctx.locale.register(LOCALE_NAMESPACE, 'en', messages.en));
  ctx.effect(() => ctx.uiConversation.events.register(internalCommandDefinition()));

  const t = ctx.locale.bind(LOCALE_NAMESPACE);
  const state = createSideState();
  const operations = createSideOperations(ctx, t, state);
  const hooks = createSideHooks(ctx, React, state);
  const { SidePanel, NativeConversation, SideController, SideCommandView } =
    createSideComponents(ctx, React, t, state, hooks, operations);

  if (ctx.sessions?.list) ctx.effect(() => observeMissingProjections(ctx, state));
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: TAB_TYPE, kind: TAB_KIND, title: () => t('title'), keepMounted: true,
  }));
  ctx.effect(() => ctx.sidebarRight.registerCloseHandler(TAB_KIND, operations.closeSide));

  ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register<SidePanelProps>({
    name: 'sidebar.right.pane.tab', key: TAB_TYPE,
    inject: () => ({ promoteAndOpen: operations.promoteAndOpen }),
    children: { [CONVERSATION_SLOT]: { kind: 'single', scope: 'session' } },
  }, props => <React.Fragment><style>{css}</style><SidePanel {...props} /></React.Fragment>));

  ctx.slots.inject(CONVERSATION_SLOT, () => ctx.slots.register({ name: CONVERSATION_SLOT }, NativeConversation));
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register<SideControllerProps>({
    name: 'conversation.input.dock', id: 'local-codex-side-controller', order: 30,
  }, props => <React.Fragment><style>{css}</style><SideController {...props} /></React.Fragment>));
  ctx.slots.inject('conversation.chat.commandview', () => ctx.slots.register({
    name: 'conversation.chat.commandview', key: 'side',
  }, SideCommandView));
}
