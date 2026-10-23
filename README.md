# Pi session-name：首条输入后台命名

这是 [danielcherubini/pi-archimedes](https://github.com/danielcherubini/pi-archimedes) 的 **fork**，基于上游 **v2.11.2** 的 `session-name` 插件做了自己的修改，并非上游官方版本。保留上游 Git 历史、署名和 MIT 许可证。

我们的重点是：**首条用户输入提交后就启动后台命名，不再等待第一轮回答结束**，同时保留 Pi 原生 `π - name - directory` 终端标题和运行转圈。

- 修改及安装分支：[**`session-name-early`**](https://github.com/TallMessiWu/pi-archimedes/tree/session-name-early)。`main` 保持上游镜像，不在其上开发。
- 只加载命名插件，不安装或启用整套 Archimedes UI。
- 不依赖上游 Archimedes npm 包：命名代码和 core 助手都随本 fork 的 Git checkout 提供，Pi API 由运行中的宿主提供。
- 已验证环境：**Pi 1.4.0、Node.js ≥ 22.19.0**。直接加载 TypeScript，无需编译。

## 相比上游的修改

| 项目 | 上游 v2.11.2 | 本 fork |
| --- | --- | --- |
| 命名触发时机 | `agent_end`，第一轮交互结束后 | 首条非空用户 `input`，独立后台执行 |
| 命名依据 | 首条用户消息和助手回答，各取最多 500 字符 | 首条用户文本，最多 500 字符，不需要助手回答 |
| 会话生命周期 | 已有名字保护、失败重试 | 保留保护，并增加单请求并发控制、关闭时取消和旧会话结果隔离 |
| 分发方式 | npm 单插件或整套 suite | Git 分支单独分发命名插件，core 从仓内 `file:packages/core` 加载 |
| 终端外观 | Pi 原生标题 | 同样保持原生 `π` 和转圈，不接管标题、不添加忙闲字符 |

后台请求发起得更早，但标题仍需等模型返回后才出现，不保证一定早于主回答完成。

## 安装

已经安装 Pi、且没有启用其他自动命名插件时，在终端执行：

```sh
pi install git:github.com/TallMessiWu/pi-archimedes@session-name-early
```

然后在 Pi 内执行 `/reload`，或重启 Pi。新建一个未命名会话，提交首条非空文本即可触发命名。

**请保留命令中的 `@session-name-early`，不要安装保留上游原样的 `main` 分支。**

### 从原 npm 插件迁移

```sh
pi remove npm:@pi-archimedes/session-name
pi install git:github.com/TallMessiWu/pi-archimedes@session-name-early
```

`pi remove` 也会移除此前以 `extensions: []` 禁用原插件的配置项。

如果你还留有旧的本地 `session-name-early` 补丁，在 Git 版安装成功后、`/reload` 前检查并删除它，避免重复命名；如果已经删除则跳过：

```sh
rm -r ~/.pi/agent/extensions/session-name-early
```

迁移完成后再 `/reload`。原有 `archimedes.sessionName` 配置继续有效，无需修改认证、会话、主题和终端进度设置。

如果你使用的是**上游整套 suite**，不要为了命名插件卸载其他组件：通过 `/plugins` 关闭原来的 Session Name，再安装本 fork 并重载。本 fork 本身不提供 `/plugins` 或 `/archimedes` 面板。

## 更新与卸载

更新到我们的分支最新提交：

```sh
pi update git:github.com/TallMessiWu/pi-archimedes@session-name-early
```

更新后在 Pi 内 `/reload`。此命令更新的是我们的分支，不会自动把上游修改合入 fork。

卸载：

```sh
pi remove git:github.com/TallMessiWu/pi-archimedes@session-name-early
```

如需固定某个版本，可将安装命令中的分支名替换为完整提交 SHA。不要同时安装分支版和固定提交版。

## 配置

在 `~/.pi/agent/settings.json` 中保留其他设置，按需添加：

```json
{
  "archimedes.sessionName": {
    "model": "provider/model-id",
    "reasoning": "minimal"
  }
}
```

- **`model`**：默认使用当前模型。支持不区分大小写的 `provider/id`、唯一的裸模型 ID，以及带 `:thinking` 后缀的引用；找不到时沿用上游行为，回退当前模型。
- **`reasoning`**：默认 `minimal`。接受 `minimal`、`low`、`medium`、`high`、`xhigh`、`max`、`off` 或 `null`，容忍大小写和首尾空格。无效值回退默认值，之后由 Pi 按模型能力 clamp；`off`/`null` 不保证所有模型都完全关闭推理。
- 命名是**独立且可能计费的模型调用**，不包含在主 footer totals 中。可指定较便宜的命名模型。
- 可选诊断日志：`PI_ARCHIMEDES_LOG=/path/to/log pi`。默认不写日志，也不向终端打印诊断。

## 行为与保护

- 输入处理器不等待命名结果，同时最多一个命名请求。
- 恢复未命名会话时，使用历史中的首条用户文本，而不是最新跟进消息。
- 跳过已有名字；请求期间手动设置的名字也不会被覆盖。
- 关闭、重载或切换会话时取消待处理请求，并通过状态、signal、session ID 防止旧结果给新会话命名。
- 失败只在后续用户输入时重试；每个运行时累计三次失败后停止，并最多警告一次。缺模型、缺认证及取消请求不消耗失败次数。
- 跳过不持久化会话、空白/纯图片输入和扩展生成的输入。持久化 print/RPC 会话也可触发，但退出时会取消未完成请求，不为命名拖延退出。
- 标题最多 80 个 Unicode code points。仅调用 `pi.setSessionName`，不修改终端标题、进度或 working indicator API。

## 开发与验证

```sh
git clone --branch session-name-early https://github.com/TallMessiWu/pi-archimedes.git
cd pi-archimedes
npm ci --ignore-scripts --legacy-peer-deps
npm run typecheck
npm test
npm run test:production
```

测试使用真实 Pi extension loader 和 mock 模型，不读取真实凭据或调用真实模型。生产安装测试会在临时目录中执行 npm offline 安装，省略 dev/peer 依赖，确认只安装仓内 core，再运行同一套回归测试。

`npm test` 优先使用开发依赖中的 Pi，否则回退个人 Pi 托管安装。可用 `PI_TEST_HOST_DIR` 指定 `@earendil-works/pi-coding-agent/dist` 目录。

### 项目结构

- `packages/session-name/src/index.ts`：我们的命名实现。
- `packages/core/src/{settings-io,log}.ts`：仓内配置和日志助手，源码沿用上游。
- 根 `package.json`：命名插件单独分发入口和本地 core 依赖。
- `.agents/skills/gitmoji-commit/SKILL.md`：项目内的 Gitmoji 中文提交规范，从指定项目复制并适配。
- 其余上游源码和文档保留供追溯与合并，不由本分支的根安装入口加载，也不在当前聚焦测试范围内。

### 协作约定

完整约定见 [AGENTS.md](AGENTS.md)。

- 不在 `main` 开发；当前分发和维护分支为 `session-name-early`。
- 自有提交使用 `:emoji_code: type(scope): 中文动词开头的说明`，具体遵循 [gitmoji-commit skill](.agents/skills/gitmoji-commit/SKILL.md)。继承的上游提交保持原样。
- 提交信息、普通 commit 和普通 fast-forward push 无需用户确认；**force push（包括 `--force-with-lease`）必须单独确认**。
- 同步上游前先审查差异，再按需 merge/cherry-pick；保留命名独立入口和生命周期保护，跑完验证再推送。
- 根安装和 CI 使用 npm，而非上游 pnpm workspace；本分支没有 npm 发布流程。

## 许可证与致谢

MIT，见 [LICENSE](LICENSE)。感谢 [danielcherubini/pi-archimedes](https://github.com/danielcherubini/pi-archimedes) 提供原始实现；本仓在其基础上维护上述独立修改。
