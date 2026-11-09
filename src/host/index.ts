import { z } from 'zod';
import { KEY, TRANSCRIPT_KEY } from '../shared/protocol.js';
import { fold, initState, initTranscriptState, metadataView, transcriptView } from '../shared/projection.js';
import { installWorkspaceAdapter } from './workspace-adapter.js';
import { createSideService } from './lifecycle.js';
import { registerOperations } from './registration.js';
import type { HostContext } from './types.js';

export const inject = ['commands', 'agents', 'sessions', 'sessionProjections', 'tools', 'systemPrompt', 'agentPresets', 'workingDirectory', 'workspaceRegistry', 'webServer', 'clientModules', 'llm', 'sessionTitle'];

export async function apply(ctx: HostContext): Promise<void> {
  const projection = await ctx.sessionProjections.register({
    key: KEY, stateVersion: 4, stateSchema: z.json(), init: initState, apply: fold,
    wire: { viewSchema: z.json(), summary: true, view: metadataView },
  });
  await ctx.sessionProjections.register({
    key: TRANSCRIPT_KEY, stateVersion: 1, stateSchema: z.json(), init: initTranscriptState, apply: fold,
    wire: { viewSchema: z.json(), summary: false, view: transcriptView },
  });
  if (ctx.webServer && ctx.clientModules) await installWorkspaceAdapter({
    webServer: ctx.webServer, clientModules: ctx.clientModules, effect: factory => ctx.effect(factory),
  });
  const { operate } = await createSideService(ctx, projection);
  registerOperations(ctx, operate);
}
