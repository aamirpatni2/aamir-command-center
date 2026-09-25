---
name: sales-workflow
description: Build or change lead capture, lead scoring, sales follow-up or CRM features (leads, contacts, conversations, Sales/WhatsApp agents). Use when touching leads APIs, scoring rules or sales agent prompts.
---
# Sales workflow
1. Leads are keyed by contact phone in E.164. One open lead per contact — duplicates merge (see `leads_one_open_per_contact`).
2. Lead scoring is rule-based and documented in `skills/sales/SCORING.md` (create/update it when rules change). Store `score_reasons` for every point.
3. The Sales Agent may update status/notes (`write`), but any outbound message is `external` → approval.
4. Course recommendations must come from **approved** knowledge documents (price, schedule), never model memory.
5. Tests: duplicate lead, duplicate message, scoring rules, unauthorized status change.
