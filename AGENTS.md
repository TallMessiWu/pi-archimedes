# AGENTS.md

本文件约束本 fork 的开发工作。先读本文件和 `README.md`，再修改代码；不要把保留的上游 monorepo 文档当成本分支的安装或发布规则。

## 项目定位

- 上游：[danielcherubini/pi-archimedes](https://github.com/danielcherubini/pi-archimedes)。本 fork 基于 v2.11.2 的命名插件修改，保留上游历史、署名和 MIT 许可证。
- 本仓：[TallMessiWu/pi-archimedes](https://github.com/TallMessiWu/pi-archimedes)。当前开发和 Git 分发分支是 `session-name-early`。
- 目标：在首条用户输入时启动独立的后台命名请求，不等第一轮回答结束；仅修改会话名字，保留 Pi 原生 `π` 标识和运行转圈。
- 根包只加载命名插件，不安装或启用整套 Archimedes UI。其余上游源码保留供追溯和同步，不属于当前交付范围。
- 不依赖上游 Archimedes npm 包。命名代码在本仓，配置和日志助手通过 `file:packages/core` 随 Git checkout 提供。

## 关键文件

| 路径 | 用途 |
| --- | --- |
| `packages/session-name/src/index.ts` | 首条输入触发、模型选择、命名请求和生命周期保护 |
| `packages/session-name/src/index.test.mjs` | 真实 Pi loader + mock 模型的回归测试 |
| `packages/core/src/settings-io.ts`、`log.ts` | 本仓内的配置和日志助手 |
| `package.json`、`package-lock.json` | 命名插件单独分发入口及依赖锁定 |
| `scripts/test-production.mjs` | 临时目录内的离线生产安装验证 |
| `tsconfig.session-name.json` | 当前交付代码的类型检查范围 |
| `.github/workflows/ci.yml` | Node.js 22/24 上的类型检查、回归和生产安装测试 |
| `.agents/skills/gitmoji-commit/SKILL.md` | 必须遵循的提交格式及推送权限规则 |

## 分支和历史

- **不在 `main` 开发**。`main` 保持上游镜像；当前修改放在 `session-name-early`，其他独立工作可使用新的功能分支或 worktree。
- `origin` 是我们的 fork，`upstream` 是原仓。推送时明确指定远端和分支，禁止误推上游。
- 保留上游提交、标签和作者信息；Gitmoji 规范约束我们新写或整理的提交，不追溯改写继承的上游历史。
- 同步前先 fetch、检查差异，再按需 merge/cherry-pick。保持命名独立分发入口，不把上游 pnpm workspace 或整套插件入口直接覆盖回来。
- 不擅自重写已发布历史。用户要求整理历史时可进行本地 amend/reword/rebase，但 force push 必须另行确认。
- 普通 fast-forward push 无需确认；任何 force push（包括 `--force-with-lease` 或带 `+` 的 refspec）都必须先说明目标、旧/新提交和影响并获批。
- 获批后使用绑定明确远端旧 SHA 的 lease，只更新获批分支。远端变化或 lease 失败就停下核对，不用无保护的 `--force`，不绕过确认。

## 提交规范

提交前读取 `.agents/skills/gitmoji-commit/SKILL.md`。格式为：

```text
<emoji-code> <type>(<scope>): <中文 subject>
```

- 使用 Gitmoji 代码，例如 `:sparkles:`、`:bug:`、`:memo:`、`:robot:`，不用实际 emoji 字符替代代码。
- Subject 使用中文、动词开头、最多 50 个字符；type/scope 使用简短英文。
- 根据主要意图选择最准确的 Gitmoji/type，按逻辑单元提交。一般只用一个 `-m`，不堆砌无必要的正文。
- **不要求用户确认提交信息或普通提交**；完成必要验证后直接提交。普通 push 同样不确认，只有 force push 需要确认。
- 暂存前后检查 diff，只提交本任务相关文件，不覆盖、撤销或夹带用户已有改动。

示例：

```sh
git commit -m ":sparkles: feat(session-name): 支持首条输入后台命名"
git commit -m ":memo: docs(readme): 补充修改说明和安装命令"
git commit -m ":robot: chore(agent): 完善项目约定和提交规范"
```

## 安装、依赖和发布

- 安装方式以根 README 为准，必须使用 fork 的命名分支：
  `pi install git:github.com/TallMessiWu/pi-archimedes@session-name-early`。
- 根目录使用 **npm + package-lock.json**，不是上游 pnpm workspace。不要添加 `workspace:*`、全仓 workspaces 或仅允许 pnpm 的 preinstall 钩子。
- 根 Pi manifest 只能指向 `packages/session-name/src/index.ts`；不要改回 `meta/src/index.ts`，不要把开发用 skill 分发为插件资源。
- 保留跨包 subpath imports（如 `@pi-archimedes/core/log`），由本地 core 依赖解析；禁止引用用户机器上旧 npm 安装或已删除的本地补丁。
- Pi host 包由运行中的 Pi 提供。peerDependencies 使用 `*`，不要放入生产 dependencies；根开发依赖当前固定 Pi 1.4.0，`@types/node` 固定 22.19.19。
- core 的开发依赖由根包管理，不在 `packages/core/package.json` 恢复 host devDependencies：npm 安装 `file:` 依赖时，即便 `--omit=dev` 也曾引入嵌套 host，必须用生产安装测试防回归。
- Pi 直接加载 TypeScript，无需编译发布。根包为 private，仅通过 Git 分发；不恢复上游 npm 发布 workflow，不向上游包名发布。
- 未获用户要求，不操作真实 `~/.pi/agent/settings.json`、凭据或插件安装；安装验证使用临时 `PI_CODING_AGENT_DIR`。

## 必须保留的行为

- `input` 处理器不能等待命名模型完成，同一运行时最多一个命名请求。
- 使用首条用户文本，最多 500 字符；恢复未命名会话时优先取原始用户消息，不依赖助手回答。
- 已有名字直接跳过；结果落地前再次检查，不能覆盖请求期间设置的手动名字。
- `session_shutdown` 取消请求；状态、signal、session ID 防止旧结果污染新会话。生命周期 handler 顶层注册，不在 `session_start` 内重复注册。
- 只使用 `pi.setSessionName`，不接管终端标题、转圈或 working indicator，不额外添加忙闲字符。
- 保留 `archimedes.sessionName` 配置。模型默认跟随当前模型，reasoning 默认 `minimal`，校验后按模型能力 clamp。
- 失败只在后续用户输入时重试，三次失败后停止并至多警告一次；取消、缺模型/认证不消耗失败次数。
- 标题限制 80 个 Unicode code points。跳过空白/纯图片、extension 来源输入和不持久化会话。
- 事件路径不用 `console.*`，诊断走 `diag`/`describeError`，需要用户处理的消息走 `ctx.ui.notify`。
- README 明确命名是独立且可能计费的模型调用，不计入主 footer totals；不要承诺标题一定早于主回答完成。

## 验证流程

在仓库根目录安装开发依赖并按顺序验证：

```sh
npm ci --ignore-scripts --legacy-peer-deps
npm run typecheck
npm test
npm run test:production
git diff --check
```

- 回归测试使用真实 Pi loader 和 mock 模型，不调用真实模型，不读取真实凭据。
- 生产测试在临时目录执行 npm offline 安装，省略 dev/peer，确认只装本地 core，并运行同一套回归测试。
- 涉及安装/资源发现/更新时，额外用隔离 Pi 配置检查真实命令，不把沙箱成功描述为用户环境已迁移。
- 检查失败先读错误并修复；不跳过失败，也不在没有修改时反复重跑。区分本地通过与远端 CI 通过。

## 范围和文档

- 做最小必要修改，不顺手重构或删除未交付的其他上游包。
- 修改行为、配置或安装方式时同步 README 和相关功能文档，明确区分 fork 与原插件。
- 原仓完整 monorepo 约定可通过 `git show upstream/main:AGENTS.md` 查阅；它不覆盖本文件，也不作为本分支的发布步骤。
- 完成后简要报告变更、验证、提交和推送状态。若 force push 尚未获批，明确说明远端尚未同步。
