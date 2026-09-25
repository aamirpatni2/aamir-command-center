---
name: content-workflow
description: Build or change content generation — hooks, scripts, captions, Reels, image/video prompts, content calendar, Urdu/English output. Use when touching the Content Agent or content_items.
---
# Content workflow
1. Every generated item is a `content_items` row with status `draft`; publishing is `external` → approval.
2. Language: `ur` (Urdu script), `ur-roman`, or `en`. Urdu must be natural Pakistani Urdu; keep AI/API/MCP etc. in English.
3. Facts in content must cite `sources` from the Research Agent; no invented stats, testimonials or guarantees.
4. Validate model output against the Zod schema for the content type before saving.
5. Tests: schema validation, language field, source propagation.
