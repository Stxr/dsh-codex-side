# 1.4.3 验证记录

验证日期：2026-11-10。环境：Node.js 24，npm，DeepSeek Harness SDK `0.2.2-rc.1`。本节记录发布前的自动化验证；验证未修改安装中的 DSH profile。

## 自动验证

- `npm run check`：严格 TypeScript 检查、版本化构建及完整 73 项回归通过。
- 测试通过 `test/runtime.js` 从清单读取当前发行目录，全部指向 `runtime/1.4.3` 产物；客户端用 VM 执行真实 ModuleLoader 包装。
- `npm run index:check`：官方 format 1 校验通过，1.4.2 旧版本的不可变 Git pin 保持原值。检查允许发布准备阶段的源码版本尚未加入索引。
- 无显式 `any`、`ts-ignore` 或 `ts-nocheck`；JSON、工具参数、投影和 Controller 数据使用 `unknown` 字段守卫。
- 对照原实现的独立代码审阅未发现阻塞行为回归。

## 回归覆盖

73 项包括旁支命令语法、同父串行队列、原生 fork seed、完整边界回合、原生 V4 编码与冷恢复、复制 inbox 清空、创建/挂载/flush 失败恢复、恢复后的 policy 重装、内部命令去重与 sidebar reveal、永久化幂等性和分组选择。

标题用例覆盖已提交/排队/next-step 问题的时序选择、已取消/编辑移除问题排除、有界 CJK/emoji/转义输入、最低 reasoning effort、失败 fallback、tool-call 拒绝、取消、并发用户改名优先，以及原生持久化引用。

客户端验证覆盖内部命令隐藏、转换完成前等待、retain-close-open-release、手动关闭/替换旁支/后续导航的竞争保护、目录/命令失败和引用释放。工作区适配验证覆盖各归档模式、未知/重复函数签名拒绝、cache identity、GET/HEAD 和路由卸载。

## 产物与发布检查

两次构建的 30 个版本化产物 SHA-256 逐文件一致，包括五个兼容 JS 入口和 25 个声明文件。`npm pack --ignore-scripts` 生成的发行包包含 79 个文件；运行入口、完整声明引用链、TS/TSX 源码、构建脚本、测试 helper、双语元数据、补丁和许可证均核对通过。未打包旧 runtime、根手写 JS、依赖或本地缓存。

版本化路径继续作为 Loader generation 的缓存边界。根手写 JS 和旧 `.mjs` runner 已清理。Git 安装及 Release 包均直接加载当前 runtime，无安装时构建脚本。

发布遵循实现提交 → tag → 独立索引提交的顺序，索引固定到实现提交。正式发布还需核对匿名索引、GitHub CI 和 Release SHA-256。

## 范围

测试使用真实 Session/原生 V4 codec、真实 LLM chunk assembler及可控服务 stub，不访问用户模型、不执行真实归档、不对在线 Harness 做视觉验收。这次验证证明源码迁移、发行入口和已有行为回归，不替代模型服务或浏览器的在线验收。
