# Codex-style /side for DeepSeek Harness

![Side conversations](./icon.svg)

在主任务继续运行时打开临时旁支，继承当前上下文，在右侧栏独立提问和追问。需要保留时，将旁支转为永久对话，自动生成标题并进入主对话所在分组。

Codex-style side conversations for DeepSeek Harness: ask in a native sidebar without interrupting the main task, then keep a branch as a permanent conversation with an AI-generated title.

**兼容版本：DeepSeek Harness `0.2.2-rc.1`。** 当前发行版只声明对这个版本的兼容性；会话列表适配依赖该版本的组件结构。

## 安装：用户自行添加索引源

本项目是第三方插件。按照 DSH 自定义插件索引的机制，**用户需要自行添加索引源**。仓库的 `dsh-plugin` topic 用于发现项目，不代表官方收录，也不会自动订阅索引、安装插件或修改用户的配置。

索引 URL：

```text
https://raw.githubusercontent.com/Stxr/dsh-codex-side/main/dsh-plugin-index.json
```

1. 在 Harness 中打开 **插件 → 发现**（Plugins → Discover）。
2. 点击 **添加索引源**，或在索引菜单中选择 **管理索引源…**，手动粘贴上面的 URL。
3. 在该索引中找到「旁支对话 /side」，查看版本和兼容性后安装。
4. 安装完成后刷新 Harness 页面一次，再输入 `/side`。

如果界面没有「发现」，请先启用 DSH 提供的自定义插件索引功能。此插件不会替用户开启该功能或添加任何索引。DSH 的索引读取服务默认没有源，仅读取用户配置的源；格式依据官方 [`dsh-plugin-market-index`](https://www.npmjs.com/package/@deepseek-ai/dsh-plugin-market-index) 的 format 1 校验器。

English: open **Plugins → Discover → Add index source**, add the URL above yourself, then install **Side conversations** and refresh the page. The GitHub topic does not subscribe you to the index.

### 发行包安装

也可从 [Releases](https://github.com/Stxr/dsh-codex-side/releases) 下载 `.tgz`，在 Harness 的插件安装入口选择该文件。包内已包含运行时文件，无须在安装时构建。运行时依赖由插件管理器安装；本项目没有安装脚本，也未发布到 npm registry。

卸载通过 Harness 插件管理器进行。索引源由用户独立管理，卸载插件不会替用户删除索引。

## 使用

| 操作 | 命令 |
| --- | --- |
| 创建或展开当前旁支 | `/side` |
| 在旁支提问或追问 | `/side 为什么这样设计？` |
| 关闭旧旁支，从主对话当前上下文重新分叉 | `/side --new 新问题` |
| 转为永久普通会话 | `/side --keep`，或点击旁支顶部按钮 |
| 停止旁支当前回答，保留会话 | `/side --stop` |
| 停止并归档旁支 | `/side --close` |
| 查询当前旁支 | `/side --status` |
| 提问内容本身以控制参数开头 | `/side --ask --close 是什么意思？` |

### 临时旁支

- 主对话留在中央继续运行，旁支在原生右侧栏打开。
- 临时旁支不进入左侧分组、平铺或搜索会话列表；只有转永久后才显示。
- 使用主会话同一套原生 Chat、Markdown、Mermaid、工具卡片、流式回答、附件、审批和输入组件。
- 折叠侧栏保留旁支与输入草稿，再次 `/side` 可继续使用同一个旁支。
- 点击临时旁支 tab 的叉号会停止并归档它。插件不额外添加「返回」「结束」按钮或输入框下方入口。

### 转为永久对话

点击「转为永久对话」后：

1. 保留同一个会话 ID、上下文、历史与运行状态，解除旁支专属限制。
2. 根据旁支最后一次有效文字提问生成简短 AI 标题，也考虑尚在排队的提问。
3. 加入主对话**转换当时**所在的原生工作区分组；主对话未分组时才保持未分组。
4. 成功后关闭当前旁支 tab，在主区域打开对应的永久会话。

标题使用旁支当前模型及其最低支持的思考档位，只发送有界的提问文本，不发送继承的主任务历史。标题请求设有 15 秒截止时间；失败时用提问摘要兜底，没有旁支文字提问则保留原标题。生成期间手动改名会优先保留用户标题。之后重复转换、恢复或重载不会再次改名或覆盖用户后来移动的分组。

转换失败保留 tab 和当前选择并显示错误。等待期间用户已经关闭 tab、创建另一旁支或切换主会话时，跳转不会覆盖后来的选择。永久会话关闭视图时不会停止或归档。原主对话随后再次 `/side` 会创建新的临时旁支。

转换状态写入日志，冷恢复后仍生效。由于转换解除旁支专属限制，该动作仅向用户按钮和人类命令开放，不加入 Agent 的 `side_conversation` 工具动作。原有权限、审批和 preset 继续适用。

## 行为与边界

- 复用主对话当前 provider、model、显式 reasoning effort、工作目录和 preset。
- 通过原生 fork seed 复制命令发出时已提交的上下文，包括运行中工具调用的合成结束记录；不复制主对话后续变化。
- 继承历史只作参考，旁支问答不会自动注入主对话，也不会自动继续继承的旧任务。
- 创建时清空继承的待处理输入，将边界作为完整合成回合写入 seed，保证原生日志恢复与下一回合编号有效。
- 临时旁支可读文件和轻量检查；修改需要在旁支中明确提出，并受已有权限约束。这包含模型指令约束，不是额外的文件沙箱。
- 临时旁支禁止子代理、worktree、目标自动续跑、定时动作与嵌套旁支。转永久后解除这些旁支专属限制。
- 每个主对话复用一个当前旁支；不同主对话独立。同一主对话的创建、提问和关闭串行处理。
- 聊天渲染、分页和交互由原生组件负责。目录只接收轻量关系元数据；Agent status 使用独立的有界摘要。
- 内部恢复检查点写入原生日志，但不作为额外 `/side` 行展示。真实命令的错误仍可见。
- 「关闭」采用停止并归档，保留日志；归档历史仍可恢复。

## 兼容方式

Harness `0.2.2-rc.1` 没有公开的会话可见性筛选注册表。插件通过 `webServer` / `clientModules` 的公开 HTTP 资源和 index-transform 接口，为原生工作区浏览器的共享可见性函数增加临时旁支判断。继续使用原有浏览器、分组、排序、搜索和计数，不修改应用文件，不伪装子代理，也不改变完整 Session catalogue 或归档状态。

适配先检查原生函数签名，未知结构会明确报错。相关 bundle URL 添加适配版本以避开旧的 immutable 浏览器缓存；首次安装后需要刷新页面。卸载撤销路由和 index 处理。旧旁支缺少目录元数据时，以最多 4 并发的 projection 读取补齐，不启动 Agent。

原生标题辅助记录只能引用已提交的人类消息：已提交问题使用官方标题执行模块；排队问题使用普通辅助 LLM 请求，避免伪造 V4 引用。标题通过原生用户重命名操作接受并保存，独立于聊天和工具执行。

## 开发

需要 Node.js 24 和 npm。

```sh
git clone https://github.com/Stxr/dsh-codex-side.git
cd dsh-codex-side
npm ci --ignore-scripts
npm run build
npm run check
npm test
```

在 Harness 中进行本地开发安装时，将插件安装目标设为这个克隆目录的**绝对路径**。目录安装会链接源码；先安装依赖并构建，再通过 Harness 的 `plugin_manager` 安装。不要在 DSH profile 目录手动运行包管理器或编辑 profile 清单。

公开 Git 版本包含当前 [runtime](./runtime/1.4.2/) 和 [锁文件](./package-lock.json)，从索引安装不依赖安装脚本。源码与版本化输出由 [构建脚本](./scripts/build.mjs) 同步。

测试覆盖旁支生命周期、原生 V4 编码与冷恢复、命令去重、永久化与分组、tab 关闭和跳转、AI 标题选择与失败保护。测试使用可控 LLM stub，不代表对用户实际模型服务的在线验收。

## 发布与索引维护

[发布说明](./RELEASING.md) 记录构建、版本固定和索引更新步骤。索引中的 Git 来源固定到完整 40 位 commit，而不是可移动的分支或 tag；同时提供 Release `.tgz` 和 SHA-256 校验值。维护者更新仓库中的索引文件，用户是否添加、刷新或移除该源始终由用户自行决定。

## 许可证与来源

[MIT](./LICENSE)。图标为本项目原创 SVG。参考行为来自 OpenAI Codex 的 [side.rs](https://github.com/openai/codex/blob/main/codex-rs/tui/src/app/side.rs)。本项目为独立实现，不隶属于 OpenAI 或 DeepSeek，也不包含 Codex CLI。
