import {
  RiArrowRightLine,
  RiBookOpenLine,
  RiErrorWarningLine,
  RiFireLine,
  RiLightbulbFlashLine,
  RiPlayCircleLine,
  RiShuffleLine,
  RiSparklingLine,
  RiTimerLine,
} from "@remixicon/react";
import { Button } from "@/components/base/buttons/button";
import { LinkButton } from "@/components/base/buttons/link-button";
import { StatCards } from "@/components/application/dashboard/stat-cards";
import { Chip } from "@/components/base/badges/chip";
import { useStore } from "@/store/app-store";
import { cardsForBank } from "@/lib/bank";
import { navigate } from "@/lib/router";
import { formatDateTime, percent } from "@/lib/scoring";
import { Panel, ProgressRow, SectionHeading } from "@/ui/common";
import { cx } from "@/utils/cx";

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 6) return "夜深了";
  if (hour < 11) return "早上好";
  if (hour < 14) return "中午好";
  if (hour < 18) return "下午好";
  return "晚上好";
}

export function DashboardPage() {
  const { state, projection, session, activeBank } = useStore();
  const bankCards = cardsForBank(activeBank.bankId);
  const total = activeBank.collected;
  const coverage = percent(projection.attempted, total);
  const name = state.displayName || (session ? "继续上次的节奏" : "同学");
  const maxDaily = Math.max(1, ...projection.daily.map((day) => day.attempts));
  const chapterRows = activeBank.chapters
    .map((chapter) => {
      const questions = activeBank.questions.filter((question) => question.chapterId === chapter.chapterId);
      const attempted = questions.filter((question) => (projection.statsByQuestion.get(question.questionId)?.attempts ?? 0) > 0).length;
      const correct = questions.reduce((sum, question) => sum + (projection.statsByQuestion.get(question.questionId)?.correct ?? 0), 0);
      const attempts = questions.reduce((sum, question) => sum + (projection.statsByQuestion.get(question.questionId)?.attempts ?? 0), 0);
      return { chapter, attempted, total: questions.length, accuracy: attempts ? percent(correct, attempts) : 0 };
    })
    .filter((row) => row.attempted > 0)
    .sort((a, b) => b.attempted / b.total - a.attempted / a.total)
    .slice(0, 5);

  const dueCard = bankCards.find((card) => projection.dueCardIds.includes(card.cardId));
  const recentExam = projection.examHistory[0];

  return (
    <div className="animate-rise flex flex-col gap-6">
      <section className="relative overflow-hidden rounded-3xl border border-border-button-default bg-background-primary-default p-6 shadow-card sm:p-8">
        <div className="pointer-events-none absolute -end-24 -top-24 size-72 rounded-full bg-accent-100 opacity-70 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 end-16 size-64 rounded-full bg-lime-100 opacity-50 blur-3xl" />
        <div className="relative grid gap-8 lg:grid-cols-[minmax(0,1fr)_240px] lg:items-center">
          <div>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Chip color="blue" variant="caption">
                {greeting()} · {name}
              </Chip>
              <span className="text-caption-1-medium text-text-tertiary">距考试还有充足时间，稳扎稳打。</span>
            </div>
            <h1 className="max-w-2xl text-display-4-semibold leading-tight text-text-primary sm:text-display-3-semibold">
              把校规校纪，<span className="text-accent-600">练成自己的底气。</span>
            </h1>
            <p className="mt-3 max-w-xl text-body-regular text-text-secondary">
              {activeBank.coverageNote} 章节、随机、智能加权与模拟考试，全部在本机可用。
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              {session && session.status === "active" ? (
                <Button
                  size="medium"
                  leadingIcon={RiPlayCircleLine}
                  onClick={() => navigate(session.kind === "mock" ? "/exam" : "/session")}
                >
                  继续{session.kind === "mock" ? "模拟考试" : "练习"} · {session.currentIndex + 1}/{session.questionIds.length}
                </Button>
              ) : (
                <Button size="medium" leadingIcon={RiPlayCircleLine} onClick={() => navigate("/practice")}>
                  开始一轮练习
                </Button>
              )}
              <Button size="medium" variant="secondary" leadingIcon={RiTimerLine} onClick={() => navigate("/mock")}>
                模拟考试
              </Button>
              <LinkButton href="#/progress" size="medium">
                查看学习进度
              </LinkButton>
            </div>
            {session && session.status === "active" ? (
              <p className="mt-3 text-caption-1-medium text-text-tertiary">
                {session.kind === "mock" && session.deadlineAt
                  ? `考试截止 ${new Date(session.deadlineAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}，刷新后继续计时`
                  : `本轮 ${session.questionIds.length} 题 · 种子 ${session.seed}`}
              </p>
            ) : null}
          </div>
          <div className="flex items-center justify-center">
            <div className="relative flex size-44 items-center justify-center">
              <svg viewBox="0 0 120 120" className="size-40 -rotate-90" aria-hidden>
                <circle cx="60" cy="60" r="52" fill="none" strokeWidth="9" className="stroke-background-tertiary-default" />
                <circle
                  cx="60"
                  cy="60"
                  r="52"
                  fill="none"
                  strokeWidth="9"
                  strokeLinecap="round"
                  strokeDasharray={2 * Math.PI * 52}
                  strokeDashoffset={2 * Math.PI * 52 * (1 - coverage / 100)}
                  className="stroke-accent-500 transition-[stroke-dashoffset] duration-700"
                />
              </svg>
              <div className="absolute flex flex-col items-center">
                <span className="text-display-4-semibold text-text-primary tabular">{coverage}%</span>
                <span className="mt-0.5 text-caption-1-medium text-text-tertiary">题库覆盖</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <StatCards
        variant="plain"
        stats={[
          {
            icon: RiBookOpenLine,
            label: "已练题目",
            value: `${projection.attempted}`,
            delta: `共 ${total} 题`,
            deltaColor: "lime",
          },
          {
            icon: RiSparklingLine,
            label: "累计正确率",
            value: `${projection.accuracy}%`,
            delta: `${projection.correct} 次正确`,
            deltaColor: projection.accuracy >= 80 ? "lime" : "neutral",
          },
          {
            icon: RiErrorWarningLine,
            label: "当前错题",
            value: `${projection.wrongQuestionIds.length}`,
            delta: projection.wrongQuestionIds.length ? "待巩固" : "状态很好",
            deltaColor: projection.wrongQuestionIds.length ? "rose" : "lime",
          },
          {
            icon: RiLightbulbFlashLine,
            label: "待复习卡",
            value: `${projection.dueCardIds.length}`,
            delta: `共 ${bankCards.length} 张`,
            deltaColor: "neutral",
          },
        ]}
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        <Panel className="p-5 sm:p-6">
          <SectionHeading
            title="四种练习方式"
            description="按当天状态选择，进入后随时可退出并保留进度。"
            action={<LinkButton href="#/practice">全部模式</LinkButton>}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <ModeCard
              icon={RiBookOpenLine}
              title="章节顺序"
              description="按制度文件逐章推进，适合第一次系统学。"
              meta={`${activeBank.chapters.length} 个章节`}
              onClick={() => navigate("/practice?mode=chapter")}
              tone="accent"
            />
            <ModeCard
              icon={RiShuffleLine}
              title="随机练习"
              description="每轮洗牌且不重复，适合快速自测。"
              meta="可复现种子"
              onClick={() => navigate("/practice?mode=random")}
              tone="lime"
            />
            <ModeCard
              icon={RiSparklingLine}
              title="智能加权"
              description="优先新题、错题与到期内容，同时保持章节覆盖。"
              meta="自适应"
              onClick={() => navigate("/practice?mode=adaptive")}
              tone="purple"
            />
            <ModeCard
              icon={RiTimerLine}
              title="模拟考试"
              description="默认 50 题 / 30 分钟，交卷后统一批改与复盘。"
              meta="计时"
              onClick={() => navigate("/mock")}
              tone="orange"
            />
          </div>
        </Panel>

        <Panel className="flex flex-col p-5 sm:p-6">
          <SectionHeading title="今日节奏" description={`目标 ${state.settings.dailyGoal} 题`} />
          <div className="flex items-end gap-4">
            <div>
              <p className="text-display-4-semibold text-text-primary tabular">
                {projection.todayAttempts}
                <span className="ms-1 text-body-regular text-text-tertiary">/ {state.settings.dailyGoal}</span>
              </p>
              <p className="mt-1 flex items-center gap-1 text-caption-1-medium text-text-tertiary">
                <RiFireLine className={cx("size-4", projection.streakDays > 0 ? "text-orange-500" : "text-text-tertiary")} aria-hidden />
                连续 {projection.streakDays} 天
              </p>
            </div>
            <div className="ms-auto flex h-16 items-end gap-1.5">
              {projection.daily.map((day) => (
                <div key={day.date} className="group flex w-5 flex-col items-center gap-1">
                  <div
                    className={cx(
                      "w-full rounded-full transition-colors",
                      day.attempts > 0 ? "bg-accent-500 group-hover:bg-accent-600" : "bg-background-tertiary-default",
                    )}
                    style={{ height: `${Math.max(6, (day.attempts / maxDaily) * 52)}px` }}
                    title={`${day.date} · ${day.attempts} 题`}
                  />
                  <span className="text-caption-2-medium text-text-tertiary">{day.label}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="mt-5 rounded-2xl bg-background-secondary-default p-4">
            <p className="text-body-2-semibold text-text-primary">今日建议</p>
            <p className="mt-1 text-body-2-regular text-text-secondary">
              {projection.wrongQuestionIds.length > 0
                ? `先清掉 ${Math.min(10, projection.wrongQuestionIds.length)} 道错题，再做一组随机练习。`
                : projection.attempted === 0
                  ? "从章节顺序开始，先建立完整的制度框架。"
                  : "状态不错，用智能加权巩固薄弱章节。"}
            </p>
            <Button
              className="mt-3"
              size="small"
              variant="secondary"
              onClick={() => navigate(projection.wrongQuestionIds.length ? "/practice?mode=mistakes" : "/practice?mode=adaptive")}
            >
              {projection.wrongQuestionIds.length ? "进入错题重练" : "开始智能加权"}
            </Button>
          </div>
        </Panel>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Panel className="p-5 sm:p-6">
          <SectionHeading
            title="章节掌握度"
            description="按已练题量排序，点击章节可直接进入。"
            action={<LinkButton href="#/bank">浏览题库</LinkButton>}
          />
          {chapterRows.length ? (
            <div className="flex flex-col gap-4">
              {chapterRows.map((row) => (
                <button
                  key={row.chapter.chapterId}
                  type="button"
                  className="cursor-pointer text-start"
                  onClick={() => navigate(`/practice?mode=chapter&chapter=${row.chapter.chapterId}`)}
                >
                  <ProgressRow
                    label={row.chapter.title}
                    meta={`${row.attempted}/${row.total} 题 · ${row.accuracy}% 正确`}
                    value={percent(row.attempted, row.total)}
                  />
                </button>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-border-button-default p-8 text-center">
              <p className="text-body-2-medium text-text-primary">还没有章节数据</p>
              <p className="mt-1 text-caption-1-medium text-text-tertiary">完成第一轮练习后，这里会出现掌握度。</p>
            </div>
          )}
        </Panel>

        <div className="flex flex-col gap-6">
          <Panel className="p-5 sm:p-6">
            <SectionHeading title="今日知识卡" description={`${projection.dueCardIds.length} 张到期`} />
            {dueCard ? (
              <div>
                <Chip color="purple" variant="caption">
                  {dueCard.category}
                </Chip>
                <h3 className="mt-3 text-title-3-semibold text-text-primary">{dueCard.title}</h3>
                <p className="mt-1 text-body-2-regular text-text-secondary">{dueCard.prompt}</p>
                <Button className="mt-4" size="small" leadingIcon={RiLightbulbFlashLine} onClick={() => navigate("/cards")}>
                  去复习
                </Button>
              </div>
            ) : bankCards.length === 0 ? (
              <div className="rounded-2xl bg-background-secondary-default p-4">
                <p className="text-body-2-semibold text-text-primary">本库暂无经过核验的知识卡</p>
                <p className="mt-1 text-caption-1-medium text-text-tertiary">练习、模考与进度统计仍可正常使用；不会自动生成卡片。</p>
              </div>
            ) : (
              <div className="rounded-2xl bg-background-secondary-default p-4">
                <p className="text-body-2-semibold text-text-primary">所有知识卡都已复习</p>
                <p className="mt-1 text-caption-1-medium text-text-tertiary">明天再来，或用错题驱动今天的复习。</p>
              </div>
            )}
          </Panel>

          <Panel className="p-5 sm:p-6">
            <SectionHeading title="最近模拟" description={recentExam ? formatDateTime(recentExam.at) : "还没有考试记录"} />
            {recentExam ? (
              <div className="flex items-center gap-4">
                <div className="flex size-16 flex-col items-center justify-center rounded-2xl bg-accent-50">
                  <span className="text-title-2-semibold text-accent-700 tabular">{recentExam.accuracy}%</span>
                  <span className="text-caption-2-medium text-accent-600">正确率</span>
                </div>
                <div className="min-w-0">
                  <p className="text-body-2-semibold text-text-primary">
                    {recentExam.correct}/{recentExam.answered} 题正确
                  </p>
                  <p className="mt-1 text-caption-1-medium text-text-tertiary">
                    共 {recentExam.totalQuestions} 题 · 用时 {Math.max(1, Math.round(recentExam.durationMs / 60000))} 分钟
                  </p>
                  <Button className="mt-2" size="xs" variant="ghost" trailingIcon={RiArrowRightLine} onClick={() => navigate("/result")}>
                    查看复盘
                  </Button>
                </div>
              </div>
            ) : (
              <Button size="small" variant="secondary" onClick={() => navigate("/mock")}>
                安排一次模拟
              </Button>
            )}
          </Panel>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 rounded-2xl border border-border-button-default bg-background-secondary-default px-4 py-3">
        <p className="text-caption-1-medium text-text-tertiary">
          题库来源：{activeBank.title} · 官方采集 {activeBank.collected}
          {activeBank.expectedTotal ? `/${activeBank.expectedTotal}` : " · 总数未显示"}
        </p>
        <LinkButton href="#/settings" size="small">
          备份与隐私
        </LinkButton>
      </div>
    </div>
  );
}

function ModeCard({
  icon: Icon,
  title,
  description,
  meta,
  onClick,
  tone,
}: {
  icon: typeof RiBookOpenLine;
  title: string;
  description: string;
  meta: string;
  onClick: () => void;
  tone: "accent" | "lime" | "purple" | "orange";
}) {
  const tones = {
    accent: "bg-accent-50 text-accent-700",
    lime: "bg-status-lime-background text-status-lime-text",
    purple: "bg-status-purple-background text-status-purple-text",
    orange: "bg-status-orange-background text-status-orange-text",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex cursor-pointer flex-col items-start rounded-2xl border border-border-button-default bg-background-primary-default p-4 text-start transition-[border-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-border-button-hover hover:shadow-md"
    >
      <span className={cx("mb-3 flex size-10 items-center justify-center rounded-xl", tones[tone])}>
        <Icon className="size-5" aria-hidden />
      </span>
      <span className="text-body-semibold text-text-primary">{title}</span>
      <span className="mt-1 text-body-2-regular text-text-secondary">{description}</span>
      <span className="mt-3 flex items-center gap-1 text-caption-1-semibold text-text-tertiary">
        {meta}
        <RiArrowRightLine className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
      </span>
    </button>
  );
}
