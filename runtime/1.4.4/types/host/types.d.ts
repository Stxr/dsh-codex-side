import type { Session, SessionEvent } from '@deepseek-ai/dsh-session';
import type { LlmCallConfig, LlmRuntime } from '@deepseek-ai/dsh-llm';
import type { SessionTitleService } from '@deepseek-ai/dsh-session-title';
import type { z } from 'zod';
import type { SideEvent, SideMetadata, SideResult, SideState } from '../shared/protocol.js';
export type Dispose = () => void | Promise<void>;
export type ModelSelection = LlmCallConfig & {
    provider: string;
    model: string;
};
export interface HostMessage {
    id: string;
    source?: {
        kind: string;
    };
    content?: unknown;
}
export interface AgentScope {
    effect(factory: () => Dispose): Dispose;
    get(name: 'systemPrompt'): {
        section(value: {
            name: string;
            order: number;
            text: string;
        }): Dispose;
    };
    get(name: 'tools'): {
        restrict(value: {
            deny: string[];
        }): Dispose;
        guard(check: (exec: {
            name: string;
        }) => string | undefined): Dispose;
    };
}
export type HostSession = Session & {
    append(type: 'command/run', data: {
        commandId: string;
        name: string;
        source: {
            kind: 'user';
        };
    }): unknown;
    append(type: 'command/done', data: {
        commandId: string;
        kind: 'success' | 'error';
        text: string;
    }): unknown;
};
export interface HostAgent {
    id: string;
    session: HostSession;
    ctx: AgentScope;
    model: {
        current(): ModelSelection | undefined;
        select(value: ModelSelection): unknown;
    };
    inbox: {
        nextTurn: readonly HostMessage[];
        nextStep: readonly HostMessage[];
        clear(): void;
    };
    followup(message: {
        id: string;
        role: 'user';
        content: {
            type: 'text';
            text: string;
        }[];
        source: {
            kind: 'user';
        };
    }): unknown;
    cancel(cause: {
        kind: 'user';
    }): unknown;
}
export interface AgentHandle {
    agent: HostAgent;
    dispose(): void | Promise<void>;
}
export interface AgentFactory {
    list(): HostAgent[];
    get(id: string): HostAgent | undefined;
    resume(options: {
        resumeSessionId: string;
        setup(scope: AgentScope, agent: HostAgent): Promise<void>;
    }): Promise<AgentHandle>;
    create(options: {
        sessionId: string;
        seed: SessionEvent[];
        inheritedEventCount: number;
        meta: {
            cwd: string;
            isSeeded: true;
            agentPreset?: string;
        };
        agentOptions: ModelSelection;
        signal?: AbortSignal;
        setup(scope: AgentScope, agent: HostAgent): Promise<void>;
    }): Promise<AgentHandle>;
}
export interface ProjectionDefinition {
    key: string;
    stateVersion: number;
    stateSchema: z.ZodType;
    init(header: {
        id: string;
    }, inheritedEventCount?: number): SideState;
    apply(state: SideState, event: SideEvent): SideState;
    wire: {
        viewSchema: z.ZodType;
        summary: boolean;
        view(state: SideState): SideMetadata | {
            ended: string | null;
            messages: unknown[];
        };
    };
}
export interface Projection {
    stateOf(session: Session): SideState;
}
export interface Workspace {
    id: string;
    sessionIds: readonly string[];
    attachSession(id: string): Promise<unknown>;
    detachSession(id: string): Promise<unknown>;
}
export interface ClientModules {
    graph(): {
        entries: {
            id: string;
            url: string;
        }[];
    };
    fetchBundle(request: Request): Promise<Response>;
}
export interface WorkspaceAdapterContext {
    clientModules: ClientModules;
    webServer: {
        getOrigin(): string;
        register(route: {
            kind: 'exact';
            path: string;
            resource(request: Request): Promise<Response>;
        }): Dispose;
        tapIndex(transform: (html: string) => string): Dispose;
    };
    effect(factory: () => Dispose): unknown;
}
export interface TitleContext {
    llm: Pick<LlmRuntime, 'prepareCall'>;
    sessionTitle: Pick<SessionTitleService, 'get' | 'rename'>;
}
export interface CommandOutcome {
    kind: 'success' | 'error';
    text: string;
}
export type Operate = (parent: HostAgent, request: unknown, signal?: AbortSignal) => Promise<SideResult>;
export interface HostContext extends TitleContext {
    agents: AgentFactory;
    sessionProjections: {
        register(definition: ProjectionDefinition): Promise<Projection>;
    };
    sessions: {
        flush(session: Session): Promise<unknown>;
    };
    agentPresets: {
        mount(scope: AgentScope, preset?: string): Promise<unknown>;
        presetForSession(session: Session): string | undefined;
    };
    workingDirectory: {
        defaultDirectory: string;
    };
    workspaceRegistry: {
        list(): Workspace[];
        archiveSession(id: string, options: {
            stopActivity: true;
        }): Promise<unknown>;
    };
    webServer?: WorkspaceAdapterContext['webServer'];
    clientModules?: ClientModules;
    on(name: 'agent/created', listener: (event: {
        agent: HostAgent;
    }) => Promise<void>): unknown;
    effect(factory: () => Dispose): unknown;
    provide(name: 'codexSide', service: {
        operate: Operate;
    }): unknown;
    get(name: 'sessionController'): {
        projections(input: {
            sessionId: string;
        }, signal: AbortSignal): Promise<{
            values?: Record<string, unknown>;
        } | null>;
        state(input: {
            sessionId: string;
        }, signal: AbortSignal): Promise<{
            running: boolean;
            pendingInput?: unknown;
        }>;
    };
    commands: {
        register(definition: {
            name: string;
            definitionId: string;
            description: string;
            input: {
                hint: string;
            };
            handler(input: {
                agent: HostAgent;
                rawInput: string;
                signal?: AbortSignal;
            }): Promise<CommandOutcome>;
        }): unknown;
        execute(agent: HostAgent, line: string, attachments: unknown[], signal?: AbortSignal): Promise<{
            result: CommandOutcome;
        } | undefined>;
    };
    tools: {
        schemas(): {
            name: string;
        }[];
        register(definition: {
            name: string;
            description: string;
            parameters: Record<string, unknown>;
            output: {
                schema: Record<string, unknown>;
                render(args: unknown, value: unknown): {
                    type: 'text';
                    text: string;
                }[];
            };
            execute(args: unknown, exec: {
                agent?: HostAgent;
                signal?: AbortSignal;
            }): Promise<unknown>;
        }): unknown;
    };
}
