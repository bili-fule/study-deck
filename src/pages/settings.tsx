import { useRef, useState } from "react";
import {
  RiCloudLine,
  RiDeleteBin6Line,
  RiDownload2Line,
  RiLoginBoxLine,
  RiLogoutBoxLine,
  RiRefreshLine,
  RiUpload2Line,
  RiUserLine,
} from "@remixicon/react";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { Switch } from "@/components/base/switch/switch";
import { Radio, RadioGroup } from "@/components/base/radio/radio";
import { Chip } from "@/components/base/badges/chip";
import { Divider } from "@/components/base/divider/divider";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/base/modal/modal";
import { toast } from "@/components/base/toast/toast";
import { useStore } from "@/store/app-store";
import { navigate } from "@/lib/router";
import { formatDateTime } from "@/lib/scoring";
import { Panel, PageHeader, SectionHeading } from "@/ui/common";

export function SettingsPage() {
  const { state, auth, sync, storageError, actions, activeBank } = useStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const [restoreMode, setRestoreMode] = useState<"merge" | "replace">("merge");
  const [clearOpen, setClearOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  function downloadBackup() {
    const backup = actions.exportBackupFile();
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `studydeck-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    toast.success("备份已导出", { description: "文件只包含学习数据，不包含登录会话或同步游标。" });
  }

  async function importBackup(file: File) {
    try {
      const text = await file.text();
      const result = actions.restoreBackup(text, restoreMode);
      toast.success("备份已恢复", {
        description:
          restoreMode === "replace"
            ? `已替换为 ${result.events} 条事件，覆盖 ${result.questions} 道题。`
            : `合并后共新增 ${result.events} 条事件，覆盖 ${result.questions} 道题。`,
      });
    } catch (error) {
      toast.error("恢复失败", { description: error instanceof Error ? error.message : "文件格式不正确。" });
    }
  }

  async function syncNow() {
    setBusy(true);
    try {
      await actions.syncNow();
      toast.success("同步完成", { description: sync.pending ? `仍有 ${sync.pending} 条待上传。` : "本地与云端已对齐。" });
    } catch (error) {
      toast.error("同步失败", { description: error instanceof Error ? error.message : "云端暂不可用，本机数据不受影响。" });
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    setBusy(true);
    try {
      await actions.logout();
      toast.success("已退出登录");
    } catch (error) {
      toast.error("退出失败", {
        description: error instanceof Error ? error.message : "云端会话可能仍然有效，请重试。",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="animate-rise flex flex-col gap-6">
      <PageHeader
        eyebrow="Settings"
        title="设置与数据"
        description="本地优先：不登录也能完整练习、模考、复习与备份。登录只用于可选的跨设备同步。"
      />

      {storageError ? (
        <Panel className="border-status-rose-text/30 bg-status-rose-background p-4">
          <p className="text-body-2-semibold text-status-rose-text">本地存储需要注意</p>
          <p className="mt-1 text-caption-1-medium text-text-secondary">{storageError}</p>
        </Panel>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel className="p-5 sm:p-6">
          <SectionHeading
            title="账号与同步"
            description={auth.user ? "当前账号已连接云端，可选择手动同步。" : "未登录；学习进度保存在本机，学习行为以匿名标识汇总。"}
            action={auth.user ? <Chip color="lime" variant="caption">已登录</Chip> : <Chip color="neutral" variant="caption">本机模式</Chip>}
          />
          {auth.user ? (
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-3 rounded-2xl bg-background-secondary-default p-4">
                <span className="flex size-10 items-center justify-center rounded-full bg-accent-100 text-body-semibold text-accent-700">
                  {auth.user.username.slice(0, 1).toUpperCase()}
                </span>
                <div className="min-w-0">
                  <p className="text-body-2-semibold text-text-primary">{auth.user.username}</p>
                  <p className="text-caption-1-medium text-text-tertiary">
                    {auth.user.role === "admin" ? "管理员" : "普通用户"} · 注册于 {formatDateTime(auth.user.createdAt)}
                  </p>
                </div>
                <span className="ms-auto text-caption-1-medium text-text-tertiary">
                  {sync.status === "syncing" ? "同步中…" : sync.status === "error" ? "同步失败" : "已连接"}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="small" leadingIcon={RiRefreshLine} isDisabled={busy || sync.status === "syncing"} onClick={() => void syncNow()}>
                  立即同步
                </Button>
                <Button size="small" variant="secondary" leadingIcon={RiLogoutBoxLine} isDisabled={busy} onClick={() => void logout()}>
                  退出登录
                </Button>
              </div>
              {sync.lastError ? <p className="text-caption-1-medium text-status-rose-text">{sync.lastError}</p> : null}
              <p className="text-caption-1-medium text-text-tertiary">
                待上传 {sync.pending} 条事件{sync.lastPulledAt ? ` · 最近拉取 ${formatDateTime(sync.lastPulledAt)}` : ""}。云端失败不会阻塞本地练习。
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex items-start gap-3 rounded-2xl bg-background-secondary-default p-4">
                <RiUserLine className="mt-0.5 size-5 shrink-0 text-foreground-icon-secondary" aria-hidden />
                <div>
                  <p className="text-body-2-semibold text-text-primary">邀请制账号</p>
                  <p className="mt-1 text-caption-1-medium text-text-secondary">
                    注册需要邀请码。你可以继续不登录使用；登录后，本机匿名练习会先询问是否导入当前账号。
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="small" leadingIcon={RiLoginBoxLine} onClick={() => navigate("/cloud")}>
                  登录 / 注册
                </Button>
                <Button size="small" variant="secondary" onClick={() => navigate("/progress")}>
                  查看本机进度
                </Button>
              </div>
            </div>
          )}
          <Divider className="my-5" />
          <div className="flex items-start gap-2 text-caption-1-medium text-text-tertiary">
            <RiCloudLine className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p>前端 st.xmfu.cn 通过授权跨域访问 stapi.xmfu.cn；会话 Cookie 仅属于 API 域名，脚本无法读取。</p>
          </div>
        </Panel>

        <Panel className="flex flex-col p-5 sm:p-6">
          <SectionHeading title="学习偏好" description="仅影响本机的练习默认值。" />
          <div className="flex flex-col gap-4">
            <Input
              label="每日目标（题）"
              type="number"
              value={String(state.settings.dailyGoal)}
              onChange={(value) => actions.updateSettings({ dailyGoal: Math.max(1, Math.min(300, Number(value) || 1)) })}
            />
            <Input
              label="模拟默认题量"
              type="number"
              value={String(state.settings.defaultMockCount)}
              onChange={(value) =>
                actions.updateSettings({
                  defaultMockCount: Math.max(1, Math.min(activeBank.collected, Number(value) || 1)),
                })
              }
              hint={`题库当前 ${activeBank.collected} 题`}
            />
            <Input
              label="模拟默认时长（分钟）"
              type="number"
              value={String(state.settings.defaultMockMinutes)}
              onChange={(value) => actions.updateSettings({ defaultMockMinutes: Math.max(1, Math.min(300, Number(value) || 1)) })}
            />
            <Switch
              isSelected={state.settings.showSourceInPractice}
              onChange={(value) => actions.updateSettings({ showSourceInPractice: value })}
            >
              练习答题后显示来源文件
            </Switch>
            <Switch
              isSelected={state.settings.autoNextOnCorrect}
              onChange={(value) => actions.updateSettings({ autoNextOnCorrect: value })}
            >
              答对后自动跳下一题
            </Switch>
            <Switch
              isSelected={state.settings.studyMode}
              onChange={(value) => actions.updateSettings({ studyMode: value })}
            >
              背题模式（直接显示答案，不计入统计）
            </Switch>
          </div>
        </Panel>
      </div>

      <Panel className="p-5 sm:p-6">
        <SectionHeading
          title="备份与恢复"
          description="导出 JSON 包含题库事件、当前会话、设置与本机显示名；不包含账号、Cookie、同步游标或 ack 元数据。"
          action={<Button size="small" variant="secondary" leadingIcon={RiDownload2Line} onClick={downloadBackup}>导出备份</Button>}
        />
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="rounded-2xl border border-border-button-default p-4">
            <p className="text-body-2-semibold text-text-primary">导入备份</p>
            <p className="mt-1 text-caption-1-medium text-text-secondary">
              导入前会逐条校验事件结构与 payload；非法文件不会覆盖现有数据。
            </p>
            <RadioGroup
              aria-label="恢复方式"
              value={restoreMode}
              onChange={(value) => setRestoreMode(value as "merge" | "replace")}
              className="mt-3 flex gap-4"
            >
              <Radio value="merge">合并事件</Radio>
              <Radio value="replace">替换本机数据</Radio>
            </RadioGroup>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void importBackup(file);
                event.target.value = "";
              }}
            />
            <Button className="mt-3" size="small" variant="secondary" leadingIcon={RiUpload2Line} onClick={() => fileRef.current?.click()}>
              选择 JSON 文件
            </Button>
          </div>

          <div className="rounded-2xl border border-border-button-default p-4">
            <p className="text-body-2-semibold text-text-primary">清除本机数据</p>
            <p className="mt-1 text-caption-1-medium text-text-secondary">
              只清除当前本机（{auth.user ? auth.user.username : "匿名"}）范围内的事件与会话；不会删除云端记录，也不会退出账号。
            </p>
            <Button className="mt-3" size="small" variant="danger" leadingIcon={RiDeleteBin6Line} onClick={() => setClearOpen(true)}>
              清除本机学习数据
            </Button>
          </div>
        </div>
      </Panel>

      <Panel className="p-5 sm:p-6">
        <SectionHeading title="隐私与部署" description="数据最小化是默认设计。" />
        <ul className="flex list-disc flex-col gap-2 ps-5 text-body-2-regular text-text-secondary">
          <li>未登录时也记录答题、收藏、模考和知识卡行为；服务端仅保存随机访客标识的哈希、事件类型、题目及判分，不保存完整答案、姓名、设备指纹或页面内容。</li>
          <li>管理员只能查看账号及匿名行为的聚合统计；没有逐用户或逐访客的作答详情视图。匿名统计不等于账号备份，登录导入仍需确认。</li>
          <li>退出登录失败时会明确提示，不会伪装成已退出；HttpOnly Cookie 由服务端清除。</li>
          <li>前端部署在 EdgeOne，API 部署在 Cloudflare Worker；API 不可用时仍可练习、模考与备份，待上传行为保留在本机。</li>
        </ul>
      </Panel>

      <Modal isOpen={clearOpen} onOpenChange={setClearOpen} size="sm">
        <ModalHeader title="清除本机数据？" description="当前范围内的答题事件、收藏、卡片进度与进行中的会话都会被清除。" />
        <ModalBody>
          <p className="text-body-2-regular text-text-secondary">此操作不可撤销。建议先导出备份。云端记录不会删除。</p>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setClearOpen(false)}>取消</Button>
          <Button
            variant="danger"
            onClick={() => {
              actions.clearLocalData();
              setClearOpen(false);
              toast.success("本机学习数据已清除");
            }}
          >
            确认清除
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}




