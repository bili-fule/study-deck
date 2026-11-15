import { useState, type ReactNode } from "react";
import { RiCloudOffLine, RiRefreshLine } from "@remixicon/react";
import { Button } from "@/components/base/buttons/button";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/base/modal/modal";
import { toast } from "@/components/base/toast/toast";
import { AppShell } from "@/ui/app-shell";
import { Panel } from "@/ui/common";
import { navigate, routePath, useRoute } from "@/lib/router";
import { useStore } from "@/store/app-store";
import { DashboardPage } from "@/pages/dashboard";
import { PracticeSessionPage, PracticeSetupPage, QuestionListPage } from "@/pages/practice";
import { MockSessionPage, MockSetupPage, ResultPage } from "@/pages/mock";
import { BankPage, CardsPage } from "@/pages/library";
import { ProgressPage } from "@/pages/progress";
import { SettingsPage } from "@/pages/settings";
import { CloudPage } from "@/pages/cloud";
import { AdminPage } from "@/pages/admin";

export default function App() {
  const route = useRoute();
  const path = routePath(route);
  const { storageError, sync, auth, actions } = useStore();

  let page: ReactNode;
  switch (path) {
    case "/":
      page = <DashboardPage />;
      break;
    case "/practice":
      page = <PracticeSetupPage route={route} />;
      break;
    case "/session":
      page = <PracticeSessionPage />;
      break;
    case "/mock":
      page = <MockSetupPage />;
      break;
    case "/exam":
      page = <MockSessionPage />;
      break;
    case "/result":
      page = <ResultPage />;
      break;
    case "/mistakes":
      page = <QuestionListPage kind="mistakes" />;
      break;
    case "/favorites":
      page = <QuestionListPage kind="favorites" />;
      break;
    case "/bank":
      page = <BankPage />;
      break;
    case "/cards":
      page = <CardsPage />;
      break;
    case "/progress":
      page = <ProgressPage />;
      break;
    case "/settings":
      page = <SettingsPage />;
      break;
    case "/cloud":
    case "/auth":
      page = <CloudPage />;
      break;
    case "/admin":
      page = <AdminPage />;
      break;
    default:
      page = <NotFound />;
  }

  return (
    <AppShell route={route}>
      <div className="flex flex-col gap-4">
        {storageError ? (
          <Panel className="border-status-rose-text/30 bg-status-rose-background px-4 py-3">
            <p className="text-body-2-semibold text-status-rose-text">本地保存需要注意</p>
            <p className="mt-1 text-caption-1-medium text-text-secondary">{storageError}</p>
          </Panel>
        ) : null}
        {auth.user && sync.status === "error" ? (
          <Panel className="flex flex-col gap-3 border-status-orange-text/30 bg-status-orange-background px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-center gap-2 text-caption-1-medium text-text-secondary">
              <RiCloudOffLine className="size-4 shrink-0 text-status-orange-text" aria-hidden />
              云端同步暂不可用：{sync.lastError ?? "网络错误"}。本机练习与备份不受影响。
            </p>
            <Button size="xs" variant="secondary" leadingIcon={RiRefreshLine} onClick={() => void actions.syncNow()}>
              重试
            </Button>
          </Panel>
        ) : null}
        {page}
      </div>
      <AdoptionModal />
    </AppShell>
  );
}

function AdoptionModal() {
  const { adoption, actions } = useStore();
  const [busy, setBusy] = useState(false);
  if (!adoption) return null;

  async function resolve(accept: boolean) {
    setBusy(true);
    try {
      await actions.resolveAdoption(accept);
      toast.success(accept ? "已导入本机匿名练习" : "已进入账号空间", {
        description: accept ? "匿名事件已合并到当前账号并开始同步。" : "匿名记录仍保留在本机访客空间。",
      });
    } catch (error) {
      toast.error("切换账号空间失败", { description: error instanceof Error ? error.message : "请稍后重试。" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal isOpen onOpenChange={() => undefined} size="sm">
      <ModalHeader
        title="导入本机匿名练习？"
        description={`检测到 ${adoption.guestEventCount} 条匿名学习事件。导入后它们会归入 ${adoption.user.username}，并随账号同步。`}
      />
      <ModalBody>
        <p className="text-body-2-regular text-text-secondary">
          不导入也不会删除匿名数据：它会留在本机访客空间，下次登录时仍可选择。账号之间不会共享学习记录。
        </p>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" disabled={busy} onClick={() => void resolve(false)}>
          暂不导入
        </Button>
        <Button disabled={busy} onClick={() => void resolve(true)}>
          {busy ? "处理中…" : "导入并同步"}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

function NotFound() {
  return (
    <Panel className="p-10 text-center">
      <p className="text-caption-1-semibold uppercase tracking-[0.14em] text-accent-600">404</p>
      <h1 className="mt-2 text-title-2-semibold text-text-primary">页面不存在</h1>
      <p className="mt-1 text-body-2-regular text-text-secondary">链接可能已过期，回到学习概览继续。</p>
      <Button className="mt-5" onClick={() => navigate("/")}>
        返回概览
      </Button>
    </Panel>
  );
}
