# Lead scoring rules: v1 STARTER (pending Aamir's approval)

Source of truth in code: `packages/shared/src/lead-scoring.ts`. Change both together and bump `SCORING_VERSION`.

Scoring is deterministic: every point has a stated reason, stored on the lead (`score_reasons`) and shown in the UI. Agents never invent scores.

| Signal | Points | How it's detected |
|---|---|---|
| Asked how to enrol / pay | +25 | message mentions enrol, admission, register, join, payment, JazzCash, EasyPaisa, account number, داخلہ… |
| Asked about the fee | +20 | fee, price, cost, kitni, qeemat, فیس، قیمت… |
| Asked about dates or timings | +15 | kab, when, start, timing, schedule, batch, کب، شروع… |
| Came through a referral | +15 | lead source = `referral` |
| Came from a paid ad | +10 | source = `facebook_ad`, `instagram_ad`, `meta_ad`, `google_ad`, `tiktok_ad` |
| Fits the target profile | +10 | confirmed by a person or the Sales Agent (student, freelancer, teacher, job-seeker, business owner) |
| Sent 3 or more messages | +10 | inbound message count |
| No message for 7+ days | −15 | last inbound message older than 7 days |
| Said not interested / stop | −60 | not interested, nahi chahiye, stop, unsubscribe… |

Score is clamped to 0–100. **Bands:** hot ≥ 60 · warm 30–59 · cold < 30.

Keyword detection only ever adds signals; a person or the Sales Agent confirms profile fit.

## Questions for Aamir before approving
1. Are these the right signals and weights for your buyers? (e.g. should "teacher" count more than "student"?)
2. Should a referral from an existing student count more than +15?
3. After how many days without a reply should a lead become "nurture"?
