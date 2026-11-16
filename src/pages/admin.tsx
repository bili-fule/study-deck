import { useCallback, useEffect, useState } from "react";
import { RiRefreshLine, RiShieldCheckLine } from "@remixicon/react";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { Select, SelectItem } from "@/components/base/select/select";
import { Chip } from "@/components/base/badges/chip";
import { adminStats } from "@/lib/cloud";
import { banks, getBank } from "@/lib/bank";
import { navigate } from "@/lib/router";
import { formatDateTime } from "@/lib/scoring";
import { useStore } from "@/store/app-store";
import type { AdminStatsResponse } from "@/shared/api";
import { PageHeader, Panel, SectionHeading } from "@/ui/common";

function percent(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

function count(value: number): string {
  return value.toLocaleString("zh-CN");
}

/**
 * Aggregate-only admin dashboard. The server exposes no per-user attempt or
 * history endpoint, so this page cannot (and must not) render individual users.
 */
export function AdminPage() {
  const { auth } = useStore();
  const [bankId, setBankId] = useState(banks[0]?.bankId ?? "");
  const [chapterId, setChapterId] = useState("");
  const [minSamples, setMinSamples] = useState("20");
  const [stats, setStats] = useState<AdminStatsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedBank = getBank(bankId);

  const load = useCallback(async () => {
    if (auth.user?.role !== "admin") return;
    setLoading(true);
    setError(null);
    try {
      const response = await adminStats({
        minSamples: Math.max(1, Number(minSamples) || 20),
        bankId: bankId || undefined,
        chapterId: chapterId || undefined,
      });
      setStats(response);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "无法加载聚合统计。");
    } finally {
      setLoading(false);
    }
  }, [auth.user?.role, minSamples, bankId, chapterId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!auth.user) {
    return (
      <Panel className="mx-auto max-w-lg">
        <div className="p-8 text-center">
          <RiShieldCheckLine className="mx-auto size-10 text-text-tertiary" aria-hidden />
          <h1 className="mt-4 text-title-2-semibold text-text-primary">需要管理员账号</h1>
          <p className="mt-1 text-body-2-regular text-text-secondary">
            管理员由部署侧 CLI 初始化，注册不会产生管理员。请先登录管理员账号。
          </p>
          <Button className="mt-5" onClick={() => navigate("/cloud")}>
            去登录
          </Button>
        </div>
      </Panel>
    );
  }

  if (auth.user.role !== "admin") {
    return (
      <Panel className="mx-auto max-w-lg">
        <div className="p-8 text-center">
          <RiShieldCheckLine className="mx-auto size-10 text-text-tertiary" aria-hidden />
          <h1 className="mt-4 text-title-2-semibold text-text-primary">无管理员权限</h1>
          <p className="mt-1 text-body-2-regular text-text-secondary">
            当前账号只能查看自己的本地学习数据；服务端同样会拒绝非管理员请求。
          </p>
          <Button className="mt-5" variant="secondary" onClick={() => navigate("/")}>
            返回概览
          </Button>
        </div>
      </Panel>
    );
  }

  return (
    <div className="animate-rise flex flex-col gap-6">
      <PageHeader
        eyebrow="Admin"
        title="聚合统计"
        description="分别展示账号学习与未登录行为的聚合统计，没有逐用户或逐访客的历史详情。"
        actions={
          <Button
            leadingIcon={RiRefreshLine}
            isDisabled={loading}
            onClick={() => void load()}
          >
            {loading ? "加载中…" : "刷新"}
          </Button>
        }
      />

      <Panel className="flex flex-col gap-3 p-4 lg:flex-row lg:items-end">
        <div className="w-full max-w-40">
          <Input
            label="最小样本量"
            type="number"
            value={minSamples}
            onChange={(value) => setMinSamples(value)}
            hint="仅影响易错题排行"
          />
        </div>
        <div className="w-full max-w-72">
          <Select
            label="题库"
            selectedKey={bankId || "all"}
            onSelectionChange={(key) => {
              const next = String(key);
              setBankId(next === "all" ? "" : next);
              setChapterId("");
            }}
          >
            <SelectItem id="all">全部题库</SelectItem>
            {banks.map((bank) => (
              <SelectItem key={bank.bankId} id={bank.bankId}>
                {bank.title}
              </SelectItem>
            ))}
          </Select>
        </div>
        <div className="w-full max-w-72">
          <Select
            label="章节"
            selectedKey={chapterId || "all"}
            onSelectionChange={(key) => setChapterId(String(key) === "all" ? "" : String(key))}
            isDisabled={!selectedBank}
          >
            <SelectItem id="all">全部章节</SelectItem>
            {(selectedBank?.chapters ?? []).map((chapter) => (
              <SelectItem key={chapter.chapterId} id={chapter.chapterId}>
                {chapter.title}
              </SelectItem>
            ))}
          </Select>
        </div>
        <Button
          size="small"
          variant="secondary"
          isDisabled={loading}
          onClick={() => void load()}
        >
          应用筛选
        </Button>
      </Panel>

      {error ? (
        <Panel className="border-status-rose-text/30 bg-status-rose-background p-4">
          <p className="text-body-2-semibold text-status-rose-text">无法加载聚合统计</p>
          <p className="mt-1 text-caption-1-medium text-text-secondary">{error}</p>
        </Panel>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Panel className="p-5">
          <p className="text-caption-1-medium text-text-tertiary">注册用户总数</p>
          <p className="mt-1 text-title-2-semibold text-text-primary tabular">
            {stats ? count(stats.totals.users) : "—"}
          </p>
          <p className="mt-1 text-caption-1-medium text-text-tertiary">全站账号，不受题目筛选影响</p>
        </Panel>
        <Panel className="p-5">
          <p className="text-caption-1-medium text-text-tertiary">账号答题总次数</p>
          <p className="mt-1 text-title-2-semibold text-text-primary tabular">
            {stats ? count(stats.totals.attempts) : "—"}
          </p>
          <p className="mt-1 text-caption-1-medium text-text-tertiary">仅实际提交，跳过题不计入</p>
        </Panel>
        <Panel className="p-5">
          <p className="text-caption-1-medium text-text-tertiary">账号错误总次数</p>
          <p className="mt-1 text-title-2-semibold text-text-primary tabular">
            {stats ? count(stats.totals.errors) : "—"}
          </p>
          <p className="mt-1 text-caption-1-medium text-text-tertiary">服务端按题库答案重新判定</p>
        </Panel>
        <Panel className="p-5">
          <p className="text-caption-1-medium text-text-tertiary">整体错误率</p>
          <p className="mt-1 text-title-2-semibold text-text-primary tabular">
            {stats ? percent(stats.totals.errorRate) : "—"}
          </p>
          <p className="mt-1 text-caption-1-medium text-text-tertiary">
            错误数 ÷ 实际提交次数
            {stats?.generatedAt ? ` · ${formatDateTime(stats.generatedAt)}` : ""}
          </p>
        </Panel>
      </div>

      <Panel className="p-5 sm:p-6">
        <SectionHeading title="未登录行为" description="按当前题库与章节筛选；访客标识不等于人数，不与账号答题次数相加。" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[
            ["匿名访客标识", stats ? count(stats.anonymous.visitors) : "—"],
            ["匿名行为事件", stats ? count(stats.anonymous.events) : "—"],
            ["匿名答题次数", stats ? count(stats.anonymous.attempts) : "—"],
            ["匿名答题错误率", stats ? percent(stats.anonymous.errorRate) : "—"],
          ].map(([label, value]) => (
            <div key={label} className="rounded-2xl bg-background-secondary-default p-4">
              <p className="text-caption-1-medium text-text-tertiary">{label}</p>
              <p className="mt-1 text-title-2-semibold text-text-primary tabular">{value}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-caption-1-medium text-text-tertiary">
          收藏操作 {stats ? count(stats.anonymous.byType["favorite.set"] ?? 0) : "—"} ·
          模考交卷 {stats ? count(stats.anonymous.byType["exam.completed"] ?? 0) : "—"} ·
          知识卡复习 {stats ? count(stats.anonymous.byType["card.reviewed"] ?? 0) : "—"}
        </p>
      </Panel>

      <Panel className="p-5 sm:p-6">
        <SectionHeading
          title="易错题排行"
          description={
            stats
              ? `样本 ≥ ${stats.minSamples} 的题目按错误率排序，最多 ${stats.leaderboard.length} 条；不包含用户标识。`
              : "按最小样本量过滤后展示。"
          }
          action={<Chip color="neutral" variant="caption">聚合数据</Chip>}
        />
        {stats === null ? (
          <p className="py-10 text-center text-body-2-regular text-text-tertiary">
            {loading ? "加载中…" : "暂无数据。"}
          </p>
        ) : stats.leaderboard.length === 0 ? (
          <p className="py-10 text-center text-body-2-regular text-text-tertiary">
            当前筛选下没有达到最小样本量的题目。
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse">
              <thead>
                <tr className="border-b border-separator-border text-caption-1-semibold uppercase tracking-[0.08em] text-text-tertiary">
                  <th className="py-2 pe-3 text-start">题目</th>
                  <th className="px-3 py-2 text-end">作答</th>
                  <th className="px-3 py-2 text-end">错误</th>
                  <th className="px-3 py-2 text-end">错误率</th>
                </tr>
              </thead>
              <tbody>
                {stats.leaderboard.map((row) => {
                  const question = getBank(row.bankId)?.questions.find(
                    (item) => item.questionId === row.questionId,
                  );
                  return (
                    <tr
                      key={`${row.bankId}:${row.questionId}`}
                      className="border-b border-separator-border last:border-b-0"
                    >
                      <td className="max-w-[520px] py-3 pe-3">
                        <p className="truncate text-body-2-medium text-text-primary">
                          {question?.stem ?? row.questionId}
                        </p>
                        <p className="truncate text-caption-2-medium text-text-tertiary">
                          {question?.sourceTitle ?? row.chapterId}
                        </p>
                      </td>
                      <td className="px-3 py-3 text-end text-body-2-regular text-text-secondary tabular">
                        {count(row.attempts)}
                      </td>
                      <td className="px-3 py-3 text-end text-body-2-regular text-text-secondary tabular">
                        {count(row.errors)}
                      </td>
                      <td className="px-3 py-3 text-end text-body-2-semibold text-text-primary tabular">
                        {percent(row.errorRate)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel className="p-5 sm:p-6">
        <SectionHeading
          title="章节聚合"
          description="与上方筛选一致；匿名汇总，不包含用户标识。"
        />
        {(stats?.chapters.length ?? 0) === 0 ? (
          <p className="py-6 text-body-2-regular text-text-tertiary">暂无章节聚合数据。</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {stats?.chapters.map((row) => {
              const chapter = getBank(row.bankId)?.chapters.find(
                (item) => item.chapterId === row.chapterId,
              );
              return (
                <div key={`${row.bankId}:${row.chapterId}`} className="rounded-2xl bg-background-secondary-default p-4">
                  <p className="truncate text-body-2-semibold text-text-primary">
                    {chapter?.title ?? row.chapterId}
                  </p>
                  <p className="mt-1 text-caption-1-medium text-text-tertiary">
                    {count(row.attempts)} 次作答 · {count(row.errors)} 次错误 · {percent(row.errorRate)}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      <p className="text-caption-1-medium text-text-tertiary">
        隐私说明：服务端只提供聚合查询，不提供逐用户作答、收藏、模考或卡片历史接口；本页也不会请求或展示个人数据。
      </p>
    </div>
  );
}
