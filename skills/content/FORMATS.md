# Content formats & checks (Content Agent)

Formats are defined in `packages/shared/src/content.ts` (`CONTENT_FORMATS`); every saved item is validated against one:
idea · hook · reel · script (YouTube long-form) · caption · post · carousel · image_prompt · video_prompt.

Voice and structure follow Aamir's content system: big-bhai tone, Roman Urdu default, Pakistan-grounded, hook first, practical action, no AI-isms. See `agents/content/prompt.md`.

## Automatic checks (warn, never block; a person decides)
| Code | What it catches |
|---|---|
| LANGUAGE | Urdu marked but mostly Latin letters, or Roman Urdu/English marked but mostly Urdu script (prompts exempt: they're English by design) |
| AI_ISM | delve, leverage, comprehensive, "it's worth noting", "in conclusion", transformative, "let's explore"… |
| HINDI_WORD | dhanyavaad, shubh, prashn, samasya, jankari… (use Pakistani Urdu) |
| INCOME_CLAIM | "Rs. 80,000 mahine kamao", "$500 per month"… (Meta policy: needs a real source) |
| GUARANTEE | guaranteed, 100%, pakka, get rich, overnight… |
| SCARCITY | "sirf 5 seats", "last chance" (must match real seats in the catalogue) |
| UNSOURCED_STAT | a percentage without a source |
| HOOK_LENGTH | hook longer than ~15 words |

## Workflow
draft → in review → approved → scheduled → published (or rejected). Operators draft and submit; owner/admin approve, schedule and publish. Editing approved or scheduled text sends it back to review. Published items are locked. Every transition is audited and kept in the item's history.
