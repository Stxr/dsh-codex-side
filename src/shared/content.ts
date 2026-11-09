import { isRecord } from './protocol.js';

/** 只读取已验证的文本块；未来版本的非文本内容不进入摘要。 */
export function textOf(message: unknown): string {
  if (!isRecord(message) || !Array.isArray(message.content)) return '';
  const blocks: unknown[] = message.content;
  return blocks.filter((block): block is { type: 'text'; text: string } =>
    isRecord(block) && block.type === 'text' && typeof block.text === 'string').map(block => block.text).join('\n');
}
