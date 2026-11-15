import type { ComponentType, ReactNode } from "react";
import { cx } from "@/utils/cx";
import { Button } from "@/components/base/buttons/button";

export function Panel({
  children,
  className,
  as: Tag = "section",
}: {
  children: ReactNode;
  className?: string;
  as?: "section" | "div" | "article";
}) {
  return (
    <Tag
      className={cx(
        "rounded-3xl border border-border-button-default bg-background-primary-default shadow-card",
        className,
      )}
    >
      {children}
    </Tag>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow ? (
          <p className="mb-2 text-caption-1-semibold uppercase tracking-[0.14em] text-accent-600">{eyebrow}</p>
        ) : null}
        <h1 className="text-display-4-semibold text-text-primary sm:text-display-3-semibold">{title}</h1>
        {description ? <p className="mt-2 max-w-2xl text-body-regular text-text-secondary">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function SectionHeading({
  title,
  description,
  action,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-end justify-between gap-3">
      <div>
        <h2 className="text-title-3-semibold text-text-primary">{title}</h2>
        {description ? <p className="mt-1 text-body-2-regular text-text-secondary">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
}: {
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <span className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-background-secondary-default">
        <Icon className="size-6 text-foreground-icon-secondary" aria-hidden />
      </span>
      <h3 className="text-title-3-semibold text-text-primary">{title}</h3>
      <p className="mt-1 max-w-sm text-body-2-regular text-text-secondary">{description}</p>
      {actionLabel && onAction ? (
        <Button className="mt-5" size="small" onClick={onAction}>
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}

export function ProgressRow({
  label,
  meta,
  value,
  tone = "accent",
}: {
  label: ReactNode;
  meta: ReactNode;
  value: number;
  tone?: "accent" | "lime" | "rose";
}) {
  const bar =
    tone === "lime" ? "bg-status-lime-text" : tone === "rose" ? "bg-status-rose-text" : "bg-accent-600";
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-body-2-medium text-text-primary">{label}</span>
        <span className="shrink-0 text-caption-1-medium text-text-tertiary tabular">{meta}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-background-tertiary-default">
        <div className={cx("h-full rounded-full transition-[width] duration-500", bar)} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
      </div>
    </div>
  );
}

export function KeyValue({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-separator-border py-2.5 last:border-b-0">
      <dt className="text-body-2-regular text-text-secondary">{label}</dt>
      <dd className="text-body-2-semibold text-text-primary">{children}</dd>
    </div>
  );
}
