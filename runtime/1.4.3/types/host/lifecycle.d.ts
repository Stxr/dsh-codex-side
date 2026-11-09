import type { HostContext, Operate, Projection } from './types.js';
export declare function createSideService(ctx: HostContext, projection: Projection): Promise<{
    operate: Operate;
}>;
