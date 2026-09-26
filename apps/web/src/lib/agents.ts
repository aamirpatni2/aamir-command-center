import { BarChart3, BookOpen, Brain, GraduationCap, Megaphone, MessageCircle, PenSquare, Telescope, TrendingUp, type LucideIcon } from "lucide-react";
import type { VizTone } from "@acc/ui";

/** Display identity for each agent: name, colour and icon. Colour always comes with the name. */
export const AGENT_META: Record<string, { label: string; tone: VizTone; icon: LucideIcon }> = {
  orchestrator: { label: "Orchestrator", tone: "indigo", icon: Brain },
  sales: { label: "Sales", tone: "emerald", icon: TrendingUp },
  whatsapp: { label: "WhatsApp", tone: "cyan", icon: MessageCircle },
  content: { label: "Content", tone: "fuchsia", icon: PenSquare },
  research: { label: "Research", tone: "sky", icon: Telescope },
  student: { label: "Student", tone: "amber", icon: GraduationCap },
  marketing: { label: "Marketing", tone: "rose", icon: Megaphone },
  analytics: { label: "Analytics", tone: "violet", icon: BarChart3 },
  course: { label: "Course", tone: "violet", icon: BookOpen },
};

export function agentMeta(id: string | null | undefined) {
  if (!id) return { label: "System", tone: "indigo" as VizTone, icon: Brain };
  return AGENT_META[id] ?? { label: id.charAt(0).toUpperCase() + id.slice(1), tone: "indigo" as VizTone, icon: Brain };
}
