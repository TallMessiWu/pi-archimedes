---
name: gitmoji-commit
description: 根据暂存区和会话上下文生成 Gitmoji 中文提交信息并直接提交；普通 push 无需确认，force push 必须先取得用户确认。
---

# Gitmoji Commit Skill

此 Skill 用于帮助用户自动化 Git 提交流程。你需要分析代码变更，结合当前的会话上下文（用户之前的指令和你的修改），生成符合 [Gitmoji](https://gitmoji.dev/) 规范的提交信息。

本项目版本复制自 `qwen3.8/.agents/skills/gitmoji-commit/`，保留其提交格式和 Gitmoji 参考表，但按用户要求调整交互规则：提交信息、本地提交和普通 push 不需要用户确认；只有 force push 需要单独确认。此文件自包含，不依赖原项目路径；完整项目约定见根目录 `AGENTS.md`。

## 核心原则
1. **始终使用中文**撰写 Subject。
2. **直接提交，不确认提交信息**。完成任务所需的普通 fast-forward `git push` 可直接执行；若需要 `--force`、`--force-with-lease` 或带 `+` 的非快进推送，必须先说明目标远端、分支及影响并取得用户明确确认。用户要求重写历史不等于授权 force push。普通 push 被拒绝时，禁止自动升级为 force push。
3. **格式规范**：`<emoji-code> <type>(<scope>): <subject>`
   - **Emoji**：必须使用 Gitmoji 代码（如 `:sparkles:`），不用实际 emoji 字符替代代码。
   - **Subject**：简练的中文描述，动词开头，不超过 50 个字符，作为第一个 `-m` 的标题。
   - **Body（可选）**：一般只用一个 `-m`。仅在复杂修改无法由标题清晰传达时添加正文，避免冗长或重复说明。
   - 默认示例：`git commit -m ":sparkles: feat(auth): 添加登录功能"`。

## 执行步骤

### 1. 检查暂存区

```sh
git status --short --branch
git diff --cached --name-only
```

- **若无暂存文件**：检查工作区，将本任务相关文件按明确路径暂存后继续；不得混入用户其他改动。确实没有需要提交的变更时说明并结束。
- **若有暂存文件**：核对暂存内容属于本任务，再继续下一步。
- **仅重写提交信息**：用户明确要求时可在没有内容变更的情况下 amend/reword；先核对目标提交和工作区，避免夹带修改。只整理本 fork 自有提交，保留上游历史；推送重写结果仍需单独确认。

### 2. 分析变更与上下文

运行 `git diff --cached` 获取详细变更内容，同时回顾用户要求和会话历史：

- 用户刚才要求做什么？
- 具体修改了什么？
- 主要意图是什么？如果同时包含多个独立逻辑单元，拆分提交；不要为了拼一个标题混合无关改动。

### 3. 生成提交信息

根据主要意图，从下表中选择最准确的 Emoji 和 Type。

#### Gitmoji 参考手册

| Emoji | Code | Description | 中文含义（参考） |
| :--- | :--- | :--- | :--- |
| 🎨 | `:art:` | Improve structure / format of the code. | 改进代码结构/格式 |
| ⚡️ | `:zap:` | Improve performance. | 性能优化 |
| 🔥 | `:fire:` | Remove code or files. | 删除代码/文件 |
| 🐛 | `:bug:` | Fix a bug. | 修复 Bug |
| 🚑️ | `:ambulance:` | Critical hotfix. | 紧急热修复 |
| ✨ | `:sparkles:` | Introduce new features. | 引入新功能 |
| 📝 | `:memo:` | Add or update documentation. | 添加/更新文档 |
| 🚀 | `:rocket:` | Deploy stuff. | 部署/发布 |
| 💄 | `:lipstick:` | Add or update the UI and style files. | 更新 UI/样式 |
| 🎉 | `:tada:` | Begin a project. | 初次提交/初始化项目 |
| ✅ | `:white_check_mark:` | Add, update, or pass tests. | 添加/更新/通过测试 |
| 🔒 | `:lock:` | Fix security or privacy issues. | 修复安全/隐私问题 |
| 🔐 | `:closed_lock_with_key:` | Add or update secrets. | 添加/更新密钥 |
| 🔖 | `:bookmark:` | Release / Version tags. | 发布/版本标签 |
| 🚨 | `:rotating_light:` | Fix compiler / linter warnings. | 修复编译器/Linter 警告 |
| 🚧 | `:construction:` | Work in progress. | 进行中的工作 |
| 💚 | `:green_heart:` | Fix CI Build. | 修复 CI 构建 |
| ⬇️ | `:arrow_down:` | Downgrade dependencies. | 降级依赖 |
| ⬆️ | `:arrow_up:` | Upgrade dependencies. | 升级依赖 |
| 📌 | `:pushpin:` | Pin dependencies to specific versions. | 锁定依赖版本 |
| 👷 | `:construction_worker:` | Add or update CI build system. | 添加/更新 CI 构建系统 |
| 📈 | `:chart_with_upwards_trend:` | Add or update analytics or track code. | 添加/更新分析或追踪代码 |
| ♻️ | `:recycle:` | Refactor code. | 代码重构 |
| ➕ | `:heavy_plus_sign:` | Add a dependency. | 添加依赖 |
| ➖ | `:heavy_minus_sign:` | Remove a dependency. | 移除依赖 |
| 🔧 | `:wrench:` | Add or update configuration files. | 添加/更新配置文件 |
| 🔨 | `:hammer:` | Add or update development scripts. | 添加/更新开发脚本 |
| 🌐 | `:globe_with_meridians:` | Internationalization and localization. | 国际化与本地化 |
| ✏️ | `:pencil2:` | Fix typos. | 修复拼写错误 |
| 💩 | `:poop:` | Write bad code that needs to be improved. | 提交需要改进的劣质代码 |
| ⏪ | `:rewind:` | Revert changes. | 回滚变更 |
| 🔀 | `:twisted_rightwards_arrows:` | Merge branches. | 合并分支 |
| 📦️ | `:package:` | Add or update compiled files or packages. | 更新编译文件或包 |
| 👽️ | `:alien:` | Update code due to external API changes. | 因外部 API 变更更新代码 |
| 🚚 | `:truck:` | Move or rename resources (e.g.: files, paths, routes). | 移动/重命名资源 |
| 📄 | `:page_facing_up:` | Add or update license. | 添加/更新许可证 |
| 💥 | `:boom:` | Introduce breaking changes. | 引入破坏性变更 |
| 🍱 | `:bento:` | Add or update assets. | 添加/更新资源（图片等） |
| ♿️ | `:wheelchair:` | Improve accessibility. | 改进无障碍访问 |
| 💡 | `:bulb:` | Add or update comments in source code. | 添加/更新注释 |
| 🍻 | `:beers:` | Write code drunkenly. | 醉酒写代码（通常用于非正式提交） |
| 💬 | `:speech_balloon:` | Add or update text and literals. | 更新文本/字面量 |
| 🗃️ | `:card_file_box:` | Perform database related changes. | 数据库相关变更 |
| 🔊 | `:loud_sound:` | Add or update logs. | 添加/更新日志 |
| 🔇 | `:mute:` | Remove logs. | 移除日志 |
| 👥 | `:busts_in_silhouette:` | Add or update contributor(s). | 添加/更新贡献者 |
| 🚸 | `:children_crossing:` | Improve user experience / usability. | 改进用户体验/可用性 |
| 🏗️ | `:building_construction:` | Make architectural changes. | 架构变更 |
| 📱 | `:iphone:` | Work on responsive design. | 响应式设计 |
| 🤡 | `:clown_face:` | Mock things. | 模拟数据/Mock |
| 🥚 | `:egg:` | Add or update an easter egg. | 添加/更新彩蛋 |
| 🙈 | `:see_no_evil:` | Add or update a .gitignore file. | 添加/更新 .gitignore |
| 📸 | `:camera_flash:` | Add or update snapshots. | 添加/更新快照 |
| ⚗️ | `:alembic:` | Perform experiments. | 试验性代码 |
| 🔍 | `:mag:` | Improve SEO. | 改进 SEO |
| 🏷️ | `:label:` | Add or update types. | 添加/更新类型（TypeScript 等） |
| 🌱 | `:seedling:` | Add or update seed files. | 添加/更新种子文件 |
| 🚩 | `:triangular_flag_on_post:` | Add, update, or remove feature flags. | 功能标记变更 |
| 🥅 | `:goal_net:` | Catch errors. | 错误捕获 |
| 💫 | `:dizzy:` | Add or update animations and transitions. | 动画/过渡效果 |
| 🗑️ | `:wastebasket:` | Deprecate code that needs to be cleaned up. | 废弃代码 |
| 🛂 | `:passport_control:` | Work on code related to authorization, roles and permissions. | 授权/角色/权限相关 |
| 🩹 | `:adhesive_bandage:` | Simple fix for a non-critical issue. | 简单修复非关键问题 |
| 🧐 | `:monocle_face:` | Data exploration/inspection. | 数据探索/检查 |
| ⚰️ | `:coffin:` | Remove dead code. | 移除死代码 |
| 🧪 | `:test_tube:` | Add a failing test. | 添加失败测试 |
| 👔 | `:necktie:` | Add or update business logic. | 业务逻辑变更 |
| 🩺 | `:stethoscope:` | Add or update healthcheck. | 健康检查 |
| 🧱 | `:bricks:` | Infrastructure related changes. | 基础设施变更 |
| 🧑‍💻 | `:technologist:` | Improve developer experience. | 改进开发者体验 |
| 💸 | `:money_with_wings:` | Add sponsorships or money related infrastructure. | 赞助/资金相关 |
| 🧵 | `:thread:` | Add or update code related to multithreading or concurrency. | 多线程/并发相关 |
| 🦺 | `:safety_vest:` | Add or update code related to validation. | 验证相关代码 |
| ✈️ | `:airplane:` | Improve offline support. | 离线支持 |
| 🦖 | `:t-rex:` | Code that adds backwards compatibility. | 向后兼容性 |
| 🤖 | `:robot:` | Changes related to AI agents, Codex config, or automation scripts. | Agent/AI 配置变更 |

优先匹配最具体的情境。例如依赖升级用 `:arrow_up:`，添加依赖用 `:heavy_plus_sign:`，比通用的 `:package:` 或 `:wrench:` 更准确。单纯样式修改用 `:lipstick:`。

### 4. 验证并直接提交

核对暂存区 diff、提交格式和相关测试结果后直接执行，不要求用户确认提交信息。一般使用单个 `-m`：

```sh
git diff --cached --check
git commit -m ":sparkles: feat(session-name): 支持首条输入后台命名"
```

按逻辑单元提交。根据用户反馈调整提交信息时，同样无需确认文案；但不得擅自重写已发布历史。

### 5. 推送边界

- 普通 fast-forward push 可直接执行，明确指定 `origin` 和目标功能分支；不向上游仓库推送，也不在 `main` 开发。
- 非快进推送必须先展示目标分支、旧/新提交和影响，并等待用户明确确认；这包括 `--force-with-lease`，它不是免确认的普通 push。
- 获批后优先使用绑定已核对远端旧 SHA 的 `--force-with-lease=refs/heads/<branch>:<old-sha>`，只更新获批的分支。
- 如果远端已变化或 lease 失败，停止核对；不得刷新 lease 后盲目重试，不得改用无保护的 `--force`。
- 用户尚未同意 force push 时，保留本地已完成的改动，明确报告“尚未同步远端”，不要将它描述为发布完成。

## 完成报告

简要报告提交 SHA、变更要点、验证结果和推送状态。无需再要求用户确认提交文案或自行执行普通 push。
