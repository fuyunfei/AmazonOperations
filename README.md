# YZ-Ops AI

亚马逊多品类运营 AI 中台，支持报表解析、告警看板、广告优化行动清单、库存健康看板及多 Session AI Chat。

**技术栈**：Next.js 14 App Router · SQLite (Prisma) · Anthropic Claude API · Tailwind CSS

---

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 配置 API Key（根目录新建 .env.local）
echo "ANTHROPIC_API_KEY=sk-..." > .env.local

# 3. 初始化数据库
npm run db:push    # 按 schema.prisma 建表
npm run db:seed    # 写入品类/ASIN 配置

# 4. 启动开发服务器
npm run dev        # http://localhost:3000
```

---

## 项目结构

```
yz-ops-ai/
├── context/                    ← 上传的原始 xlsx 文件（由 /api/upload 写入）
├── prisma/
│   ├── schema.prisma           ← 7 张表（见「数据模型」）
│   └── seed.ts                 ← 初始化品类映射 + ASIN 配置
└── src/
    ├── app/
    │   └── api/
    │       ├── upload/         ← POST  上传 xlsx → 解析 → 写库 → 触发告警
    │       ├── files/          ← GET   已上传文件列表 / DELETE 删除文件
    │       ├── categories/     ← GET   品类列表（含红色告警数）
    │       ├── sessions/
    │       │   ├── route.ts    ← POST 新建 Session / GET 列出所有 Session
    │       │   └── [id]/
    │       │       ├── route.ts     ← GET 取 Session+历史 / PATCH 重命名 / DELETE 删除
    │       │       └── run/route.ts ← POST 执行 Agent Loop，SSE 流式输出
    │       └── features/
    │           ├── overview/   ← GET 全品类 KPI 聚合 + 各品类告警摘要
    │           ├── kpi/        ← GET 单品类 KPI（?category=&window=）
    │           ├── alerts/     ← GET 告警列表（?category=&level=）
    │           ├── ads/        ← GET 广告行动清单（?category=）
    │           └── inventory/  ← GET 库存健康看板（?category=）
    ├── components/
    │   ├── layout/
    │   │   ├── Sidebar.tsx         ← 左侧导航（账号总览 / Chat / 品类）
    │   │   └── ContextPanel.tsx    ← 右侧文件管理面板（可收起）
    │   └── panels/
    │       ├── OverviewPanel.tsx   ← 账号总览
    │       ├── KPIPanel.tsx        ← 品类 KPI
    │       ├── AlertsPanel.tsx     ← 每日告警
    │       ├── AdsPanel.tsx        ← 广告优化行动清单
    │       ├── InventoryPanel.tsx  ← 库存看板
    │       └── ChatPanel.tsx       ← 多 Session AI Chat（两栏布局）
    └── lib/
        ├── db.ts                   ← Prisma client 单例
        ├── config.ts               ← 三层参数配置（global → category → stage）
        ├── agentLoop.ts            ← 流式 Agent Loop（for await SSE 事件，最多 10 轮）
        ├── agentTools.ts           ← 8 个工具定义 + 服务端执行逻辑
        ├── skillLoader.ts          ← 从 .claude/skills/ 加载 SKILL.md 文件
        ├── buildSystemPrompt.ts    ← 每次发消息重建 System Prompt（感知新文件）
        ├── parsers/                ← xlsx 解析器，每种报表一个文件
        │   ├── identifier.ts       ← 按文件名推断 fileType
        │   ├── utils.ts            ← Nordhive 格式通用工具
        │   └── parse*.ts           ← 各报表 parser（共 9 种）
        ├── skills/
        │   ├── index.ts            ← Skill 注册表（SKILL.md + 代码技能）+ executeTool 路由
        │   └── amazonOps.ts        ← 内置 Amazon Ops Skill（封装 8 个工具）
        └── rules/
            ├── alerts/             ← 每日告警规则引擎
            │   ├── index.ts        ← 入口：runAndPersistAlerts()
            │   ├── sales.ts        ← 环比下降告警
            │   ├── ads.ts          ← ACoS / CTR / OCR / 退款率 / 预算利用率
            │   ├── inventory.ts    ← 可售天数不足
            │   └── reviews.ts      ← 评分告警（来自关键词监控）
            └── sop/                ← 广告优化 SOP 规则（P0–P3）

.claude/
└── skills/                         ← Agent SDK 技能目录（settingSources: project）
    └── amazon-ops/
        └── SKILL.md                ← Amazon 运营技能定义（YAML frontmatter + 文档）
```

---

## 数据模型

| 表 | 用途 | 写入策略 |
|----|------|---------|
| `CategoryMap` | 品类 → ASIN 列表（手动维护） | seed.ts 初始化 |
| `AsinConfig` | ASIN → 品类归属 + 产品阶段 | seed.ts 初始化 |
| `ProductMetricDay` | 产品报表日粒度指标 | 按 (asin, date) upsert，时序累积 |
| `ContextFile` | 其他报表解析结果 | 按 fileType upsert，最新覆盖 |
| `Alert` | 每日告警记录 | 按 snapshotDate deleteMany + createMany |
| `Session` | Chat 对话 Session | 用户创建 |
| `Message` | Session 内消息（含 toolCalls） | done 事件后写入 |

> **注意**：`Message.toolCalls` 在 DB 中以 JSON 字符串存储，`GET /api/sessions/:id` 返回前会自动 parse 为数组。

---

## 报表文件类型

| fileType | 报表名 | 存储表 | 触发告警 |
|----------|--------|--------|---------|
| `product` | 产品报表-ASIN视图 | `ProductMetricDay` | ✅ |
| `keyword_monitor` | 关键词监控 | `ContextFile` | ✅（评分告警） |
| `inventory` | 库存报表 | `ContextFile` | ✅ |
| `us_campaign_30d` | US 广告活动 | `ContextFile` | ✅ |
| `search_terms` | 搜索词重构 | `ContextFile` | — |
| `campaign_3m` | 广告活动重构（ALL） | `ContextFile` | — |
| `placement_us_30d` | 广告位报表 | `ContextFile` | — |
| `cost_mgmt` | 成本管理 | `ContextFile` | — |
| `aba_search` | ABA 搜索词对比 | `ContextFile` | — |

文件名识别逻辑：`src/lib/parsers/identifier.ts`（优先级敏感，`campaign_3m` 需同时含"重构"+"ALL"）

**特殊格式**：`keyword_monitor` 无 Total 行，数据从 Row5 起（idx 4），snapshotDate 从文件名提取。

---

## AI Chat 架构

采用 **Agent SDK 架构模式**（基于 `@anthropic-ai/sdk`）：

```
ChatPanel（两栏）
  左栏：Session 列表 + 新建对话（CRUD via /api/sessions）
  右栏：消息历史 + 工具调用气泡 + 输入框
          │
          ▼
POST /api/sessions/:id/run
  ├── 加载历史（最近 40 条消息）
  ├── buildAgentSystemPrompt()        ← 感知最新上传文件
  ├── getSkillIndex()                 ← 从 .claude/skills/ 注入技能描述
  ├── getSessionSkillTools()          ← 获取可用工具（对应 allowedTools）
  └── runAgentLoop()
        ├── for await event of stream ← 对应 includePartialMessages 流式模式
        │     content_block_delta → SSE: text_delta（实时输出）
        ├── stop_reason=tool_use → executeTool() → SSE: tool_start / tool_done
        └── stop_reason=end_turn → 写 DB → SSE: done
```

**SSE 事件类型**：`session_start` · `text_delta` · `tool_start` · `tool_done` · `done` · `error`

**8 个内置工具**（`lib/agentTools.ts`）：`get_metrics` · `get_acos_history` · `get_inventory` · `get_ad_campaigns` · `get_search_terms` · `get_alerts` · `list_uploaded_files` · `get_file_data`

### 新增技能（Skills）

技能遵循 Agent SDK 的 SKILL.md 规范，存放于 `.claude/skills/`，服务启动时自动加载。

**新增技能步骤：**
1. 在 `.claude/skills/<skill-name>/` 创建 `SKILL.md`（含 YAML frontmatter: `name` / `description` / `tools`）
2. 在 `src/lib/skills/index.ts` 的 `registeredSkills` 数组追加技能实现（工具定义 + 执行器）
3. 在 `src/lib/agentTools.ts` 实现新工具的执行逻辑

`SKILL.md` 示例：
```markdown
---
name: my-skill
description: 一句话描述，Claude 根据此决定是否调用本技能
tools:
  - my_tool_a
  - my_tool_b
---
# 技能正文（使用指南、工具说明等）
```

---

## 告警引擎

上传以下文件时自动触发（`runAndPersistAlerts`）：

| 文件 | 触发的告警规则 |
|------|--------------|
| `product` | 销售环比 / ACoS / CTR / OCR / 退款率 / 预算利用率 / 库存天数 |
| `keyword_monitor` | 评分（< 3.8 红色，< 4.0 黄色） |
| `inventory` | 库存可售天数 |
| `us_campaign_30d` | 预算利用率 |

阈值按产品阶段（launch / growth / mature）差异化配置，见 `lib/config.ts`。

---

## npm Scripts

```bash
npm run dev          # 开发服务器（http://localhost:3000）
npm run build        # 生产构建
npm run db:push      # 同步 schema → dev.db（首次或修改 schema 后运行）
npm run db:seed      # 初始化品类/ASIN 配置（首次运行）
npm run lint         # ESLint 检查
```
