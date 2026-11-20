import type { HostAgent, HostContext, Projection } from './types.js';
export declare function createPolicy(ctx: HostContext, projection: Projection): {
    install: (agent: HostAgent) => Promise<void>;
    dispose(): Promise<void>;
};
