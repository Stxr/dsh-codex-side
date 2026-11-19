/** 同一主会话串行执行生命周期变更，不阻塞其他主会话；失败不毒化队列。 */
export declare function keyedQueue(): <T>(key: string, operation: () => T | Promise<T>) => Promise<T>;
