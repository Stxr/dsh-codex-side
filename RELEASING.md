# 发布维护

本仓库通过 GitHub 和 DSH format 1 自定义索引分发，不发布到 npm registry。`private: true` 用来防止误发 npm，不影响 Git 来源或 Release `.tgz` 安装。

索引源必须由用户自行添加。发布脚本只写仓库中的 JSON，不访问 DSH profile，不订阅索引，也不安装或启用插件。GitHub 仓库保留 `dsh-plugin` topic，方便用户发现项目。

## 准备版本

以下命令应从完整 Git 克隆中运行。索引构建需要 Git 历史和开发依赖，不是 Release 归档的用户安装步骤。

1. 在 `package.json` 更新版本、`exports` 与 `files` 中的 runtime 目录；同时更新 `.gitignore` 的当前 runtime 白名单，以及 README 中对应链接。
2. 根据实际验证设置 `engines.dsh`，不要把未验证的 Harness 版本声明为兼容。
3. 执行：

```sh
npm ci --ignore-scripts
npm run build
npm run check
npm test
npm pack --ignore-scripts
```

确认压缩包包含补丁、双语元数据、图标、许可证和全部版本化模块。提交源码、锁文件与当前 runtime；不要提交依赖、缓存、旧构建、`.env` 或本地压缩包。

## 固定版本与索引

先提交实现并为这个源提交创建版本 tag，例如 `v1.4.2`。索引不能把 Git 来源指向可移动的分支或 tag，必须使用完整的 40 位 commit：

```sh
git rev-parse 'v1.4.2^{commit}'
npm run index:build -- FULL_40_CHARACTER_COMMIT
npm run index:check
```

`index:build` 从指定提交读取清单和双语元数据，使用提交时间作为首次发布时间，保留已有版本。若相同版本已经固定到另一个提交，会拒绝重新指向；修改实现应发布新版本。

索引是实现提交之后的独立维护提交：它指向已经存在的实现提交，从而避免 commit 自引用。提交并推送 `dsh-plugin-index.json` 后，用户的 main 分支索引才会列出该版本。旧版本继续指向原提交。

## GitHub Release

推送源提交、索引提交与版本 tag，创建对应 Release，上传 `npm pack` 产出的 `.tgz`，以及只包含发行资产的 SHA-256 清单。Release tag 应指向已固定的实现提交，不指向后续索引维护提交。

发布后检查：

- 仓库为公开仓库，具有 `dsh-plugin` topic。
- 匿名读取 raw 索引、图标及固定提交的清单均成功，索引通过官方 `parseMarketIndex` 校验。
- 固定提交中存在清单导出的 runtime 文件，Git 安装不依赖安装脚本。
- Release 的 tag、版本、下载包和 SHA-256 一致。
- README 明确要求用户自行添加索引源；不将 topic 描述为自动安装或官方收录。

正式索引地址：

```text
https://raw.githubusercontent.com/Stxr/dsh-codex-side/main/dsh-plugin-index.json
```
