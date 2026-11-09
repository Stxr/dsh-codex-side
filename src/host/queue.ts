/** 同一主会话串行执行生命周期变更，不阻塞其他主会话；失败不毒化队列。 */
export function keyedQueue() {
  const pending = new Map<string, Promise<unknown>>();
  return <T>(key: string, operation: () => T | Promise<T>): Promise<T> => {
    const previous = pending.get(key) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(operation);
    pending.set(key, next);
    return next.finally(() => { if (pending.get(key) === next) pending.delete(key); });
  };
}
