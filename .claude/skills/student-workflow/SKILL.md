---
name: student-workflow
description: Build or change student, course, batch, enrollment, class, attendance, assignment, payment or certificate features and the Student/Course agents.
---
# Student workflow
As built: API `apps/api/src/routes/education.ts`, progress `packages/database/src/education.ts`, rules `packages/shared/src/education.ts`, agent tools `packages/agents/src/tools/education.ts`.
1. Student = contact + enrollments. Unique (student, batch).
2. Money is `amount_minor` bigint + currency (PKR). Payments start `pending`; only a human marks them `verified`.
3. Certificate eligibility rules live in code + docs; issuing a certificate and sending reminders are `external` → approval.
4. Attendance is stored per class keyed by enrollment id.
5. Tests: enrollment uniqueness, payment verification permission, certificate eligibility.
