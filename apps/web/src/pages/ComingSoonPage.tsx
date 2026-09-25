import { Construction } from "lucide-react";
import { Card, EmptyState } from "@acc/ui";
import type { NavItem } from "../nav.js";
import { PageHeader } from "../components/Layout.js";

export function ComingSoonPage({ item }: { item: NavItem }) {
  return (
    <>
      <PageHeader title={item.label} description={item.description} />
      <Card>
        <EmptyState icon={<Construction className="size-7" />} title={`Arrives in Milestone ${item.milestone}`}>
          This screen is part of the roadmap and isn't connected to data yet, so nothing is shown here rather than placeholder numbers.
        </EmptyState>
      </Card>
    </>
  );
}
