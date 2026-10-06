import { cn } from "@/lib/utils";

/**
 * Empty-state block.
 *
 * Every list page uses this so "no data" always reads as intentional guidance
 * rather than a broken page. When filters are active the copy explains that
 * the emptiness is caused by them, which is the case people misread as "my
 * data is gone".
 */
export function EmptyState({
  title,
  description,
  icon: Icon,
  action,
  className,
}: {
  title: string;
  description?: string;
  icon?: React.ComponentType<{ className?: string }>;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 px-6 py-14 text-center",
        className,
      )}
    >
      {Icon ? (
        <Icon className="size-9 text-muted-foreground/50" aria-hidden />
      ) : null}

      <p className="text-sm font-medium">{title}</p>

      {description ? (
        <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      ) : null}

      {action ? <div className="pt-3">{action}</div> : null}
    </div>
  );
}