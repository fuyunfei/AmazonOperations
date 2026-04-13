---
name: amazon-ops
description: 查询和分析亚马逊卖家运营报表数据，支持 KPI 诊断、广告效率分析、搜索词优化、库存健康检查和告警查看
tools:
  - get_metrics
  - get_acos_history
  - get_inventory
  - get_ad_campaigns
  - get_search_terms
  - get_alerts
  - list_uploaded_files
  - get_file_data
---

# Amazon 运营分析技能 (Amazon Ops Skill)

## 功能范围

本技能提供亚马逊卖家运营数据的查询与分析能力，所有数据来自用户已上传的报表文件。

## 工具清单

| 工具 | 用途 | 所需报表 |
|------|------|---------|
| `get_metrics` | 产品 KPI 快照（GMV、订单量、ACoS、TACoS、CTR、CVR）| product |
| `get_acos_history` | 某 ASIN 的 ACoS + GMV 历史日趋势 | product |
| `get_inventory` | 库存状态（可售量、补货建议）| inventory |
| `get_ad_campaigns` | 广告活动维度数据 | campaign_3m |
| `get_search_terms` | 搜索词广告表现 | search_terms |
| `get_alerts` | 已触发的运营告警（red/yellow/all）| product |
| `list_uploaded_files` | 列出所有已上传报表及新鲜度 | — |
| `get_file_data` | 读取任意文件类型原始数据 | 任意 |

## 使用规则

1. 任何涉及数据的问题，**必须先调用工具**获取真实数据，禁止凭记忆或假设回答
2. 跨品类对比时，分别查询各品类数据再汇总分析
3. 工具返回错误时，告知用户需要上传哪份报表
4. 需要多个时间段对比时，多次调用 `get_metrics` 分别查询

## 扩展说明

未来可在此目录（`.claude/skills/`）下添加新技能目录，每个目录包含一个 `SKILL.md` 文件即可自动被系统发现和加载。
