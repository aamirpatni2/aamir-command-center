export type Band = "hot" | "warm" | "cold";
export const LEAD_STATUSES = ["new", "contacted", "qualified", "interested", "negotiating", "won", "lost", "nurture"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export interface LeadRow {
  id: string;
  status: LeadStatus;
  score: number;
  band: Band;
  source: string;
  nextFollowUpAt: string | null;
  lastInboundAt: string | null;
  createdAt: string;
  inboundMessageCount: number;
  contactId: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  conversationId: string | null;
}

export interface LeadDetail {
  lead: {
    id: string;
    status: LeadStatus;
    score: number;
    band: Band;
    source: string;
    notes: string | null;
    nextFollowUpAt: string | null;
    lastInboundAt: string | null;
    inboundMessageCount: number;
    scoreReasons: { rule: string; points: number }[];
    signals: Record<string, boolean>;
    createdAt: string;
  };
  contact: { id: string; name: string | null; phone: string | null; email: string | null; city: string | null };
  conversations: { id: string; channel: string; lastMessageAt: string | null }[];
}

export interface ConversationRow {
  id: string;
  channel: string;
  status: string;
  lastMessageAt: string | null;
  contactName: string | null;
  contactPhone: string | null;
  lastMessage: string | null;
  lastDirection: "inbound" | "outbound" | null;
  leadId: string | null;
  leadScore: number | null;
  band: Band | null;
  pendingDrafts: number;
}

export interface ConversationDetail {
  conversation: { id: string; channel: string; status: string };
  contact: { id: string; name: string | null; phone: string | null };
  lead: (LeadDetail["lead"] & { id: string }) | null;
  messages: { id: string; direction: "inbound" | "outbound"; body: string | null; media: unknown; status: string; sentBy: string; createdAt: string }[];
  drafts: { id: string; taskId: string | null; createdAt: string; text: string }[];
}
