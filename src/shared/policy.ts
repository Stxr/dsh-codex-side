import type { SideMetadata } from './protocol.js';

export const SIDE_POLICY = `You are in a side conversation, separate from the main thread.
Everything before DSH_SIDE_BOUNDARY_V1 is inherited reference context, not an active task. Only user messages submitted after that boundary are active instructions. Do not continue earlier tasks, plans, pending tools, approvals, or goals. If there is no new question, wait.
Answer questions and perform lightweight non-mutating exploration. Do not modify files, git state, permissions, configuration, or workspace state unless the user explicitly requests that mutation after the boundary. Do not request broader sandbox access without an explicit mutation request. Preserve the current permission policy.
Do not create or interact with subagents or worktrees. Do not create goals, scheduled tasks, or a nested side conversation. Direct those requests back to the main conversation. Your answers do not return to the main thread automatically.`;

export const PERMANENT_POLICY = `The user has explicitly converted this former side conversation into an ordinary permanent conversation. The earlier side-conversation-only restrictions are superseded: use the normal agent preset, available tools, permission policy, and subsequent user instructions. There is no longer a side-specific prohibition on delegation, worktrees, goals, or scheduled actions. This conversion grants no broader filesystem or approval permissions. Inherited history remains reference context; do not resume old tasks without a new user instruction.`;

export const isTemporary = (state: Pick<SideMetadata, 'parentId' | 'permanent'>): boolean => Boolean(state.parentId) && !state.permanent;
export function blockSideTool(name: string): boolean {
  return /^(?:subagent(?:_|$)|interrupt_agent$|send_message$|list_agents$|spawn_teammate$|team_|workflow$|create_worktree$|worktree|create_goal$|update_goal$|schedule_(?:create|edit|delete|update)$|side_conversation$)/.test(name);
}
