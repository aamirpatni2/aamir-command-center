/**
 * "Today": only what needs Aamir personally, from live records. Nothing here is a prediction.
 */
import { sql } from "drizzle-orm";
import { BANDS } from "@acc/shared";
import type { DbOrTx } from "./crm.js";
import { ANALYTICS_TZ, getAnalytics, previousRange, type DateRange } from "./analytics.js";

export async function getToday(db: DbOrTx, now = new Date()) {
  const tz = ANALYTICS_TZ;
  const nowTs = sql`${now.toISOString()}::timestamptz`;
  const dayEnd = sql`((((${nowTs}) at time zone ${tz})::date + 1)::timestamp at time zone ${tz})`;
  const dayStart = sql`((((${nowTs}) at time zone ${tz})::date)::timestamp at time zone ${tz})`;

  /** Customer wrote last, 15+ minutes ago, within the last 7 days (older threads count as "gone quiet"). */
  const waitingForReply = await db.execute<{ conversationId: string; contactName: string | null; phone: string | null; lastMessage: string | null; waitingSince: string; leadId: string | null; score: number | null; drafts: number }>(sql`
    select c.id as "conversationId", ct.name as "contactName", ct.phone, left(m.body, 160) as "lastMessage", m.created_at as "waitingSince",
      (select l.id from leads l where l.contact_id = c.contact_id and l.deleted_at is null order by l.created_at desc limit 1) as "leadId",
      (select l.score from leads l where l.contact_id = c.contact_id and l.deleted_at is null order by l.created_at desc limit 1) as score,
      (select count(*)::int from approvals a where a.status = 'pending' and a.payload->>'conversationId' = c.id::text) as drafts
    from conversations c
    join contacts ct on ct.id = c.contact_id
    join lateral (select body, direction, created_at from messages where conversation_id = c.id order by created_at desc limit 1) m on true
    where m.direction = 'inbound' and m.created_at < ${nowTs} - interval '15 minutes' and m.created_at > ${nowTs} - interval '7 days'
    order by m.created_at asc limit 25
  `);

  const hotGoneQuiet = await db.execute<{ leadId: string; contactName: string | null; phone: string | null; score: number; status: string; lastActivity: string }>(sql`
    select l.id as "leadId", ct.name as "contactName", ct.phone, l.score, l.status::text as status, a.last_activity as "lastActivity"
    from leads l
    join contacts ct on ct.id = l.contact_id
    join lateral (
      select greatest(l.created_at, coalesce((select max(m.created_at) from messages m join conversations cv on cv.id = m.conversation_id where cv.contact_id = l.contact_id), l.created_at)) as last_activity
    ) a on true
    where l.deleted_at is null and l.status not in ('won', 'lost') and l.score >= ${BANDS.hot}
      and a.last_activity < ${nowTs} - interval '48 hours' and a.last_activity > ${nowTs} - interval '14 days'
    order by l.score desc, a.last_activity asc limit 25
  `);

  const followUpsDue = await db.execute<{ leadId: string; contactName: string | null; phone: string | null; score: number; dueAt: string; overdue: boolean }>(sql`
    select l.id as "leadId", ct.name as "contactName", ct.phone, l.score, l.next_follow_up_at as "dueAt", l.next_follow_up_at < ${dayStart} as overdue
    from leads l join contacts ct on ct.id = l.contact_id
    where l.deleted_at is null and l.status not in ('won', 'lost') and l.next_follow_up_at is not null and l.next_follow_up_at < ${dayEnd}
    order by l.next_follow_up_at asc limit 25
  `);

  const paymentsToVerify = await db.execute<{ paymentId: string; amountMinor: number; method: string; reference: string | null; studentName: string | null; studentId: string | null; course: string | null; createdAt: string }>(sql`
    select p.id as "paymentId", p.amount_minor::int as "amountMinor", p.method::text as method, p.reference, ct.name as "studentName", s.id as "studentId", co.title as course, p.created_at as "createdAt"
    from payments p
    left join enrollments e on e.id = p.enrollment_id
    left join students s on s.id = e.student_id
    left join contacts ct on ct.id = s.contact_id
    left join course_batches b on b.id = e.batch_id
    left join courses co on co.id = b.course_id
    where p.status = 'pending'
    order by p.created_at asc limit 25
  `);

  const classesToday = await db.execute<{ classId: string; title: string; startsAt: string; batchId: string; batch: string; course: string; meetingUrl: string | null }>(sql`
    select c.id as "classId", c.title, c.starts_at as "startsAt", b.id as "batchId", b.name as batch, co.title as course, c.meeting_url as "meetingUrl"
    from classes c join course_batches b on b.id = c.batch_id join courses co on co.id = b.course_id
    where c.starts_at >= ${dayStart} and c.starts_at < ${dayEnd}
    order by c.starts_at asc
  `);

  const [approvals] = await db.execute<{ pending: number; oldest: string | null; approvedNotSent: number; unknownOutcome: number }>(sql`
    select count(*) filter (where status = 'pending')::int as pending,
      min(created_at) filter (where status = 'pending') as oldest,
      count(*) filter (where status = 'approved')::int as "approvedNotSent",
      count(*) filter (where status = 'failed' and updated_at > ${nowTs} - interval '7 days')::int as "unknownOutcome"
    from approvals
  `);

  const counts = {
    waitingForReply: waitingForReply.length,
    hotGoneQuiet: hotGoneQuiet.length,
    followUpsDue: followUpsDue.length,
    paymentsToVerify: paymentsToVerify.length,
    approvals: (approvals?.pending ?? 0) + (approvals?.approvedNotSent ?? 0),
    classesToday: classesToday.length,
  };
  return {
    generatedAt: now.toISOString(),
    counts,
    allClear: counts.waitingForReply + counts.hotGoneQuiet + counts.followUpsDue + counts.paymentsToVerify + counts.approvals === 0,
    waitingForReply: [...waitingForReply],
    hotGoneQuiet: [...hotGoneQuiet],
    followUpsDue: [...followUpsDue],
    paymentsToVerify: [...paymentsToVerify],
    classesToday: [...classesToday],
    approvals: approvals ?? { pending: 0, oldest: null, approvedNotSent: 0, unknownOutcome: 0 },
  };
}

export interface Insight {
  id: string;
  severity: "good" | "info" | "warning";
  title: string;
  detail: string;
  link?: string;
}

/**
 * Calculated insights (rules over real numbers, not AI). An insight only appears when there is
 * enough data for it to mean something; thresholds are stated in the text.
 */
export async function getInsights(db: DbOrTx, range: DateRange, now = new Date()): Promise<{ current: Awaited<ReturnType<typeof getAnalytics>>; insights: Insight[] }> {
  const cur = await getAnalytics(db, range);
  const prev = await getAnalytics(db, previousRange(range));
  const today = await getToday(db, now);
  const out: Insight[] = [];
  const period = `the last ${cur.range.days} days`;

  if (today.counts.waitingForReply > 0) {
    const oldest = today.waitingForReply[0]!;
    const hours = Math.floor((now.getTime() - new Date(oldest.waitingSince).getTime()) / 3600_000);
    out.push({ id: "waiting", severity: "warning", title: `${today.counts.waitingForReply} conversation(s) waiting for a reply`, detail: `The longest has waited ${hours >= 1 ? `${hours} h` : "under an hour"}. Replies within the 24-hour window can still be free text.`, link: "/today" });
  }
  if (cur.whatsapp.medianReplyMinutes !== null && cur.whatsapp.answered >= 5) {
    const m = cur.whatsapp.medianReplyMinutes;
    out.push(
      m > 60
        ? { id: "reply-speed", severity: "warning", title: `Median reply time is ${Math.round(m)} minutes`, detail: `Across ${cur.whatsapp.answered} answered customer messages in ${period}. Faster first replies usually convert better; the WhatsApp Agent drafts replies for approval as soon as a message arrives.`, link: "/conversations" }
        : { id: "reply-speed", severity: "good", title: `Median reply time is ${Math.round(m)} minutes`, detail: `Across ${cur.whatsapp.answered} answered customer messages in ${period}.` },
    );
  }
  const sources = cur.leads.bySource.filter((s) => s.leads >= 5);
  if (sources.length >= 2 && cur.leads.new >= 10) {
    const best = [...sources].sort((a, b) => (b.conversionRate ?? 0) - (a.conversionRate ?? 0))[0]!;
    if ((best.conversionRate ?? 0) > (cur.leads.conversionRate ?? 0)) {
      out.push({ id: "best-source", severity: "info", title: `${best.source} leads convert best (${best.conversionRate}%)`, detail: `${best.won} of ${best.leads} ${best.source} leads in ${period} were won, against ${cur.leads.conversionRate}% overall. Sources with fewer than 5 leads are ignored.`, link: "/analytics" });
    }
  }
  if (cur.revenue.verifiedMinor > 0 && prev.revenue.verifiedMinor > 0) {
    const change = Math.round(((cur.revenue.verifiedMinor - prev.revenue.verifiedMinor) / prev.revenue.verifiedMinor) * 100);
    if (Math.abs(change) >= 10) {
      out.push({ id: "revenue-change", severity: change > 0 ? "good" : "warning", title: `Verified revenue ${change > 0 ? "up" : "down"} ${Math.abs(change)}% vs the previous ${cur.range.days} days`, detail: `PKR ${Math.round(cur.revenue.verifiedMinor / 100).toLocaleString("en-US")} now vs PKR ${Math.round(prev.revenue.verifiedMinor / 100).toLocaleString("en-US")} before. Only verified payments count.`, link: "/analytics" });
    }
  }
  if (cur.revenue.pendingMinor > 0 && today.counts.paymentsToVerify > 0) {
    out.push({ id: "pending-payments", severity: "info", title: `${today.counts.paymentsToVerify} payment(s) waiting for verification`, detail: "Verify them against your JazzCash, EasyPaisa or bank statement so the students' enrolments activate.", link: "/today" });
  }
  if (today.approvals.oldest && now.getTime() - new Date(today.approvals.oldest).getTime() > 24 * 3600_000) {
    out.push({ id: "approval-backlog", severity: "warning", title: "An approval has been waiting more than a day", detail: `${today.approvals.pending} request(s) are pending. Replies drafted for WhatsApp stop being deliverable as free text 24 hours after the customer's message.`, link: "/approvals" });
  }
  for (const a of cur.agents.byAgent) {
    if (a.runs >= 5 && a.failed / a.runs > 0.2) {
      out.push({ id: `agent-failures-${a.agent}`, severity: "warning", title: `The ${a.agent} agent failed ${a.failed} of ${a.runs} runs`, detail: "Open Agent activity to see the errors (often a missing API key or integration).", link: "/agents" });
    }
  }
  if (today.counts.hotGoneQuiet > 0) {
    out.push({ id: "hot-quiet", severity: "warning", title: `${today.counts.hotGoneQuiet} hot lead(s) have gone quiet for 2+ days`, detail: "A personal call or an approved template follow-up is the usual next step.", link: "/today" });
  }
  if (cur.leads.new > 0 && cur.content.published === 0 && cur.range.days >= 7) {
    out.push({ id: "no-content", severity: "info", title: `Nothing was marked published in ${period}`, detail: "If you posted outside the Command Center, mark the items as published so content and lead trends line up.", link: "/content" });
  }
  return { current: cur, insights: out };
}
