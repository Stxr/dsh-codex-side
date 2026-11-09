import type { ComponentType, ReactNode } from 'react';
/** Only the React APIs supplied by the host and used by this client. */
export type ReactRuntime = Pick<typeof import('react'), 'createElement' | 'Fragment' | 'useEffect' | 'useMemo' | 'useState' | 'useSyncExternalStore'>;
export type Listener = () => void;
export type Dispose = () => void;
export interface ExternalStore<Value> {
    subscribe(listener: Listener): Dispose;
    getSnapshot(): Value;
}
export interface SessionReference {
    readonly ready: PromiseLike<unknown>;
    release(): void;
}
export interface SessionBinding {
    readonly session: {
        readonly projections: {
            faceOf(key: string): ExternalStore<unknown> | undefined;
        };
    };
    readonly ctx: {
        readonly remote: {
            readonly commands: {
                execute(line: string, args: readonly unknown[], signal: AbortSignal): Promise<unknown>;
            };
        };
    };
}
export interface ClientSessions {
    readonly list?: ExternalStore<unknown>;
    binding(sessionId: string): SessionBinding | undefined;
    refresh(): Promise<unknown>;
    refreshProjections(sessionId: string): Promise<unknown>;
    retain(sessionId: string, options: {
        source: 'controllerOperation';
    }): SessionReference;
}
export interface SideTab {
    readonly signal: AbortSignal;
    readonly actions: {
        close(): void;
    };
}
interface OpenTab {
    readonly sessionId: string;
    readonly kind: string;
    readonly tabId: string;
}
export interface ClientSidebarRight {
    readonly mounted: ExternalStore<string | null>;
    readonly openTabs: ExternalStore<readonly OpenTab[]>;
    focus(tabId: string): void;
    isExpanded(): boolean;
    toggleExpanded(): void;
    openTab(kind: string): void;
    registerCloseHandler(kind: string, handler: (parentId: string) => void): Dispose;
}
export type Translate = (key: string) => string;
export interface InternalCommandDefinition {
    readonly kind: string;
    readonly target: 'chat';
    match(event: unknown): {
        id: string;
        role: 'start' | 'update';
        exclusive: true;
    } | null;
    start(): Record<string, never>;
    update(context: {
        state: unknown;
    }): unknown;
    buildViewNode(): null;
}
interface SlotDefinition {
    readonly name: string;
    readonly key?: string;
    readonly id?: string;
    readonly order?: number;
    readonly inject?: () => Readonly<Record<string, unknown>>;
    readonly children?: Readonly<Record<string, {
        kind: 'single';
        scope: 'session';
    }>>;
}
export interface ClientContext {
    effect(callback: () => Dispose): unknown;
    readonly locale: {
        register(namespace: string, language: string, messages: Readonly<Record<string, string>>): Dispose;
        bind(namespace: string): Translate;
        subscribe(listener: Listener): Dispose;
        getSnapshot(): unknown;
    };
    readonly sessions: ClientSessions;
    readonly sidebarRight: ClientSidebarRight;
    readonly sidebarRightTabs: {
        register(definition: {
            id: string;
            kind: string;
            title: () => string;
            keepMounted: true;
        }): Dispose;
    };
    readonly uiConversation: {
        readonly events: {
            register(definition: InternalCommandDefinition): Dispose;
        };
    };
    readonly uiWorkspace: {
        openSession(sessionId: string): unknown;
    };
    readonly slots: {
        inject(name: string, callback: () => Dispose): unknown;
        register<Props>(definition: SlotDefinition, component: ComponentType<Props>): Dispose;
    };
}
export type PromoteAndOpen = (parentId: string, childId: string, tab: SideTab) => Promise<void>;
export type RenderSlot = (name: string, props: Readonly<Record<string, unknown>>) => ReactNode;
export interface SessionSlotProps {
    readonly sessionId: string;
    readonly SessionProvider: ComponentType<{
        session: SessionReference;
        children?: ReactNode;
    }>;
    readonly renderSlot: RenderSlot;
}
export interface SideBodyProps extends SessionSlotProps {
    readonly childId: string;
}
export interface SidePanelProps extends SessionSlotProps {
    readonly promoteAndOpen: PromoteAndOpen;
    useTabInfo(): {
        tab: SideTab;
    };
}
export interface SideControllerProps {
    readonly sessionId: string;
}
type SelectorHook<State> = <Value>(selector: (state: State) => Value) => Value;
interface NativeSessionState {
    readonly blank: boolean;
    readonly awaitingFirstTurn: boolean;
    readonly running: boolean;
    readonly promptAttempted: boolean;
    readonly openState: string;
}
interface NativeConversationState {
    readonly activeTargets: {
        readonly size: number;
    };
}
interface NativeSessionsState {
    readonly byId: Readonly<Record<string, {
        readonly blank?: boolean;
    } | undefined>>;
}
export interface FixedChatViewProps {
    readonly renderSlot: RenderSlot;
}
export interface NativeConversationProps {
    readonly sessionId: string;
    readonly useSession: SelectorHook<NativeSessionState>;
    readonly useConversation: SelectorHook<NativeConversationState>;
    readonly useSessions: SelectorHook<NativeSessionsState>;
    renderFactorySlot(name: string, props: {
        variant: 'embedded';
        phase: 'settling' | 'hero' | 'active';
        hero: boolean;
    }, options: {
        slots: {
            views: ComponentType<FixedChatViewProps>;
        };
    }): ReactNode;
}
export {};
