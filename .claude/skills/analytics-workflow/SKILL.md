---
name: analytics-workflow
description: Build or change analytics, reports, dashboards and the Analytics Agent (revenue, leads, conversions, content, campaigns, agent performance).
---
# Analytics workflow
1. Analytics reads through SQL views on a read-only role; agents never run model-written raw SQL.
2. Revenue = verified payments only. State the time zone (Asia/Karachi) in every report.
3. Agent performance comes from `agent_runs` (latency, tokens, cost, failures).
4. Tests use fixed fixtures with known totals.
