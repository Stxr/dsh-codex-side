import { RESULT, errorMessage } from '../shared/protocol.js';
import { decodeResult, parseInput, readRequest } from '../shared/input.js';
import type { HostContext, Operate } from './types.js';

export function registerOperations(ctx: HostContext, operate: Operate): void {
  ctx.provide('codexSide', { operate });
  ctx.commands.register({
    name: 'side', definitionId: '@local/dsh-codex-side:side',
    description: '旁支对话：继承上下文提问，主任务继续 / Ask in a side conversation',
    input: { hint: '[问题 / question] | --new [question] | --keep | --close | --stop | --status' },
    handler: async ({ agent, rawInput, signal }) => {
      try {
        const result = await operate(agent, parseInput(rawInput), signal);
        return { kind: 'success', text: RESULT + JSON.stringify(result) };
      } catch (error) { return { kind: 'error', text: errorMessage(error) }; }
    },
  });
  ctx.tools.register({
    name: 'side_conversation',
    description: 'Open, ask in, inspect, stop, or close a side conversation that inherits the current context. Replies stay in that conversation; status returns its recent messages. Closing stops and archives it.',
    parameters: { type: 'object', properties: {
      action: { type: 'string', enum: ['open', 'ask', 'new', 'close', 'stop', 'status'] },
      question: { type: 'string', description: 'Question for ask; optional opening question for open or new.' },
    }, required: ['action'], additionalProperties: false },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(args, exec) {
      if (!exec.agent) throw new Error('An active conversation is required.');
      // keep 解除旁支限制，仅由人类命令和按钮触发，不加入 Agent 工具动作。
      const request = readRequest(args, false);
      if (request.action === 'ask' && !request.question?.trim()) throw new Error('A question is required for ask.');
      const line = request.action === 'new' ? `/side --new ${request.question ?? ''}`
        : request.action === 'close' ? '/side --close' : request.action === 'stop' ? '/side --stop' : request.action === 'status' ? '/side --status'
        : request.question?.trim() ? `/side --ask ${request.question}` : '/side';
      const execution = await ctx.commands.execute(exec.agent, line, [], exec.signal);
      if (!execution || execution.result.kind === 'error') throw new Error(execution?.result.text ?? 'Side command unavailable.');
      return decodeResult(execution.result.text);
    },
  });
}
