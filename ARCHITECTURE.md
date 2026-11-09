# TypeScript 架构

## 源码与发行入口

- `src/host/index.ts` 注册投影、适配器、服务、命令与工具。
- `src/client/index.tsx` 导出客户端 `inject/apply`，在宿主 ModuleLoader factory 内使用宿主 React。
- `scripts/build.ts` 用 esbuild 生成 `runtime/<version>/{index,core,title,workspace-adapter,client}.js`，用 tsc 输出 `runtime/<version>/types/`。
- `package.json` 的 Host、Client 与类型入口均指向当前版本目录。产物入 Git，安装无需编译；版本路径避免 Loader 复用旧模块缓存。

根目录没有另一套手写 JS。五个 JS 文件是兼容测试与宿主加载的发行入口，实际逻辑只维护在 TS/TSX 中。运行时继续保留原 DSH llm/session/session-title-llm 和 zod 依赖；构建不把宿主依赖打包成另一份实例。

## 共享协议与历史投影

`src/shared/protocol.ts` 定义稳定 key、边界标记、请求/结果及投影接口。`input.ts` 处理命令语法与结果读取，`content.ts` 读取文字，`policy.ts` 提供临时/永久规则，`projection.ts` 负责回放。

目录关系投影继续使用 `local.codexSide.v1`、stateVersion 4 和原有 checkpoint 形状；其 wire view 不包含聊天正文。独立的 `local.codexSide.transcript.v1` 非 summary 投影保留四条消息，单条 view 最多 6000 字。内部 `side-op-` 命令用于持久化已完成子操作，不触发侧栏 reveal。

JSON、工具参数、Controller 结果和客户端 projection 从 `unknown` 进入，使用字段守卫读取。未来非文本块不会成为摘要；旧日志省略 action 的展开行为继续保留。

## Host 模块

| 模块 | 职责 |
| --- | --- |
| `types.ts` | 局部宿主能力接口；持久化 Session 和 LLM 类型复用既有 SDK |
| `boundary.ts` | 在 Agent 构造前向 fork seed 写入完整 turn/step 边界 |
| `queue.ts` | 同一父会话生命周期串行，不阻塞其他父会话 |
| `policy.ts` | 为准确的 Agent 实例安装临时限制，永久化/恢复时重装对应规则 |
| `lifecycle.ts` | 创建、恢复、提问、停止、关闭和永久化，维护持久链接与 handle |
| `status.ts` | 无需恢复 Agent 即读取有界 transcript |
| `title.ts` | 选择最后有效自身问题、有界输入、辅助标题请求、fallback 与用户改名保护 |
| `workspace-adapter.ts` | 预检原生可见性函数，在公开 HTTP 资源边界插入自包含判断 |
| `registration.ts` | 人类命令与 Agent 工具；keep 仅由人类命令/按钮触发 |
| `core.ts` | 原核心 API 的兼容导出入口 |

永久化先持久化子会话，再让父会话断开临时链接。已写入转换记录的子会话即使后续 flush 失败，也不会被下一次 close 误归档。标题生成的取消、超时、失败 fallback、并发用户改名优先及待处理问题的原生 V4 约束保持不变。

官方标题执行器声明需要完整 Cordis Context，当前兼容版本实际上只读取 `ctx.llm`；`title.ts` 将该断言限制在这一调用边界，内部仍用局部能力接口。工作区判断通过函数源码注入浏览器，故刻意保持无闭包依赖，不能改用外部 helper。

## Client 模块

`host.ts` 描述最小 React/宿主接口，`components.tsx` 嵌入原生 Conversation 并提供面板、错误和转换按钮。`hooks.ts` 连接 locale/projection/外部状态；`projections.ts` 对快照按字段验证，并兼容旧的部分投影，避免在外部 store 读取中生成新对象。

`state.ts` 每次 apply 独立管理失败订阅、已见 revision、转换关闭标识，以及最多四并发的缺失摘要补读。`operations.ts` 保持命令、reveal 和转换后的 retain → close → open → release 顺序；手动关闭、替换旁支或后续导航可以使旧跳转失效。`events.ts` 只隐藏内部命令；`presentation.ts` 集中文案、CSS 和常量。

客户端产物继续使用 browser CJS、classic React.createElement 和宿主 `require('react')`；不会打入第二份 React，也不依赖浏览器解析 npm ESM。

## 构建与验证

`npm run check` = 严格 `tsc --noEmit` + 测试入口构建 + 原有回归。`test/runtime.js` 从清单解析当前版本目录，所有测试都运行发行 JS；客户端 VM 检查真实生成的 ModuleLoader 包装。CI 在检查后验证 Git 中的 runtime 没有重建差异。发布流程见 [RELEASING.md](./RELEASING.md)。
