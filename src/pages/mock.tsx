import { useEffect, useMemo, useRef, useState } from "react";
import {
  RiArrowLeftLine,
  RiArrowRightLine,
  RiCheckboxCircleLine,
  RiErrorWarningLine,
  RiFlagLine,
  RiFlagFill,
  RiPlayCircleLine,
  RiRefreshLine,
  RiTimerLine,
} from "@remixicon/react";
import { Button } from "@/components/base/buttons/button";
import { Checkbox } from "@/components/base/checkbox/checkbox";
import { Radio, RadioGroup } from "@/components/base/radio/radio";
import { Input } from "@/components/base/input/input";
import { Chip } from "@/components/base/badges/chip";
import { Tabs, TabList, Tab, TabPanel } from "@/components/base/tabs/tabs";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/base/modal/modal";
import { toast } from "@/components/base/toast/toast";
import { useStore } from "@/store/app-store";
import { getBank, getQuestion } from "@/lib/bank";
import { navigate } from "@/lib/router";
import { formatClock, formatDuration } from "@/lib/scoring";
import { summarizeSession } from "@/lib/session";
import { EmptyState, Panel, PageHeader, SectionHeading } from "@/ui/common";
import { cx } from "@/utils/cx";

export function MockSetupPage() {
  const { state, session, actions, activeBank } = useStore();
  const [count, setCount] = useState(String(Math.min(state.settings.defaultMockCount, activeBank.collected)));
  const [minutes, setMinutes] = useState(String(state.settings.defaultMockMinutes));
  const [seed, setSeed] = useState("");
  const total = activeBank.collected;
  const parsedCount = Math.max(1, Math.min(total, Number(count) || 1));
  const parsedMinutes = Math.max(1, Math.min(300, Number(minutes) || 1));

  function start() {
    const created = actions.startSession({
      kind: "mock",
      mode: "mock",
      bankId: activeBank.bankId,
      count: parsedCount,
      durationMinutes: parsedMinutes,
      seed,
      title: "模拟考试",
    });
    if (!created) {
      toast.error("无法创建模拟考试", { description: "题库为空。" });
      return;
    }
    navigate("/exam");
  }

  return (
    <div className="animate-rise flex flex-col gap-6">
      <PageHeader
        eyebrow="Mock exam"
        title="模拟考试"
        description="配额与时间可自定义。交卷前不显示对错；截止时间会写入本机，刷新页面也会继续计时。"
        actions={
          session?.status === "active" ? (
            <Button variant="secondary" leadingIcon={RiPlayCircleLine} onClick={() => navigate(session.kind === "mock" ? "/exam" : "/session")}>
              继续进行中的{session.kind === "mock" ? "考试" : "练习"}
            </Button>
          ) : null
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(300px,0.9fr)]">
        <Panel className="p-5 sm:p-6">
          <SectionHeading title="考试参数" description={`题库共 ${total} 题，默认 50 题 / 30 分钟。`} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="题目数量"
              type="number"
              value={count}
              onChange={(value) => setCount(value)}
              hint={`1 – ${total}`}
            />
            <Input
              label="考试时长（分钟）"
              type="number"
              value={minutes}
              onChange={(value) => setMinutes(value)}
              hint="1 – 300 分钟"
            />
          </div>
          <div className="mt-4">
            <Input
              label="随机种子（可选）"
              value={seed}
              onChange={(value) => setSeed(value)}
              placeholder="留空自动生成"
              hint="可复现同一套试卷顺序，不是安全令牌。"
            />
          </div>
          <div className="mt-5 rounded-2xl bg-background-secondary-default p-4">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-caption-1-medium text-text-tertiary">本次考试</p>
                <p className="mt-1 text-title-2-semibold text-text-primary">
                  {parsedCount} 题 · {parsedMinutes} 分钟
                </p>
              </div>
              <Chip color="orange" variant="caption">
                统一交卷后批改
              </Chip>
            </div>
          </div>
          <Button className="mt-5" size="medium" leadingIcon={RiPlayCircleLine} onClick={start}>
            开始模拟考试
          </Button>
        </Panel>

        <Panel className="p-5 sm:p-6">
          <SectionHeading title="考试规则" description="与本地练习共享同一套题库与稳定选项 ID。" />
          <ol className="flex list-decimal flex-col gap-2.5 ps-5 text-body-2-regular text-text-secondary">
            <li>作答期间不显示正确答案，也不写入练习正误统计。</li>
            <li>截止时间保存在本机；刷新或重新打开会继续倒计时，到期自动交卷。</li>
            <li>交卷后只针对已作答题目写入考试历史与正误事件；未作答题目不会虚增分母。</li>
            <li>云端只接收实际作答记录与整场考试成绩，本地模式完全可用。</li>
          </ol>
          <div className="mt-5 rounded-2xl border border-border-button-default p-4">
            <p className="flex items-center gap-2 text-body-2-semibold text-text-primary">
              <RiTimerLine className="size-4 text-accent-600" aria-hidden />
              当前本机默认
            </p>
            <p className="mt-1 text-caption-1-medium text-text-tertiary">
              {state.settings.defaultMockCount} 题 / {state.settings.defaultMockMinutes} 分钟，可在设置中修改。
            </p>
          </div>
        </Panel>
      </div>
    </div>
  );
}

export function MockSessionPage() {
  const { session, actions } = useStore();
  const [now, setNow] = useState(() => Date.now());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const submitting = useRef(false);

  useEffect(() => {
    if (!session || session.kind !== "mock") return;
    if (session.status === "submitted") {
      navigate("/result");
    }
  }, [session]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const summary = useMemo(() => (session ? summarizeSession(session) : null), [session]);

  useEffect(() => {
    if (!session || session.kind !== "mock" || session.status !== "active" || !session.deadlineAt) return;
    if (now < session.deadlineAt || submitting.current) return;
    submitting.current = true;
    actions.submitMock();
    toast.info("考试时间到，已自动交卷", { description: "已按当前作答内容批改。" });
    navigate("/result");
  }, [actions, now, session]);

  if (!session || session.kind !== "mock" || !summary) {
    return (
      <Panel>
        <EmptyState icon={RiTimerLine} title="没有进行中的模拟考试" description="先配置题量与时间，再开始。" actionLabel="去配置" onAction={() => navigate("/mock")} />
      </Panel>
    );
  }

  if (session.status === "submitted") {
    return (
      <Panel>
        <EmptyState icon={RiCheckboxCircleLine} title="本场考试已交卷" description="查看结果与逐题复盘。" actionLabel="查看结果" onAction={() => navigate("/result")} />
      </Panel>
    );
  }

  const question = getQuestion(session.questionIds[session.currentIndex]);
  if (!question) {
    return <Panel><EmptyState icon={RiErrorWarningLine} title="题目不存在" description="请重新开始一场考试。" actionLabel="返回" onAction={() => navigate("/mock")} /></Panel>;
  }
  const selected = session.answers[question.questionId] ?? [];
  const remaining = session.deadlineAt ? Math.max(0, session.deadlineAt - now) : 0;
  const urgent = remaining <= 5 * 60_000;

  function selectOption(optionId: string) {
    if (!question) return;
    if (question.type === "multiple") {
      const next = selected.includes(optionId) ? selected.filter((id) => id !== optionId) : [...selected, optionId];
      actions.setSessionAnswer(question.questionId, next);
    } else {
      actions.setSessionAnswer(question.questionId, [optionId]);
    }
  }

  function submit() {
    if (submitting.current || !summary) return;
    submitting.current = true;
    actions.submitMock();
    setConfirmOpen(false);
    toast.success("已交卷", { description: `作答 ${summary.answered} 题，未作答 ${summary.unanswered} 题。` });
    navigate("/result");
  }

  return (
    <div className="animate-rise flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Chip color="orange" variant="caption">
            模拟考试
          </Chip>
          <span className="text-caption-1-medium text-text-tertiary">
            {session.currentIndex + 1} / {session.questionIds.length}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div
            className={cx(
              "flex items-center gap-2 rounded-full border px-3 py-1.5 text-body-2-semibold tabular",
              urgent
                ? "border-status-rose-text/30 bg-status-rose-background text-status-rose-text"
                : "border-border-button-default bg-background-primary-default text-text-primary",
            )}
            aria-live="polite"
          >
            <RiTimerLine className="size-4" aria-hidden />
            {formatClock(remaining)}
          </div>
          <Button size="small" variant="secondary" leadingIcon={RiRefreshLine} onClick={() => setConfirmOpen(true)}>
            交卷
          </Button>
        </div>
      </div>

      <div className="h-1.5 overflow-hidden rounded-full bg-background-tertiary-default">
        <div className="h-full rounded-full bg-accent-600" style={{ width: `${((session.currentIndex + 1) / session.questionIds.length) * 100}%` }} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
        <Panel className="p-5 sm:p-7">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Chip color="neutral" variant="caption">
              {question.type === "judgment" ? "判断题" : question.type === "multiple" ? "多选题" : "单选题"}
            </Chip>
            <span className="text-caption-1-medium text-text-tertiary">答案在交卷前不会显示</span>
          </div>
          <h1 className="text-title-2-semibold leading-relaxed text-text-primary sm:text-title-1-semibold">{question.stem}</h1>
          <div className="mt-6">
            {question.type === "multiple" ? (
              <div className="flex flex-col gap-2.5">
                {question.options.map((option) => (
                  <div
                    key={option.id}
                    className={cx(
                      "rounded-2xl border p-4",
                      selected.includes(option.id)
                        ? "border-accent-400 bg-accent-50"
                        : "border-border-button-default bg-background-primary-default",
                    )}
                  >
                    <Checkbox isSelected={selected.includes(option.id)} onChange={() => selectOption(option.id)}>
                      <span className="flex items-start gap-3">
                        <LetterBadge label={option.label} selected={selected.includes(option.id)} />
                        <span className="pt-0.5 text-body-regular text-text-primary">{option.text}</span>
                      </span>
                    </Checkbox>
                  </div>
                ))}
              </div>
            ) : (
              <RadioGroup value={selected[0] ?? ""} onChange={selectOption} aria-label="选择答案" className="flex flex-col gap-2.5">
                {question.options.map((option) => (
                  <Radio
                    key={option.id}
                    value={option.id}
                    className={cx(
                      "w-full rounded-2xl border p-4",
                      selected.includes(option.id)
                        ? "border-accent-400 bg-accent-50"
                        : "border-border-button-default bg-background-primary-default",
                    )}
                  >
                    <span className="flex items-start gap-3">
                      <LetterBadge label={option.label} selected={selected.includes(option.id)} />
                      <span className="pt-0.5 text-body-regular text-text-primary">{option.text}</span>
                    </span>
                  </Radio>
                ))}
              </RadioGroup>
            )}
          </div>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <Button size="medium" variant="secondary" leadingIcon={RiArrowLeftLine} isDisabled={session.currentIndex === 0} onClick={() => actions.moveQuestion(session.currentIndex - 1)}>
              上一题
            </Button>
            <div className="flex gap-2">
              <Button size="medium" variant="secondary" onClick={() => actions.toggleFlag(question.questionId)} leadingIcon={session.flagged.includes(question.questionId) ? RiFlagFill : RiFlagLine}>
                {session.flagged.includes(question.questionId) ? "取消标记" : "标记"}
              </Button>
              <Button size="medium" trailingIcon={RiArrowRightLine} isDisabled={session.currentIndex >= session.questionIds.length - 1} onClick={() => actions.moveQuestion(session.currentIndex + 1)}>
                下一题
              </Button>
            </div>
          </div>
        </Panel>

        <Panel className="h-fit p-4">
          <p className="mb-3 text-caption-1-semibold uppercase tracking-[0.1em] text-text-tertiary">答题卡</p>
          <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-8 xl:grid-cols-6">
            {session.questionIds.map((id, index) => {
              const answered = (session.answers[id] ?? []).length > 0;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => actions.moveQuestion(index)}
                  className={cx(
                    "relative flex aspect-square cursor-pointer items-center justify-center rounded-lg text-caption-2-semibold tabular",
                    index === session.currentIndex
                      ? "bg-accent-600 text-white"
                      : answered
                        ? "bg-accent-100 text-accent-700"
                        : "bg-background-secondary-default text-text-secondary hover:bg-background-tertiary-default",
                  )}
                  aria-label={`第 ${index + 1} 题${answered ? "，已作答" : "，未作答"}`}
                >
                  {index + 1}
                  {session.flagged.includes(id) ? <span className="absolute end-0.5 top-0.5 size-1.5 rounded-full bg-orange-500" /> : null}
                </button>
              );
            })}
          </div>
          <div className="mt-4 border-t border-separator-border pt-3 text-caption-1-medium text-text-tertiary">
            已答 {summary.answered} · 未答 {summary.unanswered}
          </div>
          <Button className="mt-3 w-full" size="small" onClick={() => setConfirmOpen(true)}>
            交卷并查看结果
          </Button>
        </Panel>
      </div>

      <Modal isOpen={confirmOpen} onOpenChange={setConfirmOpen} size="sm">
        <ModalHeader title="确认交卷？" description="交卷后不能再修改答案；未作答题目不会生成答题记录。" />
        <ModalBody>
          <dl className="grid grid-cols-2 gap-3 py-2">
            <div className="rounded-xl bg-background-secondary-default p-3">
              <dt className="text-caption-1-medium text-text-tertiary">已作答</dt>
              <dd className="mt-1 text-title-3-semibold text-text-primary tabular">{summary.answered}</dd>
            </div>
            <div className="rounded-xl bg-background-secondary-default p-3">
              <dt className="text-caption-1-medium text-text-tertiary">未作答</dt>
              <dd className="mt-1 text-title-3-semibold text-text-primary tabular">{summary.unanswered}</dd>
            </div>
          </dl>
          <p className="text-caption-1-medium text-text-tertiary">剩余时间 {formatClock(remaining)}，交卷后立即批改。</p>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setConfirmOpen(false)}>
            继续作答
          </Button>
          <Button onClick={submit}>确认交卷</Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}

export function ResultPage() {
  const { session, actions } = useStore();
  const [filter, setFilter] = useState("all");
  if (!session || session.kind !== "mock" || session.status !== "submitted") {
    return (
      <Panel>
        <EmptyState icon={RiTimerLine} title="还没有可复盘的考试" description="完成一场模拟考试后，这里会显示分数与逐题解析。" actionLabel="开始模拟" onAction={() => navigate("/mock")} />
      </Panel>
    );
  }
  const summary = summarizeSession(session);
  const bank = getBank(session.bankId);
  const duration = session.submittedAt ? new Date(session.submittedAt).getTime() - new Date(session.startedAt).getTime() : 0;
  const filtered = summary.perQuestion.filter((entry) => {
    if (filter === "wrong") return entry.answered && !entry.correct;
    if (filter === "unanswered") return !entry.answered;
    return true;
  });

  function drillWrong() {
    const created = actions.startSession({
      kind: "practice",
      mode: "mistakes",
      bankId: bank.bankId,
      count: Math.max(1, summary.wrong),
      title: "错题重练",
    });
    if (!created) {
      toast.info("当前没有错题可练");
      return;
    }
    navigate("/session");
  }

  return (
    <div className="animate-rise flex flex-col gap-6">
      <PageHeader
        eyebrow="Result"
        title="考试复盘"
        description={`${bank.title} · ${formatDuration(duration)} · 已按官方答案完成本地批改。`}
        actions={
          <>
            <Button variant="secondary" onClick={() => navigate("/mock")}>
              再考一场
            </Button>
            <Button leadingIcon={RiRefreshLine} onClick={drillWrong} isDisabled={summary.wrong === 0}>
              错题重练（{summary.wrong}）
            </Button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Panel className="p-5">
          <p className="text-caption-1-medium text-text-tertiary">正确率</p>
          <p className="mt-1 text-display-4-semibold text-text-primary tabular">{summary.accuracy}%</p>
          <p className="mt-1 text-caption-1-medium text-text-tertiary">{summary.correct} / {summary.answered} 题</p>
        </Panel>
        <Panel className="p-5">
          <p className="text-caption-1-medium text-text-tertiary">答对</p>
          <p className="mt-1 text-display-4-semibold text-status-lime-text tabular">{summary.correct}</p>
          <p className="mt-1 text-caption-1-medium text-text-tertiary">已作答题目</p>
        </Panel>
        <Panel className="p-5">
          <p className="text-caption-1-medium text-text-tertiary">答错</p>
          <p className="mt-1 text-display-4-semibold text-status-rose-text tabular">{summary.wrong}</p>
          <p className="mt-1 text-caption-1-medium text-text-tertiary">已写入错题本</p>
        </Panel>
        <Panel className="p-5">
          <p className="text-caption-1-medium text-text-tertiary">未作答</p>
          <p className="mt-1 text-display-4-semibold text-text-primary tabular">{summary.unanswered}</p>
          <p className="mt-1 text-caption-1-medium text-text-tertiary">不生成答题事件</p>
        </Panel>
      </div>

      <Panel className="p-5 sm:p-6">
        <Tabs selectedKey={filter} onSelectionChange={(key) => setFilter(String(key))}>
          <TabList aria-label="复盘筛选">
            <Tab id="all">全部 {summary.total}</Tab>
            <Tab id="wrong">错题 {summary.wrong}</Tab>
            <Tab id="unanswered">未作答 {summary.unanswered}</Tab>
          </TabList>
          <TabPanel id={filter} className="mt-4">
            <div className="flex flex-col gap-3">
              {filtered.length === 0 ? (
                <p className="py-10 text-center text-body-2-regular text-text-tertiary">这个筛选下没有题目。</p>
              ) : (
                filtered.map((entry) => (
                  <div key={entry.question.questionId} className="rounded-2xl border border-border-button-default p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <Chip color={entry.correct ? "lime" : entry.answered ? "rose" : "neutral"} variant="caption">
                            {entry.correct ? "正确" : entry.answered ? "错误" : "未作答"}
                          </Chip>
                          <span className="truncate text-caption-1-medium text-text-tertiary">{entry.question.sourceTitle}</span>
                        </div>
                        <p className="text-body-medium text-text-primary">{entry.question.stem}</p>
                        <div className="mt-2 space-y-1 text-caption-1-medium text-text-secondary">
                          <p>你的答案：{entry.selected.length ? entry.selected.map((id) => entry.question.options.find((option) => option.id === id)?.text ?? id).join(" / ") : "未作答"}</p>
                          <p>官方答案：{entry.question.answerText.join(" / ")}</p>
                        </div>
                        {entry.question.explanation ? (
                          <p className="mt-2 whitespace-pre-line text-caption-1-medium text-text-secondary">
                            <strong>官方解析：</strong>{entry.question.explanation}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </TabPanel>
        </Tabs>
      </Panel>
    </div>
  );
}

function LetterBadge({ label, selected }: { label: string; selected: boolean }) {
  return (
    <span className={cx("flex size-7 shrink-0 items-center justify-center rounded-full text-caption-1-semibold", selected ? "bg-accent-600 text-white" : "bg-background-secondary-default text-text-secondary")}>
      {label}
    </span>
  );
}
