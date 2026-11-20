/** 原 core.js API 的兼容构建入口；实际实现按协议、投影和宿主职责拆分。 */
export * from '../shared/protocol.js';
export * from '../shared/policy.js';
export * from '../shared/content.js';
export * from '../shared/input.js';
export * from '../shared/projection.js';
export { withSideBoundary } from './boundary.js';
export { keyedQueue } from './queue.js';
