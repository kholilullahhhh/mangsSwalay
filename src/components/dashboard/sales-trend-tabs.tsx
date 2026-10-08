"use client";

import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { SalesTrendChart } from "@/components/charts";

export interface TrendPoint {
  label: string;
  total: number;
  transactions: number;
}

/**
 * The 7/30-day switch on the sales trend card.
 *
 * One root, one piece of state. Two separate `<Tabs>` roots — one holding the
 * triggers and another holding the panels, as this card used to be built —
 * cannot share state, so clicking "30 Hari" moved a highlight in the header while
 * the chart below stayed on the 7-day series. A control that looks live and does
 * nothing is worse than no control, and the fix is a single controlled root.
 */
export function SalesTrendTabs({
  week,
  month,
  emptyTitle,
  emptyDescription,
}: {
  week: TrendPoint[];
  month: TrendPoint[];
  emptyTitle: string;
  emptyDescription: string;
}) {
  const panels: Array<{ value: string; label: string; data: TrendPoint[] }> = [
    { value: "7", label: "7 Hari", data: week },
    { value: "30", label: "30 Hari", data: month },
  ];

  return (
    <Tabs defaultValue="7" className="space-y-4">
      <TabsList className="w-fit">
        {panels.map((panel) => (
          <TabsTrigger key={panel.value} value={panel.value}>
            {panel.label}
          </TabsTrigger>
        ))}
      </TabsList>

      {panels.map((panel) => (
        <TabsContent key={panel.value} value={panel.value}>
          {panel.data.some((point) => point.total > 0) ? (
            <SalesTrendChart data={panel.data} />
          ) : (
            <div className="rounded-lg border border-dashed py-16 text-center">
              <p className="text-sm font-medium">{emptyTitle}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {emptyDescription}
              </p>
            </div>
          )}
        </TabsContent>
      ))}
    </Tabs>
  );
}