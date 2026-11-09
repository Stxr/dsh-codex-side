import { SIDE_POLICY, PERMANENT_POLICY, blockSideTool, isTemporary } from '../shared/policy.js';
import type { Dispose, HostAgent, HostContext, Projection } from './types.js';

export function createPolicy(ctx: HostContext, projection: Projection) {
  const scoped = new Map<HostAgent, { mode: 'side' | 'permanent'; dispose: Dispose }>();
  async function install(agent: HostAgent): Promise<void> {
    const state = projection.stateOf(agent.session);
    const mode = isTemporary(state) ? 'side' : state.permanent ? 'permanent' : null;
    const previous = scoped.get(agent);
    if (previous?.mode === mode) return;
    await previous?.dispose();
    if (!mode) return;
    const entry: { mode: 'side' | 'permanent'; dispose: Dispose } = { mode, dispose: () => {} };
    entry.dispose = agent.ctx.effect(() => {
      // 转换记录已持久化；恢复时也安装普通会话说明，覆盖历史旁支限制。
      const prompt = agent.ctx.get('systemPrompt').section({
        name: mode === 'side' ? 'local-codex-side-boundary' : 'local-codex-side-permanent',
        order: mode === 'side' ? 100000 : 100001,
        text: mode === 'side' ? SIDE_POLICY : PERMANENT_POLICY,
      });
      const tools = agent.ctx.get('tools');
      const denied = mode === 'side' ? ctx.tools.schemas().map(tool => tool.name).filter(blockSideTool) : [];
      const restrict = denied.length ? tools.restrict({ deny: denied }) : () => {};
      const guard = mode === 'side' ? tools.guard(exec => blockSideTool(exec.name)
        ? 'Side conversations cannot use subagents, worktrees, goals, or scheduled actions. Return to the main conversation.' : undefined) : () => {};
      return () => {
        guard(); restrict(); prompt();
        if (scoped.get(agent) === entry) scoped.delete(agent);
      };
    });
    scoped.set(agent, entry);
  }
  return {
    install,
    async dispose(): Promise<void> {
      for (const entry of scoped.values()) await entry.dispose();
      scoped.clear();
    },
  };
}
