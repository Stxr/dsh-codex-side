# 发布维护

本仓库通过 GitHub 和 DSH format 1 自定义索引分发，不发布到 npm registry。`private: true` 防止误发 npm，不影响 Git 来源或 Release `.tgz` 安装。索引源由用户自行添加；维护脚本只写仓库 JSON，不访问 DSH profile、订阅索引或安装插件。GitHub 仓库保留 `dsh-plugin` topic 供发现。

## 准备版本

从完整 Git 克隆、Node.js 24 环境运行。TypeScript 是唯一维护源码，发行目录必须随实现提交，Git 安装不执行构建脚本。

1. 更新 `package.json` 和锁文件的版本；同步 `main`、`types`、`exports`、`files` 中的 `runtime/<version>/`，以及 `.gitignore` 当前版本白名单和 README 链接。构建器会检查运行时导出路径。
2. 保留每次发布独立的版本化路径，例如 `runtime/1.4.3/index.js` 与 `runtime/1.4.3/client.js`。DSH Loader 需要新的路径才能得到新的模块 generation；不要用固定路径 shim 替代。
3. 根据实际验证设置 `engines.dsh`，保留经验证的宿主运行依赖版本。
4. 执行：

```sh
npm ci --ignore-scripts
npm run check
npm run index:check
npm pack --ignore-scripts
```

`check` 执行严格类型检查，再由测试入口构建五个 JS 产物及声明，然后运行全部回归。`index:check` 同时接受字符串和对象形式的包导出，并允许源码新版本尚未进入索引。索引构建脚本也已迁为 TS。

检查压缩包包含版本化 Host/Client、兼容核心/标题/工作区适配模块、声明引用链、补丁、双语元数据、图标和许可证。提交 TS 源码、构建与测试脚本、锁文件、文档和当前 runtime；移除旧发行目录，不提交依赖、缓存、`.env` 或本地压缩包。CI 重建后检查已提交 runtime 的一致性。

## 固定版本与索引

发布按以下顺序进行：**实现提交 → 版本 tag → 独立索引提交**。先提交实现并为这个源提交创建版本 tag，例如 `v1.4.3`。索引只能固定到完整的 40 位 commit，不能指向可移动的分支或 tag。

```sh
git rev-parse 'v1.4.3^{commit}'
npm run index:build -- FULL_40_CHARACTER_COMMIT
npm run index:check
```

`index:build` 从指定提交读取清单和双语元数据，使用提交时间作为首次发布时间，保留已有版本；同版本若已固定到另一提交会拒绝重新指向。实现修改应发布新版本。

`dsh-plugin-index.json` 是实现提交之后的独立维护提交：它指向已经存在的实现提交，避免 commit 自引用。实现准备阶段版本为 1.4.3、索引仍服务旧版是正常状态。提交并推送索引后，main 分支索引才会列出新版本；旧版本继续指向原提交。

## GitHub Release

推送源提交、索引提交与版本 tag，创建对应 Release，上传 `npm pack` 产出的 `.tgz` 和仅包含发行资产的 SHA-256 清单。Release tag 指向固定的实现提交，不指向后续索引维护提交。

发布后检查：

- 仓库公开且具有 `dsh-plugin` topic。
- raw 索引、图标和固定提交清单可匿名读取，索引通过官方 `parseMarketIndex`。
- 固定提交中存在清单导出的版本化 runtime 和类型声明，Git 安装不依赖安装脚本。
- Release tag、版本、下载包和 SHA-256 一致。
- README 要求用户自行添加索引源，不将 topic 描述为自动安装或官方收录。

正式索引地址：

```text
https://raw.githubusercontent.com/Stxr/dsh-codex-side/main/dsh-plugin-index.json
```
