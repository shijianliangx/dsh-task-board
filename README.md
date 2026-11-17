# dsh-task-board（任务看板）

一个 DeepSeek Harness（DSH）插件：**任务分发后，智能体按需求自动生成「处理清单」和「交付清单」**，并在对话和左侧栏面板里实时展示当前进度、要处理什么、处理结果和产物。

## 解决什么问题

派活之后经常出现三类痛点：

- 需求说完了，但没人把「到底要处理哪几件事、要交付哪些东西」列清楚；
- 进度靠嘴说，问一句答一句，无法核对真实状态；
- 做完了却说不清产物在哪、每件事的处理结果是什么。

本插件让智能体在收到需求后**先建板再动手**，执行过程中持续更新，用户随时能从面板看到事实而非编造的进度。

## 功能

- **自动生成**：收到明确需求/分发任务后，智能体调用 `task_board_plan`，按需求列出
  - 处理清单：要处理的事项、要点、负责人；
  - 交付清单：要交付的产物、交付标准。
- **实时更新**：开始一项标 `doing`，做完填 `result`（处理结果）与 `artifact`（产物路径/链接）并标 `done`；受阻标 `blocked` 并写原因。
- **双处展示**：
  - 对话里：工具直接输出 Markdown 清单；
  - 左侧栏：「任务看板」面板，每 3 秒刷新，展示统计、进度条、两份清单、结果与产物。
- **可核对**：用户问进度时，智能体必须先 `task_board_show` 读取真实看板再回答，不允许凭记忆编造。
- **可持久化**：看板写入 DSH storage（json 后端），重启不丢；后端不可用时自动降级为内存。
- **兜底命令**：`/dsh-task-board`（最近任务）、`/dsh-task-board 标题`、`/dsh-task-board all`。

## 目录结构

```
dsh-task-board/
├── index.js            # Host 半身：工具、HTTP API、storage、system prompt、斜杠命令
├── client.js           # 浏览器半身：左侧栏入口 + 主面板（React，宿主主题 token）
├── cordis.patch.yml    # bundle patch
├── package.json        # dsh.bundle / dsh.client 声明
├── icon.svg            # 图标
├── locale/             # 中英文元数据
├── preview.html        # 独立预览（无需 DSH，双击即可看面板长什么样）
└── README.md
```

## 安装（本机 DSH Desktop）

本插件按本机已安装的 `@local/dsh-notes-panel` 同样的方式装载，用 `plugin_manager` 的 `install_bundle`：

1. 让当前 DSH 会话里的智能体执行（target 用本目录的绝对路径）：

```text
用 plugin_manager 的 install_bundle，target 指向 D:\Personal\Documents\deepseek-harness\default-workspace\dsh-task-board
```

2. 刷新页面，左侧栏应出现「任务看板」入口；若没有，重启一次 DSH Desktop。

> 也可以直接编辑 `~/.dsh/profiles/desktop/package.json`，在 `dependencies` 里加
> `"@local/dsh-task-board": "link:D:/Personal/Documents/deepseek-harness/default-workspace/dsh-task-board"`，
> 并在 `dsh.profile.bundles` 里加 `"@local/dsh-task-board"`，然后重启 DSH。
>
> 换版本时先 `remove_bundle` 再 `install_bundle`；同一包名重复安装会被拒绝。

## 使用方式（无需记命令）

直接像平常一样派活即可，例如：

```text
帮我做一个用户登录模块：邮箱+验证码登录，要有速率限制、错误提示和回归测试，最后给我可运行的源码和测试用例。
```

智能体会自动：
1. 调用 `task_board_plan` 建立看板（处理清单 + 交付清单）；
2. 执行中调用 `task_board_update` 更新每一项的状态、处理结果、产物；
3. 完成后把看板标为 done，并在对话里给出清单。

你随时可以问：

```text
现在进度如何？交付了什么？
```

智能体会先读取真实看板再回答。左侧栏「任务看板」可同时查看所有任务。

## Agent 工具

| 工具 | 作用 |
| --- | --- |
| `task_board_plan` | 建板：传 title、requirement、processing[]、delivery[] |
| `task_board_update` | 更新状态/处理结果/产物；`type=board` 收尾 |
| `task_board_add` | 临时补一条清单项 |
| `task_board_show` | 读取真实进度（`all=true` 看全部） |
| `task_board_remove` | 删除看板记录 |

## 配置

在 profile 的 `cordis.patch.yml` 里可覆盖 config：

```yaml
- id: task-board
  name: '@local/dsh-task-board'
  config:
    maxBoards: 200   # 最多保留多少张看板，默认 200
```

## 预览

双击 `preview.html` 可在浏览器里看到面板的静态样子（内置示例数据，不连接 DSH）。

## 说明

- 插件以当前 DSH 进程权限运行；storage 使用独立 unit `dsh_task_board`，不触碰其他插件数据。
- 面板只读，写入统一走智能体工具，保证「你看到的 = 智能体记录的」。
- MIT。
