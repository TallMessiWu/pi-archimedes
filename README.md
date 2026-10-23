# Pi Session Name Early

这是我们基于 [pi-archimedes](https://github.com/danielcherubini/pi-archimedes) v2.11.2 的 `session-name` 插件维护的修改版。**首条消息提交后就开始后台命名，不等第一轮回答结束。**

本仓只分发命名插件，不是上游整套插件的安装入口。

## 我们改了什么

- **提前命名**：从 `agent_end` 改为用户 `input` 时触发，只使用首条用户文本，不需要助手回答，也不等待命名请求完成才开始主任务。
- **独立安装**：命名代码、配置和日志助手都来自本仓，不再依赖上游 Archimedes npm 包，也不加载其他 UI 插件。
- **补齐请求保护**：同一时间只发起一个命名请求；关闭、重载或切换会话时取消请求，防止旧结果影响新会话；保留已有名字和手动命名优先的行为。
- **保持原生外观**：保留 Pi 原生 `π` 标识和运行转圈，不接管终端标题，不额外添加忙闲字符。

标题在后台模型返回后出现，不保证一定早于主回答完成。

## 安装我们的版本

需要先安装 Pi；已验证 Pi 1.4.0、Node.js ≥ 22.19.0。如果正在使用旧的自动命名插件，先按下方迁移说明停用旧版，避免重复命名。

在终端执行：

```sh
pi install git:github.com/TallMessiWu/pi-archimedes@session-name-early
```

然后在 Pi 内执行 `/reload`，或重启 Pi。新建未命名会话并提交首条文本，即可触发后台命名。

### 从旧版迁移

如果装过原 npm 插件，先卸载它，再执行上面的 Git 安装命令：

```sh
pi remove npm:@pi-archimedes/session-name
```

若旧的 `~/.pi/agent/extensions/session-name-early/` 本地补丁仍存在，安装成功后移除它，再 `/reload`；已删除则跳过。使用上游整套插件的用户只需停用其中的 Session Name，不必卸载其他组件。

## 更新与卸载

```sh
# 更新我们的版本，完成后在 Pi 内 /reload
pi update git:github.com/TallMessiWu/pi-archimedes@session-name-early

# 卸载我们的版本
pi remove git:github.com/TallMessiWu/pi-archimedes@session-name-early
```

## 配置与费用

沿用 `~/.pi/agent/settings.json` 中的 `archimedes.sessionName` 配置，无需迁移。默认使用当前模型和 `minimal` 推理级别；可通过 `model` 指定较便宜的命名模型。

命名是独立且可能计费的模型调用，**不计入主 footer totals**。

---

`session-name-early` 是默认展示及分发分支；`main` 仅保留上游镜像。开发和提交约定见 [AGENTS.md](AGENTS.md)。保留上游署名与 [MIT 许可证](LICENSE)。
