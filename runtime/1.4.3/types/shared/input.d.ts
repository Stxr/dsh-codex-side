import type { SideRequest, SideResult } from './protocol.js';
export declare function parseInput(raw?: string): SideRequest;
export declare function decodeResult(text: unknown): (Pick<SideResult, 'parentId' | 'childId'> & Record<string, unknown>) | null;
export declare function readRequest(value: unknown, allowKeep?: boolean): SideRequest;
