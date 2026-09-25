# Database Design

PostgreSQL 16 · Drizzle ORM · SQL migrations in `packages/database/migrations`.
Source of truth: `packages/database/src/schema/*.ts`.

## Conventions
- Primary keys: `uuid` (`gen_random_uuid()`).
- Every table has `created_at`, `updated_at` (`timestamptz`, default `now()`).
- Soft deletion (`deleted_at timestamptz null`) on business records a human might restore: users, leads, contacts, students, courses, course_batches, content_items, campaigns, knowledge_documents, automation_rules. Queries filter `deleted_at IS NULL`. Partial unique indexes ignore soft-deleted rows.
- Append-only (no soft delete, no update): `audit_logs`, `messages`, `agent_messages`, `campaign_metrics`.
- Enums are Postgres enums, mirrored in `packages/shared` for the frontend.
- Money: `amount_minor bigint` + `currency char(3)` (PKR default). No floats for money.
- Phone numbers stored in E.164 (`+923001234567`), normalised on write.
- Emails use `citext` (case-insensitive uniqueness).

## Entities

### Identity & security
| Table | Key columns | Notes |
|---|---|---|
| `users` | email (citext, unique), password_hash, name, role (`owner/admin/operator/viewer`), is_active, last_login_at | |
| `sessions` | user_id, token_hash (unique), csrf_token, ip, user_agent, expires_at, last_seen_at, revoked_at | only the token hash is stored |
| `audit_logs` | actor_type (`user/agent/system`), actor_id, action, entity_type, entity_id, metadata jsonb, ip, user_agent, request_id | idx (entity_type, entity_id), idx created_at |

### CRM & conversations
| Table | Key columns | Notes |
|---|---|---|
| `contacts` | name, phone (E.164), email, whatsapp_id, locale, tags[] | partial unique on phone |
| `leads` | contact_id, source, status (`new/contacted/qualified/interested/negotiating/won/lost/nurture`), score 0-100, score_reasons jsonb, interested_course_id, owner_user_id, next_follow_up_at, notes | idx (status), idx (next_follow_up_at). Duplicate rule: one open lead per contact (partial unique on contact_id where status not in won/lost) |
| `conversations` | contact_id, channel (`whatsapp/instagram/facebook/email/web`), external_thread_id, status (`open/pending/closed`), intent, last_message_at, assigned_agent | unique (channel, external_thread_id) |
| `messages` | conversation_id, direction (`inbound/outbound`), provider_message_id, body, media jsonb, status (`received/draft/pending_approval/sent/delivered/read/failed`), sent_by (`user/agent/contact`) | **unique (provider_message_id)** stops duplicate webhook processing |

### Education
| Table | Key columns |
|---|---|
| `courses` | slug (unique), title, description, level, language, price_minor, currency, duration_weeks, status (`draft/active/archived`) |
| `course_batches` | course_id, name, starts_on, ends_on, schedule jsonb, capacity, status (`planned/enrolling/running/completed/cancelled`), early_bird_price_minor, early_bird_until |
| `students` | contact_id, user_id (nullable, future student portal), status (`active/paused/completed/dropped`), notes |
| `enrollments` | student_id, batch_id, status (`pending/active/completed/dropped/refunded`), enrolled_at, certificate_status (`not_eligible/eligible/issued`), certificate_url | unique (student_id, batch_id) |
| `classes` | batch_id, title, starts_at, duration_min, meeting_url, recording_url, recording_status (`none/processing/available`), attendance jsonb |
| `assignments` | batch_id, class_id, title, instructions, due_at, max_score; submissions go in `assignment_submissions` (enrollment_id, assignment_id, status, score, submitted_at, feedback) |
| `payments` | enrollment_id / lead_id, amount_minor, currency, method (`bank_transfer/jazzcash/easypaisa/card/cash/other`), status (`pending/verified/refunded/failed`), reference, verified_by, paid_at | unique (method, reference) where reference not null |

### Content & marketing
| Table | Key columns |
|---|---|
| `content_items` | type (`idea/hook/script/caption/post/reel/carousel/image_prompt/video_prompt`), platform, language (`ur/ur-roman/en`), title, body, data jsonb, status (`draft/in_review/approved/scheduled/published/rejected`), scheduled_for, published_at, source_task_id, sources jsonb |
| `campaigns` | platform (`meta/google/tiktok/youtube/other`), external_id, name, objective, status, budget_minor, currency, starts_on, ends_on, course_batch_id |
| `campaign_metrics` | campaign_id, date, impressions, clicks, spend_minor, leads, conversions, raw jsonb | unique (campaign_id, date) |

### Agents & automation
| Table | Key columns |
|---|---|
| `agent_tasks` | title, input text, requested_by, status (`QUEUED/RUNNING/WAITING_APPROVAL/COMPLETED/FAILED/CANCELLED`), priority, plan jsonb, result jsonb, error, source (`user/automation/webhook`), automation_rule_id, started_at, finished_at |
| `agent_steps` | task_id, position, agent_id, instruction, depends_on int[], status, run_id |
| `agent_runs` | task_id, step_id, parent_run_id, agent_id, status, model_provider, model, input jsonb, output jsonb, state jsonb, latency_ms, input_tokens, output_tokens, cost_micro_usd, tool_call_count, error_code, error_message, started_at, finished_at |
| `agent_messages` | run_id, seq, role (`system/user/assistant/tool`), content jsonb, tool_name, tool_call_id, tool_risk, latency_ms, is_error | unique (run_id, seq) |
| `approvals` | task_id, run_id, action_type, tool_name, risk, title, summary, payload jsonb, edited_payload jsonb, status (`pending/approved/rejected/expired/executed/failed`), requested_by_agent, decided_by, decided_at, decision_note, idempotency_key (unique), expires_at, executed_at, execution_result jsonb |
| `automation_rules` | name, trigger (`event/schedule/webhook`), trigger_config jsonb, conditions jsonb, steps jsonb, policy jsonb (auto-approve scope), enabled, created_by, last_run_at |
| `memory_items` | kind (`fact/preference/decision/event`), subject, content, source (`user/agent/system`), status (`proposed/approved/rejected`), confidence, source_run_id, approved_by |

### Knowledge (RAG)
| Table | Key columns |
|---|---|
| `knowledge_documents` | title, category (`course/pricing/schedule/policy/faq/teaching/business/marketing/brand`), language, body, status (`draft/approved/archived`), version, approved_by, approved_at, valid_until |
| `knowledge_chunks` | document_id, chunk_index, content, embedding `vector(1536)`, token_count, metadata jsonb | HNSW index on embedding (cosine) added in Milestone 8 when the embedding model is picked |

## Indexing summary
- FK columns are indexed.
- Hot filters: `leads(status)`, `leads(next_follow_up_at)`, `agent_tasks(status, created_at)`, `agent_runs(task_id)`, `approvals(status, created_at)`, `messages(conversation_id, created_at)`, `audit_logs(created_at)`.
- Uniques that enforce business rules: provider_message_id, (channel, external_thread_id), one open lead per contact, (student_id, batch_id), (campaign_id, date), approval idempotency_key.

## Migration workflow
```
pnpm db:generate   # drizzle-kit generates SQL from the schema diff
pnpm db:migrate    # applies pending migrations (runs in CI + at deploy)
pnpm db:seed       # dev seed data (never in production)
pnpm db:create-owner  # interactive/ENV-driven owner bootstrap
```
Generated SQL is reviewed and committed. No `db push` in shared environments.
