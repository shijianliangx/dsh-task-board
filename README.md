# dsh-task-board（任务看板）

一个 DeepSeek Harness（DSH）插件：**任务分发后，智能体按需求自动生成「处理清单」和「交付清单」**，并在对话和左侧栏面板里实时展示当前进度、要处理什么、处理结果和产物。

## 解决什么问题

派活之后经常出现三类痛点：

- 需求说完了，但没人把「到底要处理哪几件事、要交付哪些东西」列清楚；
- 进度靠嘴说，问一句答一句，无法核对真实状态；
- 做完了却说不清产物在哪、每件事的处理结果是什么。

本插件让智能体在收到需求后**先建板再动手**，执行过程中持续更新，用户随时能从面板看到事实而非编造的进度。

## 功能

- **自动生成**（v1.3 起自动建板）：会话一出现用户需求，插件在第一步就自动建一块草稿板（标题取需求首句、原话写入「会话中的用户需求」），无需等待智能体调用工具——解决了早期"派活后几十分钟才记进看板"的延迟问题。随后智能体调用 `task_board_plan` 时会复用这块草稿板，填入：
  - 处理清单：要处理的事项、要点、负责人；
  - 交付清单：要交付的产物、交付标准。
- **会话需求自动计入**（v1.1）：建板时插件从当前会话抓取用户原始消息（`exec.agent.session` 的 `user/message`；读不到则从会话投影缓存兜底），存为看板的「会话中的用户需求」单独展示，与智能体整理的 requirement 并列，避免用户原话丢失。
- **归档自动分列**（v1.1）：插件读取 `~/.dsh/storages/workspace.json` 的 `global.archivedSessionIds`，按看板 sessionId 判定归档。归档任务在面板「归档」标签单独列出，不再计入「进行中」；Markdown 输出带「已归档」标记。归档状态每 4 秒刷新一次。
- **产物点击预览**（v1.2）：面板里的「产物」可点击，弹层预览。URL 直接在新标签打开；图片与 PDF 弹层内直接查看；文本/代码（常见扩展名，≤1MB 超长截断）弹层内查看；目录列出内容可逐层点入。相对路径自动相对「会话工作目录 → config.cwd → 进程目录」解析，路径带说明文字也能识别；找不到（>16MB 过大）或不支持的类型给出明确提示。
- **实时更新**：开始一项标 `doing`，做完填 `result`（处理结果）与 `artifact`（产物路径/链接）并标 `done`；受阻标 `blocked` 并写原因。
- **双处展示**：
  - 对话里：工具直接输出 Markdown 清单；
  - 左侧栏：「任务看板」面板，每 3 秒刷新，顶部有「进行中 / 已完成 / 归档」三个标签切换，展示统计、进度条、会话需求、两份清单、结果与产物。
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

## 安装

### 一行命令安装（推荐，开发者可直接复制）

用 DSH 自带的 `dsh plugin` 命令把本包装进目标 profile（`<包名>` 处已填好本仓库的 GitHub spec）：

```bash
dsh plugin --profile web add github:taozi0328/dsh-task-board
```

- `--profile web` 指定要装到哪个 profile；换成你自己的 profile 名即可（如 `--profile desktop`）。
- `--profile` 必须写在 `add` **之前**，这是 DSH CLI 的要求。
- 安装后**重启 DSH**，左侧栏出现「任务看板」即生效。

从本地源码目录安装（改代码后重启即生效，适合开发调试）：

```bash
dsh plugin --profile web add link:D:/Personal/Documents/deepseek-harness/default-workspace/dsh-task-board
```

> 说明：`dsh plugin` 本质是把参数转发给 profile 目录里的 pnpm，所以 `add/remove/why` 等 pnpm 子命令都能用。卸载用 `dsh plugin --profile web remove @local/dsh-task-board`。

### 本机 DSH Desktop 的当前状态

当前这台机器已用 `link:` 方式装载，本目录就是源码目录，改完重启 DSH 即生效：

- profile 配置在 `F:\DeepSeekHarness\dsh-home\profiles\desktop`：
  - `package.json` 依赖：`"@local/dsh-task-board": "link:D:/Personal/Documents/deepseek-harness/default-workspace/dsh-task-board"`
  - `dsh.profile.bundles` 含 `"@local/dsh-task-board"`
  - `node_modules/@local/dsh-task-board` 是指向本目录的 Windows Junction（与 notes-panel 的 symlink 等价）
- 因此**开发/修改流程**：直接改本目录下 `index.js` / `client.js`，然后重启 DSH Desktop（client 在启动时装配），刷新页面即可，不需要重新安装、不需要复制文件。

换版本时用 link 方式无需先 `remove`；只有从 link 换成非 link（如 GitHub spec）安装时才需要先移除旧的。也可以在会话里让智能体用 `plugin_manager` 的 `install_bundle`，target 指向本目录。

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
    maxBoards: 200     # 最多保留多少张看板，默认 200
    archivePollMs: 4000  # 归档状态刷新间隔（毫秒），默认 4000
```

## 预览

双击 `preview.html` 可在浏览器里看到面板的静态样子（内置示例数据，不连接 DSH）。

## 说明

- 插件以当前 DSH 进程权限运行；storage 使用独立 unit `dsh_task_board`，不触碰其他插件数据。
- 面板只读，写入统一走智能体工具，保证「你看到的 = 智能体记录的」。
- MIT。
