import type { ClientModules, WorkspaceAdapterContext } from './types.js';
/** 此函数会以源码插入原生浏览器，必须保持闭包无外部依赖。 */
export declare function isTemporarySideSummary(session: unknown): boolean;
export declare function patchWorkspaceSource(source: string): string;
export declare function stampWorkspaceUrls(html: string): string;
export declare function createWorkspaceResource(clientModules: Pick<ClientModules, 'fetchBundle'>): (request: Request) => Promise<Response>;
export declare function installWorkspaceAdapter(ctx: WorkspaceAdapterContext): Promise<void>;
