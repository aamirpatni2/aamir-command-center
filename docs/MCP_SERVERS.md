# MCP Servers Catalogue

Status key: **planned** = designed, not installed · **internal** = served by our own
code, no MCP needed · **active** = configured and tested.

Rule: install only what a milestone actually needs. Active servers and their allow-listed tools are defined in `mcp.config.json` (see the Integrations page for live status).

| # | Category | Server | Status | Milestone |
|---|---|---|---|---|
| 1 | Database | internal tools over Postgres (not MCP) | internal | 3 |
| 2 | Filesystem | `@modelcontextprotocol/server-filesystem` (scoped to `data/uploads`, read-only tools) | **active** | 11 |
| 3 | Web / research | Brave Search API or Tavily API (direct adapters) + SSRF-safe fetch | **built** (needs `BRAVE_API_KEY` or `TAVILY_API_KEY`) | 8 |
| 4 | GitHub | GitHub remote MCP server (read-only tools) | **configured** (needs `GITHUB_TOKEN`) | 11 |
| 5 | Google (Drive, Calendar, Gmail) | direct REST + OAuth (ADR-039) | **built** (needs `GOOGLE_CLIENT_ID/SECRET` + connect) | 11 |
| 6 | WhatsApp | WhatsApp Cloud API (official Meta Graph API) — direct adapter | **built**: receive (webhook) + send approved replies (needs `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`) | 5/9 |
| 7 | Canva | Canva Connect REST + OAuth/PKCE (ADR-039) | **built** (needs `CANVA_CLIENT_ID/SECRET` + connect) | 11 |
| 8 | Meta Ads / analytics | Meta Marketing API MCP (read-only first) | planned | 12 |
| 9 | Browser automation | Playwright MCP — research only, never logged into business accounts | planned (optional) | 8 |
| 10 | Project management | Notion MCP | planned (optional) | 11 |

---

### 1. Database (internal)
- **Purpose**: CRM, students, content and tasks for agents.
- **Tools**: `crm.lead.search/get/upsert/update_status/add_note`, `student.*`, `course.*`, `content.create_draft`, `analytics.query` (read-only views).
- **Auth**: runs in-process with the app DB role.
- **Permissions**: per-agent allow-list; `analytics.query` runs on a read-only role.
- **Risks**: over-broad updates → schema-validated inputs, no raw SQL from models.
- **Approval**: deletes and bulk updates.
- **Env**: `DATABASE_URL`.

### 2. Filesystem
- **Purpose**: read uploaded course material and export reports.
- **Tools**: `read_file`, `list_directory`, `write_file` (exports dir only).
- **Auth**: none (local); sandboxed to allowed dirs.
- **Risks**: path traversal / reading secrets → allowed-dirs only, `.env` never inside.
- **Approval**: none for reads; writes limited to `/data/exports`.
- **Env**: `MCP_FS_ROOT`.

### 3. Web / research
- **Purpose**: AI news and tool research with sources.
- **Tools**: `web_search`, `fetch_url`.
- **Auth**: API key.
- **Risks**: prompt injection from pages → content wrapped as untrusted, Research Agent has no write/external tools.
- **Approval**: none (read-only).
- **Env**: `BRAVE_API_KEY` or `TAVILY_API_KEY`.

### 4. GitHub (optional)
- **Purpose**: track course code repos and student assignment repos.
- **Tools**: read repos, issues; no push.
- **Auth**: fine-grained PAT, read-only.
- **Approval**: any write.
- **Env**: `GITHUB_TOKEN`.

### 5. Google Workspace
- **Purpose**: class calendar, recordings in Drive, email drafts.
- **Tools**: `calendar.list/create_event`, `drive.search/read`, `gmail.create_draft` (no direct send in v1).
- **Auth**: OAuth 2.0 (owner consents once); refresh token encrypted at rest.
- **Scopes**: `calendar.events`, `drive.readonly`, `gmail.compose`.
- **Risks**: data exposure → narrow scopes, drafts only.
- **Approval**: creating calendar events visible to students; any email send.
- **Env**: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`.

### 6. WhatsApp (Cloud API)
- **Purpose**: receive lead and student messages, send approved replies and templates.
- **Tools**: `whatsapp.send_text`, `whatsapp.send_template`, `whatsapp.mark_read`; inbound through the webhook `POST /api/webhooks/whatsapp`.
- **Auth**: Meta system-user access token + app secret (for webhook HMAC) + verify token.
- **Risks**: sending in Aamir's name, spam/bans, replayed webhooks → approval gate, per-contact rate limit, signature check + `provider_message_id` unique index.
- **Approval**: **every send** in v1; later owner-defined policies for specific templates.
- **Env**: `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`.
- **Note**: unofficial WhatsApp Web automation libraries break WhatsApp's terms and risk a ban, so they won't be used.

### 7. Canva
- **Purpose**: turn approved content into creatives from brand templates.
- **Tools**: `create_design_from_template`, `export_design`.
- **Auth**: Canva Connect OAuth.
- **Approval**: none for drafts; publishing happens elsewhere.
- **Env**: `CANVA_CLIENT_ID`, `CANVA_CLIENT_SECRET`.

### 8. Meta Ads
- **Purpose**: campaign insights for the Marketing and Analytics agents.
- **Tools (v1 read-only)**: `get_campaigns`, `get_insights`.
- **Auth**: system-user token with `ads_read` only in v1.
- **Risks**: spending money → no write scope in v1; later writes are `financial` risk, owner approval only.
- **Env**: `META_ADS_ACCESS_TOKEN`, `META_AD_ACCOUNT_ID`.

### 9. Browser automation (optional)
- **Purpose**: research pages that need JS rendering.
- **Risks**: high (arbitrary sites) → isolated browser profile, no logged-in sessions, Research Agent only.
- **Env**: none.

### 10. Notion (optional)
- **Purpose**: sync the content calendar and course docs if Aamir keeps them in Notion.
- **Auth**: internal integration token scoped to chosen pages.
- **Approval**: writes.
- **Env**: `NOTION_TOKEN`.
