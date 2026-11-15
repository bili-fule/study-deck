import { RiBarChartBoxLine, RiBookOpenLine, RiErrorWarningLine, RiFireLine, RiLightbulbFlashLine, RiTimerLine } from "@remixicon/react";
import { Chip } from "@/components/base/badges/chip";
import { LinkButton } from "@/components/base/buttons/link-button";
import { useStore } from "@/store/app-store";
import { cardsForBank } from "@/lib/bank";
import { navigate } from "@/lib/router";
import { formatDateTime, percent } from "@/lib/scoring";
import { EmptyState, Panel, PageHeader, ProgressRow, SectionHeading } from "@/ui/common";
import { cx } from "@/utils/cx";

export function ProgressPage() {
  const { projection, activeBank } = useStore();
  const bankCards = cardsForBank(activeBank.bankId);
  const maxDaily = Math.max(1, ...projection.daily.map((day) => day.attempts));
  const chapterRows = activeBank.chapters.map((chapter) => {
    const questions = activeBank.questions.filter((question) => question.chapterId === chapter.chapterId);
    const stats = questions.map((question) => projection.statsByQuestion.get(question.questionId)).filter(Boolean);
    const attempted = stats.filter((stat) => (stat?.attempts ?? 0) > 0).length;
    const attempts = stats.reduce((sum, stat) => sum + (stat?.attempts ?? 0), 0);
    const correct = stats.reduce((sum, stat) => sum + (stat?.correct ?? 0), 0);
    return { chapter, attempted, total: questions.length, attempts, accuracy: attempts ? percent(correct, attempts) : 0 };
  });
  const categoryRows = [...new Set(activeBank.chapters.map((chapter) => chapter.category))].map((category) => {
    const chapters = activeBank.chapters.filter((chapter) => chapter.category === category);
    const questions = activeBank.questions.filter((question) => chapters.some((chapter) => chapter.chapterId === question.chapterId));
    const stats = questions.map((question) => projection.statsByQuestion.get(question.questionId)).filter(Boolean);
    const attempts = stats.reduce((sum, stat) => sum + (stat?.attempts ?? 0), 0);
    const correct = stats.reduce((sum, stat) => sum + (stat?.correct ?? 0), 0);
    const attempted = stats.filter((stat) => (stat?.attempts ?? 0) > 0).length;
    return { category, attempted, total: questions.length, accuracy: attempts ? percent(correct, attempts) : 0 };
  });

  return (
    <div className="animate-rise flex flex-col gap-6">
      <PageHeader
        eyebrow="Progress"
        title="学习进度"
        description="覆盖率、正确率与错题都来自本机事件日志；登录后同步到云端，但云端不会向管理员展示你的逐题作答。"
        actions={<LinkButton href="#/settings">数据与备份</LinkButton>}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Panel className="p-5">
          <p className="flex items-center gap-2 text-caption-1-medium text-text-tertiary"><RiBookOpenLine className="size-4" /> 题库覆盖</p>
          <p className="mt-2 text-display-4-semibold text-text-primary tabular">{percent(projection.attempted, activeBank.collected)}%</p>
          <p className="mt-1 text-caption-1-medium text-text-tertiary">{projection.attempted} / {activeBank.collected} 题</p>
        </Panel>
        <Panel className="p-5">
          <p className="flex items-center gap-2 text-caption-1-medium text-text-tertiary"><RiBarChartBoxLine className="size-4" /> 累计正确率</p>
          <p className="mt-2 text-display-4-semibold text-text-primary tabular">{projection.accuracy}%</p>
          <p className="mt-1 text-caption-1-medium text-text-tertiary">{projection.correct} 次正确作答</p>
        </Panel>
        <Panel className="p-5">
          <p className="flex items-center gap-2 text-caption-1-medium text-text-tertiary"><RiFireLine className="size-4" /> 连续学习</p>
          <p className="mt-2 text-display-4-semibold text-text-primary tabular">{projection.streakDays} 天</p>
          <p className="mt-1 text-caption-1-medium text-text-tertiary">今日 {projection.todayAttempts} 题</p>
        </Panel>
        <Panel className="p-5">
          <p className="flex items-center gap-2 text-caption-1-medium text-text-tertiary"><RiErrorWarningLine className="size-4" /> 待巩固</p>
          <p className="mt-2 text-display-4-semibold text-text-primary tabular">{projection.wrongQuestionIds.length}</p>
          <p className="mt-1 text-caption-1-medium text-text-tertiary">错题 · {projection.dueCardIds.length} 张卡到期</p>
        </Panel>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <Panel className="p-5 sm:p-6">
          <SectionHeading title="最近 7 天" description="按本地日期统计实际提交的答题事件。" />
          <div className="flex h-52 items-end gap-3">
            {projection.daily.map((day) => (
              <div key={day.date} className="flex flex-1 flex-col items-center gap-2">
                <span className="text-caption-2-medium text-text-tertiary tabular">{day.attempts}</span>
                <div className="flex h-36 w-full items-end">
                  <div
                    className={cx("w-full rounded-t-xl transition-[height] duration-500", day.attempts > 0 ? "bg-accent-500" : "bg-background-tertiary-default")}
                    style={{ height: `${Math.max(6, (day.attempts / maxDaily) * 144)}px` }}
                    title={`${day.date} · ${day.attempts} 题 · ${day.correct} 正确`}
                  />
                </div>
                <span className="text-caption-1-medium text-text-tertiary">{day.label}</span>
              </div>
            ))}
          </div>
        </Panel>

        <Panel className="p-5 sm:p-6">
          <SectionHeading title="分类掌握" description="按制度分类汇总。" />
          <div className="flex flex-col gap-4">
            {categoryRows.map((row) => (
              <ProgressRow
                key={row.category}
                label={row.category}
                meta={`${row.attempted}/${row.total} · ${row.accuracy}%`}
                value={percent(row.attempted, row.total)}
                tone={row.accuracy >= 80 ? "lime" : row.accuracy > 0 ? "accent" : "rose"}
              />
            ))}
          </div>
          <div className="mt-5 flex items-center gap-2 rounded-2xl bg-background-secondary-default p-3">
            <RiLightbulbFlashLine className="size-4 shrink-0 text-accent-600" aria-hidden />
            <p className="text-caption-1-medium text-text-secondary">
              还有 {projection.dueCardIds.length} / {bankCards.length} 张知识卡待复习。
            </p>
          </div>
        </Panel>
      </div>

      <Panel className="p-5 sm:p-6">
        <SectionHeading title="章节明细" description="按题量顺序列出全部章节。" action={<LinkButton href="#/bank">去题库</LinkButton>} />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-start">
            <thead>
              <tr className="border-b border-separator-border text-caption-1-semibold uppercase tracking-[0.08em] text-text-tertiary">
                <th className="py-2 pe-3 text-start">章节</th>
                <th className="px-3 py-2 text-start">分类</th>
                <th className="px-3 py-2 text-end">覆盖</th>
                <th className="px-3 py-2 text-end">作答</th>
                <th className="px-3 py-2 text-end">正确率</th>
                <th className="ps-3 py-2 text-end">操作</th>
              </tr>
            </thead>
            <tbody>
              {chapterRows.map((row) => (
                <tr key={row.chapter.chapterId} className="border-b border-separator-border last:border-b-0">
                  <td className="max-w-[360px] py-3 pe-3 text-body-2-medium text-text-primary">{row.chapter.title}</td>
                  <td className="px-3 py-3">
                    <Chip color="neutral" variant="caption">{row.chapter.category}</Chip>
                  </td>
                  <td className="px-3 py-3 text-end text-body-2-regular text-text-secondary tabular">{row.attempted}/{row.total}</td>
                  <td className="px-3 py-3 text-end text-body-2-regular text-text-secondary tabular">{row.attempts}</td>
                  <td className="px-3 py-3 text-end text-body-2-medium text-text-primary tabular">{row.accuracy}%</td>
                  <td className="ps-3 py-3 text-end">
                    <LinkButton href={`#/practice?mode=chapter&chapter=${row.chapter.chapterId}`} size="small">练这一章</LinkButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel className="p-5 sm:p-6">
        <SectionHeading title="模拟考试记录" description="append-only 历史；删除操作不在 v1 范围内。" />
        {projection.examHistory.length === 0 ? (
          <EmptyState icon={RiTimerLine} title="还没有考试记录" description="完成一场模拟考试后，这里会保留成绩与用时。" actionLabel="去模拟" onAction={() => navigate("/mock")} />
        ) : (
          <div className="flex flex-col gap-3">
            {projection.examHistory.map((exam) => (
              <div key={exam.eventId} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border-button-default p-4">
                <div>
                  <p className="text-body-2-semibold text-text-primary">{formatDateTime(exam.at)}</p>
                  <p className="mt-0.5 text-caption-1-medium text-text-tertiary">
                    {exam.answered}/{exam.totalQuestions} 题已答 · 用时 {Math.max(1, Math.round(exam.durationMs / 60000))} 分钟
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-title-2-semibold text-text-primary tabular">{exam.accuracy}%</span>
                  <Chip color={exam.accuracy >= 80 ? "lime" : exam.accuracy >= 60 ? "yellow" : "rose"} variant="caption">
                    {exam.correct} 正确
                  </Chip>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
