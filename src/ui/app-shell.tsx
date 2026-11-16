import { useState, type ReactNode } from "react";
import {
  RiBarChartBoxLine,
  RiBookOpenLine,
  RiCloseLine,
  RiDashboardLine,
  RiErrorWarningLine,
  RiLightbulbFlashLine,
  RiLoginBoxLine,
  RiMenuLine,
  RiPlayCircleLine,
  RiSettings4Line,
  RiShieldCheckLine,
  RiStarLine,
  RiCloudLine,
  RiCloudOffLine,
} from "@remixicon/react";
import { Button } from "@/components/base/buttons/button";
import { Counter } from "@/components/base/badges/counter";
import { Drawer, DrawerBody, DrawerHeader } from "@/components/base/drawer/drawer";
import { ScrollFade, useScrollFade } from "@/components/foundations/scroll-fade/scroll-fade";
import { ThemeToggle } from "@/components/application/theme/theme-toggle";
import { Select, SelectItem } from "@/components/base/select/select";
import { banks } from "@/lib/bank";
import { useStore } from "@/store/app-store";
import { navigate, routePath } from "@/lib/router";
import { cx } from "@/utils/cx";

interface NavItem {
  key: string;
  label: string;
  href: string;
  icon: typeof RiDashboardLine;
  badge?: number;
  adminOnly?: boolean;
}

export function AppShell({ route, children }: { route: string; children: ReactNode }) {
  const { projection, auth, sync, actions, activeBank } = useStore();
  const [mobileOpen, setMobileOpen] = useState(false);
  const current = routePath(route);
  const fade = useScrollFade();
  const wrongCount = projection.wrongQuestionIds.length;
  const dueCount = projection.dueCardIds.length;

  const primary: NavItem[] = [
    { key: "dashboard", label: "学习概览", href: "/", icon: RiDashboardLine },
    { key: "practice", label: "开始练习", href: "/practice", icon: RiPlayCircleLine },
    { key: "bank", label: "题库浏览", href: "/bank", icon: RiBookOpenLine },
    { key: "cards", label: "知识卡", href: "/cards", icon: RiLightbulbFlashLine, badge: dueCount },
  ];
  const review: NavItem[] = [
    { key: "mistakes", label: "错题本", href: "/mistakes", icon: RiErrorWarningLine, badge: wrongCount },
    { key: "favorites", label: "收藏夹", href: "/favorites", icon: RiStarLine, badge: projection.favoriteQuestionIds.length },
    { key: "progress", label: "学习进度", href: "/progress", icon: RiBarChartBoxLine },
  ];
  const system: NavItem[] = [
    { key: "settings", label: "设置与数据", href: "/settings", icon: RiSettings4Line },
    ...(auth.user?.role === "admin"
      ? [{ key: "admin", label: "管理后台", href: "/admin", icon: RiShieldCheckLine, adminOnly: true }]
      : []),
  ];

  const groups = [
    { title: "学习", items: primary },
    { title: "复习", items: review },
    { title: "系统", items: system },
  ];

  const bankSwitcher = (
    <div className="mt-3">
      <Select
        aria-label="选择题库"
        selectedKey={activeBank.bankId}
        onSelectionChange={(key) => actions.selectBank(String(key))}
        size="sm"
        variant="compact"
      >
        {banks.map((bank) => (
          <SelectItem id={bank.bankId} key={bank.bankId}>
            {bank.shortTitle} · {bank.collected} 题
          </SelectItem>
        ))}
      </Select>
    </div>
  );

  const nav = (
    <nav className="flex flex-col gap-5" aria-label="主导航">
      {groups.map((group) => (
        <div key={group.title}>
          <p className="mb-1.5 px-2 text-caption-2-semibold uppercase tracking-[0.12em] text-text-tertiary">
            {group.title}
          </p>
          <div className="flex flex-col gap-0.5">
            {group.items.map((item) => {
              const active = current === item.href || (item.href !== "/" && current.startsWith(item.href));
              const Icon = item.icon;
              return (
                <a
                  key={item.key}
                  href={`#${item.href}`}
                  onClick={() => setMobileOpen(false)}
                  aria-current={active ? "page" : undefined}
                  className={cx(
                    "group flex items-center justify-between gap-2 rounded-xl px-2.5 py-2 transition-colors",
                    active
                      ? "bg-accent-600 text-white shadow-xs"
                      : "text-text-secondary hover:bg-background-secondary-hover hover:text-text-primary",
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    <Icon className={cx("size-5 shrink-0", active ? "text-white" : "text-foreground-icon-secondary")} aria-hidden />
                    <span className="truncate text-body-2-medium">{item.label}</span>
                  </span>
                  {item.badge ? (
                    <Counter color={active ? "primary" : "neutral"} className={active ? "bg-white/20 text-white" : undefined}>
                      {item.badge > 99 ? "99+" : item.badge}
                    </Counter>
                  ) : null}
                </a>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );

  const footer = (
    <div className="mt-3 flex flex-col gap-2 border-t border-separator-border pt-3">
      <div className="flex items-center gap-2 rounded-2xl bg-background-primary-default p-2.5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent-100 text-body-2-semibold text-accent-700">
          {(auth.user?.username ?? "本").slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-body-2-semibold text-text-primary">
            {auth.user?.username ?? "本机学习模式"}
          </p>
          <p className="flex items-center gap-1 truncate text-caption-2-medium text-text-tertiary">
            {auth.user ? (
              <>
                <RiCloudLine className="size-3" aria-hidden />
                {sync.status === "syncing"
                  ? "同步中…"
                  : sync.status === "error"
                    ? "云端暂不可用"
                    : `已同步${sync.pending ? ` · ${sync.pending} 条` : ""}`}
              </>
            ) : (
              <>
                <RiCloudOffLine className="size-3" aria-hidden />
                无需登录 · 匿名学习统计
              </>
            )}
          </p>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2">
        <ThemeToggle appearance="segmented" size="small" />
        {auth.user ? (
          <Button
            size="xs"
            variant="ghost"
            onClick={() => {
              void actions.logout();
              setMobileOpen(false);
              navigate("/");
            }}
          >
            退出
          </Button>
        ) : (
          <Button
            size="xs"
            variant="secondary"
            leadingIcon={RiLoginBoxLine}
            onClick={() => {
              setMobileOpen(false);
              navigate("/auth");
            }}
          >
            登录同步
          </Button>
        )}
      </div>
      <p className="px-1 text-caption-2-regular leading-relaxed text-text-tertiary">
        本地优先 · 当前题库 {activeBank.collected} 题
      </p>
    </div>
  );

  return (
    <div className="min-h-dvh">
      <aside className="fixed inset-y-0 start-0 z-30 hidden w-[284px] p-4 lg:block">
        <div className="flex h-full flex-col rounded-3xl border border-border-button-white bg-background-secondary-default p-3 shadow-sidebar">
          <Brand />
          {bankSwitcher}
          <div className="relative mt-4 flex min-h-0 flex-1 flex-col">
            <div onScroll={fade.onScroll} className="min-h-0 flex-1 overflow-y-auto pe-1">
              {nav}
            </div>
            <ScrollFade progress={fade.progress} surfaceClassName="from-background-secondary-default" />
          </div>
          {footer}
        </div>
      </aside>

      <div className="fixed inset-x-0 top-0 z-30 flex h-14 items-center justify-between border-b border-separator-border bg-background-full/85 px-4 backdrop-blur-md lg:hidden">
        <button
          type="button"
          aria-label="打开导航"
          onClick={() => setMobileOpen(true)}
          className="flex size-9 cursor-pointer items-center justify-center rounded-full bg-background-secondary-default text-foreground-icon-primary"
        >
          <RiMenuLine className="size-5" aria-hidden />
        </button>
        <a href="#/" className="flex items-center gap-2">
          <BrandMark />
          <span className="text-title-3-semibold text-text-primary">砺知</span>
        </a>
        <ThemeToggle appearance="segmented" size="small" />
      </div>

      <Drawer isOpen={mobileOpen} onOpenChange={setMobileOpen} placement="start" size="sm" aria-label="站点导航">
        <DrawerHeader title="砺知 StudyDeck" description="刷题 · 复习 · 记录" />
        <DrawerBody className="p-4">
          {bankSwitcher}
          {nav}
          {footer}
        </DrawerBody>
      </Drawer>

      <div className="lg:ps-[284px]">
        <div className="mx-auto w-full max-w-[1280px] px-4 pb-12 pt-20 sm:px-6 lg:px-10 lg:pt-8">{children}</div>
      </div>
    </div>
  );
}

function Brand() {
  return (
    <a href="#/" className="flex items-center gap-2.5 px-1 py-1">
      <BrandMark />
      <span className="min-w-0">
        <span className="block text-title-3-semibold leading-tight text-text-primary">砺知</span>
        <span className="block text-caption-2-medium uppercase tracking-[0.16em] text-text-tertiary">
          StudyDeck
        </span>
      </span>
    </a>
  );
}

function BrandMark() {
  return (
    <span className="relative flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-linear-to-br from-accent-500 to-accent-700 text-body-medium font-semibold text-white shadow-sm">
      <span className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.4),transparent_55%)]" />
      <span className="relative">砺</span>
    </span>
  );
}

export function MobileCloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex size-8 cursor-pointer items-center justify-center rounded-full text-foreground-icon-secondary hover:bg-background-secondary-hover"
      aria-label="关闭"
    >
      <RiCloseLine className="size-4" aria-hidden />
    </button>
  );
}
