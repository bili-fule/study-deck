import { useState, type FormEvent } from "react";
import {
  RiCloudLine,
  RiErrorWarningLine,
  RiLoginBoxLine,
  RiLogoutBoxLine,
  RiRefreshLine,
  RiShieldCheckLine,
  RiUserLine,
} from "@remixicon/react";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { Chip } from "@/components/base/badges/chip";
import { Divider } from "@/components/base/divider/divider";
import { toast } from "@/components/base/toast/toast";
import { navigate } from "@/lib/router";
import { formatDateTime } from "@/lib/scoring";
import { useStore } from "@/store/app-store";
import { PageHeader, Panel, SectionHeading } from "@/ui/common";

/**
 * Optional cloud account + sync page. The app is fully usable without an
 * account; this page never fakes a session or a successful sync.
 */
export function CloudPage() {
  const { auth, sync, adoption, actions } = useStore();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setLocalError(null);
    try {
      if (mode === "login") {
        await actions.login(username.trim(), password);
        toast.success("登录成功", { description: "本机匿名练习会先询问是否导入当前账号。" });
      } else {
        await actions.register(username.trim(), password, inviteCode.trim());
        toast.success("注册成功", { description: "账号已创建；本机匿名练习会先询问是否导入。" });
      }
      setPassword("");
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "云端暂不可用，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }

  async function syncNow() {
    setBusy(true);
    try {
      await actions.syncNow();
      toast.success("已触发同步", { description: "结果以页面上的同步状态为准。" });
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    setBusy(true);
    setLocalError(null);
    try {
      await actions.logout();
      toast.success("已退出登录", { description: "本机数据保持独立，不会被其他账号读取。" });
    } catch (error) {
      setLocalError(
        error instanceof Error ? error.message : "退出失败，云端会话可能仍然有效，请重试。",
      );
    } finally {
      setBusy(false);
    }
  }

  if (auth.user) {
    return (
      <div className="animate-rise flex flex-col gap-6">
        <PageHeader
          eyebrow="Cloud"
          title="云端账号"
          description="API 使用 HttpOnly Cookie 与指定前端域名的跨域授权。登录用于跨设备同步，本地离线功能始终可用。"
          actions={
            auth.user.role === "admin" ? (
              <Button variant="secondary" leadingIcon={RiShieldCheckLine} onClick={() => navigate("/admin")}>
                聚合统计
              </Button>
            ) : undefined
          }
        />

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Panel className="p-5 sm:p-6">
            <SectionHeading
              title="账号"
              description="退出登录会尝试撤销服务端会话；失败时会明确提示，不会伪装成功。"
              action={<Chip color="lime" variant="caption">已登录</Chip>}
            />
            <div className="flex items-center gap-3 rounded-2xl bg-background-secondary-default p-4">
              <span className="flex size-10 items-center justify-center rounded-full bg-accent-100 text-body-semibold text-accent-700">
                {auth.user.username.slice(0, 1).toUpperCase()}
              </span>
              <div className="min-w-0">
                <p className="text-body-2-semibold text-text-primary">{auth.user.username}</p>
                <p className="text-caption-1-medium text-text-tertiary">
                  {auth.user.role === "admin" ? "管理员" : "普通用户"} · 注册于{" "}
                  {formatDateTime(auth.user.createdAt)}
                </p>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button size="small" leadingIcon={RiRefreshLine} isDisabled={busy} onClick={() => void syncNow()}>
                立即同步
              </Button>
              <Button
                size="small"
                variant="secondary"
                leadingIcon={RiLogoutBoxLine}
                isDisabled={busy}
                onClick={() => void logout()}
              >
                退出登录
              </Button>
            </div>
            {localError ? (
              <p role="alert" className="mt-3 rounded-xl bg-status-rose-background p-3 text-caption-1-medium text-status-rose-text">
                {localError}
              </p>
            ) : null}
          </Panel>

          <Panel className="p-5 sm:p-6">
            <SectionHeading title="同步状态" description="云端失败不会阻塞本地练习或产生重复计数。" />
            <dl className="flex flex-col">
              <div className="flex items-center justify-between gap-4 border-b border-separator-border py-2.5">
                <dt className="text-body-2-regular text-text-secondary">连接状态</dt>
                <dd className="text-body-2-semibold text-text-primary">
                  {sync.status === "syncing"
                    ? "同步中…"
                    : sync.status === "error"
                      ? "同步失败"
                      : sync.status === "idle"
                        ? "已连接"
                        : "未连接"}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4 border-b border-separator-border py-2.5">
                <dt className="text-body-2-regular text-text-secondary">待上传事件</dt>
                <dd className="text-body-2-semibold text-text-primary tabular">{sync.pending}</dd>
              </div>
              <div className="flex items-center justify-between gap-4 border-b border-separator-border py-2.5">
                <dt className="text-body-2-regular text-text-secondary">最近拉取</dt>
                <dd className="text-body-2-semibold text-text-primary">
                  {sync.lastPulledAt ? formatDateTime(sync.lastPulledAt) : "尚未同步"}
                </dd>
              </div>
            </dl>
            {sync.lastError ? (
              <p className="mt-3 flex items-start gap-2 rounded-xl bg-status-rose-background p-3 text-caption-1-medium text-status-rose-text">
                <RiErrorWarningLine className="mt-0.5 size-4 shrink-0" aria-hidden />
                {sync.lastError}
              </p>
            ) : null}
            {adoption ? (
              <p className="mt-3 rounded-xl bg-background-secondary-default p-3 text-caption-1-medium text-text-secondary">
                本机匿名练习正在等待导入选择（全局弹窗）：{adoption.guestEventCount} 条事件。
              </p>
            ) : null}
            <Divider className="my-4" />
            <div className="flex items-start gap-2 text-caption-1-medium text-text-tertiary">
              <RiCloudLine className="mt-0.5 size-4 shrink-0" aria-hidden />
              <p>
                云端只保存账号与学习事件（答题、收藏、模考、卡片进度），题库在构建时打包，不提供在线编辑。
              </p>
            </div>
          </Panel>
        </div>

        <Panel className="p-5 sm:p-6">
          <SectionHeading title="隐私与本地数据" description="数据最小化并保持本地优先。" />
          <ul className="flex list-disc flex-col gap-2 ps-5 text-body-2-regular text-text-secondary">
            <li>管理员只能看到用户总量与题目/章节聚合，没有逐用户作答历史接口或视图。</li>
            <li>退出登录后，本账号的本地范围与匿名范围相互独立；同步失败时本地事件保留。</li>
            <li>备份、清除本机数据与会话管理在设置页；导出文件不包含 Cookie 或同步游标。</li>
          </ul>
          <div className="mt-4">
            <Button size="small" variant="secondary" onClick={() => navigate("/settings")}>
              打开备份与设置
            </Button>
          </div>
        </Panel>
      </div>
    );
  }

  return (
    <div className="animate-rise mx-auto flex w-full max-w-lg flex-col gap-6">
      <PageHeader
        eyebrow="Cloud account"
        title={mode === "login" ? "登录同步" : "邀请制注册"}
        description="不登录也能完整使用。登录仅用于可选的跨设备同步；注册需要管理员发放的邀请码。"
      />

      <Panel className="p-6 sm:p-8">
        <div className="mb-5 flex rounded-full bg-background-secondary-default p-1">
          {(["login", "register"] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => {
                setMode(item);
                setLocalError(null);
                actions.dismissAuthError();
              }}
              className={`flex-1 cursor-pointer rounded-full px-4 py-1.5 text-body-2-semibold transition-colors ${
                mode === item
                  ? "bg-background-primary-default text-text-primary shadow-sm"
                  : "text-text-tertiary hover:text-text-secondary"
              }`}
            >
              {item === "login" ? "登录" : "注册"}
            </button>
          ))}
        </div>

        <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
          <Input
            label="用户名"
            value={username}
            onChange={(value) => setUsername(value)}
            autoComplete="username"
            placeholder="3–32 位字母、数字或 _ . -"
            minLength={3}
            maxLength={32}
            isRequired
          />
          <Input
            label="密码"
            type="password"
            value={password}
            onChange={(value) => setPassword(value)}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            placeholder="至少 10 位"
            minLength={10}
            maxLength={200}
            isRequired
          />
          {mode === "register" ? (
            <Input
              label="邀请码"
              value={inviteCode}
              onChange={(value) => setInviteCode(value)}
              autoComplete="off"
              placeholder="3–64 位字母、数字或连字符"
              minLength={3}
              maxLength={64}
              isRequired
            />
          ) : null}
          {localError || auth.error ? (
            <p role="alert" className="rounded-xl bg-status-rose-background p-3 text-caption-1-medium text-status-rose-text">
              {localError ?? auth.error}
            </p>
          ) : null}
          <Button
            type="submit"
            size="medium"
            leadingIcon={mode === "login" ? RiLoginBoxLine : RiUserLine}
            isDisabled={busy || !username || !password || (mode === "register" && !inviteCode)}
          >
            {busy ? "请稍候…" : mode === "login" ? "登录并同步" : "创建账号"}
          </Button>
          <p className="text-caption-1-medium text-text-tertiary">
            未启动本地 Worker 或云端不可用时，这里会显示真实错误；匿名练习、模考与备份仍然可用。
          </p>
        </form>
      </Panel>
    </div>
  );
}
