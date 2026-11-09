import { RESULT, isRecord } from './protocol.js';
import type { SideRequest, SideResult } from './protocol.js';

export function parseInput(raw = ''): SideRequest {
  const text = raw.trim();
  if (text === '--close') return { action: 'close', question: '' };
  if (text === '--status') return { action: 'status', question: '' };
  if (text === '--stop') return { action: 'stop', question: '' };
  if (/^--keep(?:\s|$)/.test(text)) {
    const childId = text.slice(6).trim();
    if (childId && !/^[\w-]+$/.test(childId)) throw new Error('无效的旁支标识。 / Invalid side session id.');
    return { action: 'keep', question: '', ...(childId ? { childId } : {}) };
  }
  if (/^--new(?:\s|$)/.test(text)) return { action: 'new', question: text.slice(5).trim() };
  if (/^--ask(?:\s|$)/.test(text)) {
    const question = text.slice(5).trim();
    if (!question) throw new Error('请在 --ask 后输入问题。 / Add a question after --ask.');
    return { action: 'ask', question };
  }
  return { action: text ? 'ask' : 'open', question: text };
}

export function decodeResult(text: unknown): (Pick<SideResult, 'parentId' | 'childId'> & Record<string, unknown>) | null {
  if (typeof text !== 'string' || !text.startsWith(RESULT)) return null;
  try {
    const value: unknown = JSON.parse(text.slice(RESULT.length));
    if (!isRecord(value) || typeof value.parentId !== 'string'
      || (typeof value.childId !== 'string' && value.childId !== null)) return null;
    // 已验证必填关系；额外字段保留，回放使用前分别检查其类型。
    return { ...value, parentId: value.parentId, childId: value.childId };
  } catch { return null; }
}

export function readRequest(value: unknown, allowKeep = true): SideRequest {
  if (!isRecord(value) || typeof value.action !== 'string'
    || !['open', 'ask', 'new', 'close', 'stop', 'status', ...(allowKeep ? ['keep'] : [])].includes(value.action)) {
    throw new Error('Invalid side action.');
  }
  if (value.question !== undefined && typeof value.question !== 'string') throw new Error('Invalid side question.');
  if (value.childId !== undefined && typeof value.childId !== 'string') throw new Error('Invalid side session id.');
  const action = value.action as SideRequest['action'];
  return { action, ...(typeof value.question === 'string' ? { question: value.question } : {}),
    ...(typeof value.childId === 'string' ? { childId: value.childId } : {}) };
}
