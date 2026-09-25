# Inspiration: ASOS / DSP Agent Hub dashboard

Source: `https://dspagenthub.com/dashboard`, "ASOS: AI Sales Operating System" (WhatsApp-first AI sales
agents for an EdTech brand, "DSP: Digital Skills Platform", PKR). Reviewed 2026-09-25 from the public app
bundle (route names and UI strings only). Screenshots weren't possible: the sandbox browser doesn't trust
the proxy certificate, and changing browser trust was deliberately not done.

## What it has (by page)
| Their page | What it does | Our equivalent |
|---|---|---|
| **Today** | "Needs you personally": unanswered, gone quiet, stalled, payment proofs to confirm; "Nothing needs you today" | Dashboard (partial) → **adopt as a Today view (M12)** |
| Dashboard | Live HOT-lead feed, handoff queue ("AI passed to human"), avg AI score, score breakdown, assign agent, mark won/lost | Leads + Dashboard |
| Leads / Pipeline | Kanban + table (New → Qualified → Proposal → Won/Lost), HOT/WARM/COLD, AI insights per lead | Leads (table) → **kanban view later** |
| Conversations | Filters: All / Unread / AI-handled / Needs human; 24h window notice; template picker outside the window; "Nothing sends until you press Send"; confirm payment | Conversations + Approval Center (M9 shows the 24h window and "nothing sends until you approve") |
| AI Insights | Buying signals (fee inquiry, installments, schedule, career outcome, trainer credibility…), at-risk conversations, sentiment, weekly digest | Analytics Agent → **M12** |
| Ads | Brand extraction from a website URL, ad copy variants in English/Urdu, "Swipe Studio" to save/skip variants | Content/Marketing → later |
| Analytics / Reports | Funnel, source attribution, AI vs human performance, AI handle rate, hot leads by hour, tokens used | **M12** |
| Students | Learn → Build → Earn lifecycle with milestones (first agent built, first client project, earning) | Students (progress + certificates) → **add lifecycle milestones later** |
| Automations | IF/THEN rules: no reply for X hours, stage entered, no activity for X days → send WhatsApp template / email / tag / assign; payment reminder, re-engage cold, certificate notification | **M10** (ours: every send still goes through approval unless the owner pre-approves a template) |
| Onboarding, Billing | Multi-tenant SaaS setup | Not needed (single operator) |

## Adopted / planned
1. **24h window everywhere a message is sent** (done in M9: window chip, execution-time check).
2. **"Nothing sends until you press Send"** as the core promise (done: Approval Center + Conversations).
3. **Today view**: a single "needs you" list (unanswered > X h, hot lead gone quiet, payment proofs pending, approvals waiting). Planned with Analytics (M12); data already exists.
4. **Automation triggers** "no reply for X hours (we spoke last)" vs "no activity for X days (either side)": use the same distinction in M10.
5. **Buying-signal taxonomy** for WhatsApp triage (fee, installments, schedule, career outcome, trainer credibility, corporate): add as intents in M10/M12.
6. **Student lifecycle Learn → Build → Earn** milestones: candidate for a later education iteration.
7. **Approved message templates** for outside the 24h window: M11 (WhatsApp templates API).

## Deliberately different
- No auto-sending without approval (theirs sends automatically); owner-defined auto-approval arrives only for specific templates.
- No numbers shown without data (ADR-014): their demo uses sample data; ours shows empty states.
