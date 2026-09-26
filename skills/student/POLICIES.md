# Student policies: v1 STARTER (pending Aamir's approval)

Source of truth in code: `packages/shared/src/education.ts` (`CERTIFICATE_RULES`, `effectivePriceMinor`). Change both together and bump the version.

## Certificate eligibility
A certificate can be issued (owner/admin only, audited) when **all** of these hold:

| Rule | Starter value |
|---|---|
| Enrolment is active or completed | payment verified at least once |
| Attendance (present or late) of classes already held | ≥ 75% |
| Assignments submitted (submitted, late or graded) | ≥ 80% (skipped if the batch has no assignments) |
| Fee fully paid | verified payments ≥ the enrolment price |

Agents can only *request* a certificate (goes to the Approval Center). The UI shows each check with its numbers.

## Fees
- Price at enrolment = batch price, else course price. Early-bird price applies if the student enrolled on or before the early-bird date (Pakistan calendar date).
- Payments are recorded as **pending** and count only once a person (owner/admin) **verifies** them. Verifying the first payment activates the enrolment and marks the sales lead as **won**.
- The same payment method + reference (e.g. a JazzCash TID) can't be recorded twice.

## Still to be written by Aamir (agents will say "not documented" until then)
- Refund policy
- Recording access policy (how long, who gets it)
- Missed-class / catch-up policy
- Certificate format and delivery (PDF? link?)

Add these as **approved** knowledge documents (Knowledge page, Milestone 8), or tell Claude and they'll be added.
