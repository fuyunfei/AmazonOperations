# 06 — Chat 功能（Agent SDK 升级版）

[← 返回索引](./index.md)

> **数据范围**：全部已上传报表，不限品类。  
> **入口**：顶层导航 Chat 页，与品类视图平级。  
> **目标**：基于已上传数据和运营手册，回答"为什么"和"怎么办"类问题，补充结构化看板无法覆盖的分析场景。

---

## 架构升级概述

Chat 从单会话前端 State 模式升级为 **多 Session + 标准 Claude Agent SDK** 架构，核心变化：

| 维度 | 旧版 | 新版 |
|------|------|------|
| 会话数量 | 单个（全局） | 多个，用户可创建/切换/删除 |
| 历史持久化 | 前端 state，刷新即清 | DB 持久化，刷新后可继续 |
| Agent Loop | 自定义循环实现 | 标准 Claude Agent SDK |
| 工具集 | 写死在代码中 | Skill 插件化，可热插拔 |
| 流式推送 | 自定义 SSE | SDK 原生流式事件 |

---

## 一、Session 模型

每个 Session 是一个独立的对话容器，具备以下属性：

```
Session
├── id           唯一标识
├── title        会话名称（用户可重命名；默认取首条消息前 30 字）
├── createdAt    创建时间
├── updatedAt    最后活跃时间
├── skills[]     挂载的 Skill 列表（默认挂载内置 Amazon Ops Skill）
└── messages[]   持久化的消息历史（含工具调用记录，可配置）
```

**Session 生命周期**：

```
用户点击「新建对话」
    │
    ▼
创建 Session（写入 DB）→ 分配 Session ID
    │
    ▼
用户在该 Session 内发消息 → Agent Loop 执行 → 结果持久化
    │
    ▼
用户可随时切换至其他 Session（历史从 DB 加载，无需重建）
    │
    ▼
用户删除 Session → 软删除或物理删除（含消息历史）
```

---

## 二、整体数据流

```
┌─── 前端 Chat 页 ────────────────────────────────────────────┐
│                                                              │
│  ┌─ Session 列表（左栏）─┐   ┌─ 对话主区（右栏）──────────┐  │
│  │  + 新建对话           │   │  消息历史（从 DB 加载）      │  │
│  │  ─────────────────   │   │  工具调用状态气泡            │  │
│  │  ● Session A  ←当前  │   │  流式文字渲染                │  │
│  │  ○ Session B         │   │  输入框 + 发送               │  │
│  │  ○ Session C         │   └──────────────────────────────┘  │
│  └──────────────────────┘                                    │
└──────────────────────────────────────────────────────────────┘
         │                              │
         │ Session CRUD                 │ 发送消息（触发 Agent）
         ▼                              ▼
┌─── 服务端 API ─────────────────────────────────────────────┐
│                                                             │
│  Session 管理端点                Agent 执行端点             │
│  POST   /api/sessions            POST /api/sessions/:id/run│
│  GET    /api/sessions            ← SSE 流式响应             │
│  GET    /api/sessions/:id        ← 持久化消息历史           │
│  PATCH  /api/sessions/:id        ← 工具执行状态事件         │
│  DELETE /api/sessions/:id                                   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
         │                              │
         ▼                              ▼
┌─── 持久层（SQLite）─┐    ┌─── Claude Agent SDK Loop ──────┐
│  Session 表          │    │                                 │
│  Message 表          │    │  1. 从 DB 加载 Session 历史     │
│  （含 tool 记录）    │    │  2. 构建 System Prompt          │
└──────────────────────┘    │  3. SDK stream() 调用 Claude   │
                            │  4. on('tool_use') → 执行工具  │
                            │  5. 追加 tool_result → 继续    │
                            │  6. on('text') → SSE 推送前端  │
                            │  7. 消息写回 DB 持久化          │
                            └─────────────────────────────────┘
                                         │
                                         ▼
                            ┌─── Skill 注册表 ────────────────┐
                            │  内置 Skill: Amazon Ops（8 工具）│
                            │  用户 Skill: 未来可插拔注册      │
                            └─────────────────────────────────┘
```

---

## 三、Claude Agent SDK Loop（标准流程）

每次用户发送消息，触发以下标准 Agent 执行循环：

```
用户发送消息（Session 内）
    │
    ▼
① 加载 Session 历史（从 DB，最近 N 轮）
    │
    ▼
② 构建本次请求上下文
   ├── System Prompt（含已上传文件、工具规则、KPI基准、SOP）
   ├── 历史消息数组
   ├── 本轮用户消息
   └── 本 Session 挂载的 Skill 工具定义集合
    │
    ▼
③ SDK stream() 发起流式请求
    │
    ├── [流式阶段：收到 text 事件]
    │     └── SSE → 前端：{ type: "text_delta", delta }（逐字流式）
    │
    └── [流结束：stop_reason = "tool_use"]           ← 工具调用在流结束后处理，非中途
          ├── 从 finalMessage.content[] 提取 tool_use 块
          ├── SSE → 前端：{ type: "tool_start", tool, input }
          ├── 执行对应工具（查 DB / 调外部 API）
          ├── SSE → 前端：{ type: "tool_done", tool, result_summary }
          ├── 追加 tool_result 消息 → 再次调用 stream()（agent loop 代码控制）
          └── 重复直到 stop_reason = "end_turn" 或达到 max_iterations 上限

    [stop_reason = "end_turn"]
          ├── SSE → 前端：{ type: "done" }
          ├── 完整消息写入 DB（user + assistant，含 tool 调用记录）
          └── 更新 Session.updatedAt
```

**与旧版的关键差异**：
- 工具调用轮次上限由 **agent loop 代码** 控制（自定义 max_iterations，默认 10），不再需要手动 `for` 循环计数
- 流式 text 事件直接来自 SDK；工具调用在每轮流结束后由 agent loop 驱动，不是 SDK 自动处理
- 消息历史在每轮结束后写入 DB，不再依赖前端 state

---

## 四、Skill 系统（工具插件化）

Skill 是工具集的封装单元，每个 Skill 包含：

```
Skill
├── id          唯一标识（如 "amazon-ops"）
├── name        展示名称（如 "Amazon 运营工具集"）
├── description 说明（注入 System Prompt 中）
├── tools[]     工具定义列表（Claude API Tool 格式）
└── executor    工具执行函数注册表（name → handler）
```

**当前内置 Skill：Amazon Ops**

包含现有 8 个工具，打包为一个 Skill，默认挂载到所有新建 Session：

| 工具 | 用途 |
|------|------|
| `get_metrics(time_window)` | 查询 KPI 快照 |
| `get_acos_history(days?)` | 查询 ACoS 日趋势 |
| `get_inventory()` | 查询库存状况 |
| `get_ad_campaigns(filter?)` | 查询广告活动 |
| `get_search_terms(filter?)` | 查询搜索词转化 |
| `get_alerts(level?, category?)` | 查询已触发告警 |
| `list_uploaded_files()` | 列出已上传文件 |
| `get_file_data(file_type, limit?)` | 读取原始文件数据 |

**未来用户 Skill 接入方式**（预留设计）：

```
用户在「配置」页创建自定义 Skill
    │
    ├── 定义工具名称、参数 schema、描述
    ├── 选择执行方式：HTTP Webhook / 内置函数
    └── 将 Skill 挂载到指定 Session（或全局默认）

Session 发起 Agent Loop 时
    └── 自动合并所有挂载 Skill 的工具定义，交给 Claude
```

---

## 五、消息持久化策略

```
DB 存储单元：Message（属于某个 Session）
├── id
├── sessionId
├── role           "user" | "assistant"
├── content        最终文字内容（用户可见）
├── toolCalls[]    本轮工具调用记录（可选存储，用于调试/审计）
│    ├── tool      工具名
│    ├── input     调用入参
│    └── result    返回结果摘要
├── createdAt
└── tokenCount     本轮消耗 token（可选，用于用量统计）
```

**历史加载策略**：

```
加载规则：取最近 N 轮 user+assistant 对（默认 20 轮）
超长 Session：自动截断早期历史，保留 System Prompt + 最近 N 轮
（防止 context 超限）
```

---

## 六、前端 Session 管理交互

```
Chat 页布局
├── 左栏：Session 列表
│   ├── 「+ 新建对话」按钮
│   ├── Session 卡片列表（按 updatedAt 倒序）
│   │   ├── Session 标题
│   │   ├── 最后消息时间
│   │   └── 右键/操作菜单：重命名 / 删除
│   └── （未来）Session 搜索
│
└── 右栏：当前 Session 对话区
    ├── 消息历史（切换 Session 时重新从 DB 加载，无需重建）
    ├── 工具调用气泡（tool_start → loading → tool_done）
    ├── 流式文字渲染（text_delta 逐字追加）
    └── 输入框（发送 / 取消正在执行的 Agent）
```

**Session 切换流程**：

```
用户点击 Session B
    → 前端请求 GET /api/sessions/B（含历史消息）
    → 渲染历史对话
    → 后续发消息在 Session B 上下文中执行
    （Session A 的对话不受影响，下次点击 A 仍可继续）
```

---

## 七、SSE 事件规范（升级版）

服务端通过 SSE 向前端推送 Agent 执行过程：

| type | 含义 | 额外字段 |
|------|------|---------|
| `session_start` | Agent 开始执行 | `sessionId` |
| `tool_start` | 开始执行工具 | `tool: string`, `input: object` |
| `tool_done` | 工具执行完毕 | `tool: string`, `resultSummary: string` |
| `text_delta` | 流式文字片段 | `delta: string` |
| `done` | 本轮回答结束 | `messageId: string` |
| `error` | 出错 | `message: string`, `code?: string` |

---

## 八、技术限制与边界（更新）

```
✅ 支持：
  · 多 Session 并行，各自独立的对话上下文
  · Session 历史持久化，刷新页面后可继续
  · 每 Session 可独立挂载不同 Skill 工具集
  · 标准 Claude Agent SDK 流式 loop
  · 跨品类分析（Chat 不绑定品类）

❌ 不支持（本阶段）：
  · Session 共享（多用户同时操作同一 Session）
  · 实时协作（非多人在线场景）
  · 销量预测（无预测模型）
  · 直接执行广告后台操作

⚠️ 约束：
  · 单 Session 历史超长时自动截断早期记录（防止 context 超限）
  · 工具调用上限由 agent loop 代码的 max_iterations 参数控制（默认 10 次；SDK 本身无此参数）
  · 每次发消息重新拉取 System Prompt（GET /api/build-prompt），自动感知新上传文件
```

---

## 九、数据流：文件类型 → 工具强制映射

（与旧版相同，纳入内置 Amazon Ops Skill 描述中）

```
product           → get_metrics + get_acos_history  （禁止用 get_file_data）
campaign_3m       → get_ad_campaigns
search_terms      → get_search_terms
inventory         → get_inventory
其他所有 fileType  → get_file_data(fileType)
```

---

## 十、典型对话场景

| 用户问题 | Claude 调用工具 | 回答依据 |
|---------|----------------|---------|
| 「这个产品 ACoS 为什么高？」 | `get_search_terms(high_acos)` + `get_ad_campaigns(high_acos)` | 高消耗词明细 + SOP P0/P1 规则 |
| 「现在库存还撑多久？」 | `get_inventory()` + `get_metrics(w7)` | 可售天数计算 + 手册补货阈值 |
| 「床垫品类哪个 ASIN 最需要关注？」 | `get_alerts(level=red)` + `get_metrics(d30)` | 各 ASIN 红色告警 + GMV 对比 |
| 「这周广告优化应该先做什么？」 | `get_alerts(level=all)` + `get_search_terms(zero_conv)` | 红黄告警优先级 + 零成交词 |
