import { useEffect, useMemo, useState } from "react";
import {
  RiArrowLeftLine,
  RiArrowRightLine,
  RiBookOpenLine,
  RiCheckboxCircleLine,
  RiCloseCircleLine,
  RiErrorWarningLine,
  RiFlagLine,
  RiFlagFill,
  RiLightbulbFlashLine,
  RiPlayCircleLine,
  RiRefreshLine,
  RiShuffleLine,
  RiSparklingLine,
  RiStarFill,
  RiStarLine,
} from "@remixicon/react";
import { Button } from "@/components/base/buttons/button";
import { Checkbox } from "@/components/base/checkbox/checkbox";
import { Radio, RadioGroup } from "@/components/base/radio/radio";
import { Input } from "@/components/base/input/input";
import { Select, SelectItem } from "@/components/base/select/select";
import { Chip } from "@/components/base/badges/chip";
import { toast } from "@/components/base/toast/toast";
import { useStore } from "@/store/app-store";
import { cardsForBank, getBank, getQuestion } from "@/lib/bank";
import { navigate, routeQuery } from "@/lib/router";
import { isCorrect } from "@/lib/scoring";
import type { BankQuestion, PracticeMode } from "@/lib/types";
import { EmptyState, Panel, PageHeader, SectionHeading } from "@/ui/common";
import { cx } from "@/utils/cx";

const MODES: Array<{
  mode: PracticeMode;
  title: string;
  description: string;
  icon: typeof RiBookOpenLine;
  tone: string;
}> = [
  {
    mode: "chapter",
    title: "章节顺序",
    description: "按当前题库的章节顺序逐题推进，适合系统练习。",
    icon: RiBookOpenLine,
    tone: "bg-accent-50 text-accent-700",
  },
  {
    mode: "random",
    title: "随机练习",
    description: "每轮洗牌且不重复，种子可复现。",
    icon: RiShuffleLine,
    tone: "bg-status-lime-background text-status-lime-text",
  },
  {
    mode: "adaptive",
    title: "智能加权",
    description: "优先新题、错题和到期内容，并保证章节覆盖。",
    icon: RiSparklingLine,
    tone: "bg-status-purple-background text-status-purple-text",
  },
  {
    mode: "mistakes",
    title: "错题重练",
    description: "只练最近一次答错的题，答对后自动移出。",
    icon: RiErrorWarningLine,
    tone: "bg-status-rose-background text-status-rose-text",
  },
  {
    mode: "favorites",
    title: "收藏夹",
    description: "从你收藏的题目中抽题，适合考前回看。",
    icon: RiStarLine,
    tone: "bg-status-orange-background text-status-orange-text",
  },
];

export function PracticeSetupPage({ route }: { route: string }) {
  const { projection, session, actions, activeBank } = useStore();
  const query = routeQuery(route);
  const initialMode = (query.get("mode") as PracticeMode | null) ?? "chapter";
  const [mode, setMode] = useState<PracticeMode>(MODES.some((item) => item.mode === initialMode) ? initialMode : "chapter");
  const [chapterId, setChapterId] = useState<string>(
    query.get("chapter") ?? activeBank.chapters[0]?.chapterId ?? "",
  );
  const [count, setCount] = useState(20);
  const [seed, setSeed] = useState("");

  useEffect(() => {
    if (count > activeBank.collected) setCount(Math.max(1, activeBank.collected));
  }, [activeBank.collected, count]);

  useEffect(() => {
    if (!activeBank.chapters.some((chapter) => chapter.chapterId === chapterId)) {
      setChapterId(activeBank.chapters[0]?.chapterId ?? "");
    }
  }, [activeBank, chapterId]);

  useEffect(() => {
    const next = query.get("mode") as PracticeMode | null;
    if (next && MODES.some((item) => item.mode === next)) setMode(next);
    const chapter = query.get("chapter");
    if (chapter) setChapterId(chapter);
  }, [route]);

  const poolSize = useMemo(() => {
    let questions = activeBank.questions;
    if (mode === "chapter") questions = questions.filter((question) => question.chapterId === chapterId);
    if (mode === "mistakes") questions = questions.filter((question) => projection.wrongQuestionIds.includes(question.questionId));
    if (mode === "favorites") questions = questions.filter((question) => projection.favoriteQuestionIds.includes(question.questionId));
    return questions.length;
  }, [chapterId, mode, projection.favoriteQuestionIds, projection.wrongQuestionIds]);

  const effectiveCount = Math.max(1, Math.min(count, Math.max(poolSize, 1)));

  function start() {
    if (poolSize === 0) {
      toast.error("当前模式下没有可练习的题目", { description: mode === "favorites" ? "先收藏几道题再来。" : "先完成一轮练习，错题会自动出现。" });
      return;
    }
    const created = actions.startSession({
      kind: "practice",
      mode,
      bankId: activeBank.bankId,
      chapterId: mode === "chapter" ? chapterId : undefined,
      count: effectiveCount,
      seed,
      title: MODES.find((item) => item.mode === mode)?.title ?? "练习",
    });
    if (!created) {
      toast.error("无法创建练习", { description: "题库为空或筛选条件过窄。" });
      return;
    }
    navigate("/session");
  }

  return (
    <div className="animate-rise flex flex-col gap-6">
      <PageHeader
        eyebrow="Practice"
        title="开始一轮练习"
        description="单选/判断点击选项即提交并显示官方答案；多选点击“提交答案”判分，再点“下一题”继续。退出后进度会保留。"
        actions={
          <>
            {session?.status === "active" ? (
              <Button
                variant="secondary"
                leadingIcon={RiPlayCircleLine}
                onClick={() => navigate(session.kind === "mock" ? "/exam" : "/session")}
              >
                继续当前{session.kind === "mock" ? "考试" : "练习"}
              </Button>
            ) : null}
            <Button variant="secondary" leadingIcon={RiRefreshLine} onClick={() => navigate("/mock")}>
              模拟考试
            </Button>
          </>
        }
      />

      {session?.status === "active" ? (
        <Panel className="flex flex-col gap-3 border-accent-200 bg-accent-50/60 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-body-2-semibold text-text-primary">
              有一轮进行中的{session.kind === "mock" ? "模拟考试" : "练习"}：{session.title}
            </p>
            <p className="mt-0.5 text-caption-1-medium text-text-secondary">
              {session.currentIndex + 1}/{session.questionIds.length} 题
              {session.kind === "mock" && session.deadlineAt
                ? ` · 截止 ${new Date(session.deadlineAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`
                : ""}
            </p>
          </div>
          <div className="flex gap-2">
            <Button size="small" onClick={() => navigate(session.kind === "mock" ? "/exam" : "/session")}>
              继续
            </Button>
            <Button
              size="small"
              variant="ghost"
              onClick={() => {
                actions.abandonSession();
                toast.success("已结束当前进度");
              }}
            >
              放弃
            </Button>
          </div>
        </Panel>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(300px,0.7fr)]">
        <Panel className="p-5 sm:p-6">
          <SectionHeading title="练习方式" description="五种模式共享同一套官方题库与稳定题目 ID。" />
          <div className="grid gap-3 sm:grid-cols-2">
            {MODES.map((item) => {
              const Icon = item.icon;
              const active = mode === item.mode;
              return (
                <button
                  key={item.mode}
                  type="button"
                  onClick={() => setMode(item.mode)}
                  aria-pressed={active}
                  className={cx(
                    "flex cursor-pointer flex-col items-start rounded-2xl border p-4 text-start transition-[border-color,background-color,box-shadow]",
                    active
                      ? "border-accent-400 bg-accent-50 shadow-sm"
                      : "border-border-button-default bg-background-primary-default hover:border-border-button-hover hover:bg-background-primary-hover",
                  )}
                >
                  <span className={cx("mb-3 flex size-10 items-center justify-center rounded-xl", item.tone)}>
                    <Icon className="size-5" aria-hidden />
                  </span>
                  <span className="text-body-semibold text-text-primary">{item.title}</span>
                  <span className="mt-1 text-body-2-regular text-text-secondary">{item.description}</span>
                </button>
              );
            })}
          </div>
        </Panel>

        <Panel className="flex flex-col p-5 sm:p-6">
          <SectionHeading title="范围与参数" description={`当前池 ${poolSize} 题`} />
          <div className="flex flex-col gap-4">
            {mode === "chapter" ? (
              <Select label="章节" selectedKey={chapterId} onSelectionChange={(key) => setChapterId(String(key))}>
                {activeBank.chapters.map((chapter) => (
                  <SelectItem id={chapter.chapterId} key={chapter.chapterId}>
                    {chapter.title}
                  </SelectItem>
                ))}
              </Select>
            ) : null}

            <Select label="本轮题量" selectedKey={String(count)} onSelectionChange={(key) => setCount(Number(key))}>
              {[...new Set([10, 20, 30, 50, 100, 200, activeBank.collected])]
                .filter((value) => value <= activeBank.collected)
                .sort((a, b) => a - b)
                .map((value) => (
                  <SelectItem id={String(value)} key={value}>
                    {value} 题
                  </SelectItem>
                ))}
            </Select>
            {count > poolSize ? (
              <p className="-mt-2 text-caption-1-medium text-text-tertiary">题库不足，本轮将使用全部 {poolSize} 题。</p>
            ) : null}

            <Input
              label="随机种子（可选）"
              value={seed}
              onChange={(value) => setSeed(value)}
              placeholder="留空自动生成，可复现同一轮排序"
              hint="仅用于可复现洗牌，不是安全令牌。"
            />

            <div className="rounded-2xl bg-background-secondary-default p-4">
              <p className="text-caption-1-semibold uppercase tracking-[0.1em] text-text-tertiary">本轮预览</p>
              <p className="mt-2 text-title-2-semibold text-text-primary">
                {effectiveCount} <span className="text-body-regular text-text-tertiary">题</span>
              </p>
              <p className="mt-1 text-body-2-regular text-text-secondary">
                {mode === "chapter"
                  ? activeBank.chapters.find((chapter) => chapter.chapterId === chapterId)?.title
                  : MODES.find((item) => item.mode === mode)?.title}
              </p>
            </div>

            <Button size="medium" leadingIcon={RiPlayCircleLine} onClick={start} isDisabled={poolSize === 0}>
              开始练习
            </Button>
          </div>
        </Panel>
      </div>

      <Panel className="p-5 sm:p-6">
        <SectionHeading title="题库状态" description={activeBank.coverageNote} />
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-2xl bg-background-secondary-default p-4">
            <p className="text-caption-1-medium text-text-tertiary">总题量</p>
            <p className="mt-1 text-title-2-semibold text-text-primary tabular">{activeBank.collected}</p>
          </div>
          <div className="rounded-2xl bg-background-secondary-default p-4">
            <p className="text-caption-1-medium text-text-tertiary">章节数</p>
            <p className="mt-1 text-title-2-semibold text-text-primary tabular">{activeBank.chapters.length}</p>
          </div>
          <div className="rounded-2xl bg-background-secondary-default p-4">
            <p className="text-caption-1-medium text-text-tertiary">知识卡</p>
            <p className="mt-1 text-title-2-semibold text-text-primary tabular">{cardsForBank(activeBank.bankId).length}</p>
          </div>
        </div>
      </Panel>
    </div>
  );
}

export function PracticeSessionPage() {
  const { session, projection, actions } = useStore();
  const [showNavigator, setShowNavigator] = useState(false);
  if (!session || session.kind !== "practice" || (session.status !== "active" && session.status !== "completed")) {
    return (
      <div className="animate-rise">
        <Panel>
          <EmptyState
            icon={RiPlayCircleLine}
            title="没有进行中的练习"
            description="选择一种练习方式开始，或继续已有的模拟考试。"
            actionLabel="去开始练习"
            onAction={() => navigate("/practice")}
          />
        </Panel>
      </div>
    );
  }

  const question = getQuestion(session.questionIds[session.currentIndex]);
  if (!question) {
    return (
      <Panel>
        <EmptyState icon={RiErrorWarningLine} title="题目不存在" description="题库数据可能已更新，请重新开始一轮练习。" actionLabel="返回" onAction={() => navigate("/practice")} />
      </Panel>
    );
  }
  const selected = session.answers[question.questionId] ?? [];
  const revealed = Boolean(session.revealed[question.questionId]);
  const completed = session.status === "completed";
  const locked = completed || revealed;
  const correct = revealed && isCorrect(question, selected);
  const bank = getBank(session.bankId);
  const chapter = bank.chapters.find((item) => item.chapterId === question.chapterId);
  const linkedCards = cardsForBank(bank.bankId).filter((card) => card.questionIds.includes(question.questionId));

  function selectOption(optionId: string) {
    if (completed || revealed || !question) return;
    if (question.type === "multiple") {
      const nextSelected = selected.includes(optionId) ? selected.filter((id) => id !== optionId) : [...selected, optionId];
      actions.setSessionAnswer(question.questionId, nextSelected);
    } else {
      actions.answerPractice(question.questionId, [optionId]);
    }
  }

  function finish() {
    actions.finishPractice();
    toast.success("本轮练习已结束", { description: "已保留全部作答记录与错题/收藏事件；未作答题目不会生成答题记录。" });
    navigate("/progress");
  }

  function advance() {
    if (!session) return;
    if (session.currentIndex >= session.questionIds.length - 1) {
      finish();
      return;
    }
    actions.moveQuestion(session.currentIndex + 1);
  }

  function submitMultipleAnswer() {
    if (!question || question.type !== "multiple" || locked || selected.length === 0) return;
    actions.answerPractice(question.questionId, selected);
  }

  function next() {
    if (!question || (question.type === "multiple" && !locked)) return;
    advance();
  }

  return (
    <div className="animate-rise flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button size="small" variant="ghost" leadingIcon={RiArrowLeftLine} onClick={() => navigate("/practice")}>
            退出
          </Button>
          <Chip color="blue" variant="caption">
            {session.title}
          </Chip>
          <span className="text-caption-1-medium text-text-tertiary">
            {session.currentIndex + 1} / {session.questionIds.length}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            iconOnly
            size="small"
            variant="secondary"
            leadingIcon={session.flagged.includes(question.questionId) ? RiFlagFill : RiFlagLine}
            aria-label={session.flagged.includes(question.questionId) ? "取消标记" : "标记本题"}
            onClick={() => actions.toggleFlag(question.questionId)}
          />
          <Button
            iconOnly
            size="small"
            variant="secondary"
            leadingIcon={projection.statsByQuestion.get(question.questionId)?.favorite ? RiStarFill : RiStarLine}
            aria-label={projection.statsByQuestion.get(question.questionId)?.favorite ? "取消收藏" : "收藏本题"}
            onClick={() => actions.toggleFavorite(question.questionId)}
          />
          <Button size="small" variant="secondary" onClick={() => setShowNavigator((value) => !value)}>
            题卡
          </Button>
        </div>
      </div>

      <div className="h-1.5 overflow-hidden rounded-full bg-background-tertiary-default">
        <div
          className="h-full rounded-full bg-accent-600 transition-[width] duration-300"
          style={{ width: `${((session.currentIndex + 1) / session.questionIds.length) * 100}%` }}
        />
      </div>

      <div className={cx("grid gap-5", showNavigator ? "xl:grid-cols-[minmax(0,1fr)_280px]" : "grid-cols-1")}>
        <div className="flex flex-col gap-4">
          {completed ? (
            <Panel className="border-status-lime-text/30 bg-status-lime-background p-4">
              <p className="text-body-2-semibold text-status-lime-text">本轮练习已完成</p>
              <p className="mt-0.5 text-caption-1-medium text-text-secondary">
                当前为只读回看；已作答 {Object.keys(session.revealed).length}/{session.questionIds.length} 题。未作答题目不会生成答题记录。
              </p>
            </Panel>
          ) : null}
          <Panel className="p-5 sm:p-7">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <Chip color="neutral" variant="caption">
                {question.type === "judgment" ? "判断题" : question.type === "multiple" ? "多选题" : "单选题"}
              </Chip>
              {chapter ? <span className="text-caption-1-medium text-text-tertiary">{chapter.title}</span> : null}
              {question.score ? <span className="text-caption-1-medium text-text-tertiary">· {question.score}</span> : null}
            </div>
            <h1 className="text-title-2-semibold leading-relaxed text-text-primary sm:text-title-1-semibold">
              {question.stem}
            </h1>

            <PendingSingleCommit
              key={question.questionId}
              questionId={question.questionId}
              selected={selected}
              enabled={!locked && question.type !== "multiple" && selected.length > 0}
            />

            {question.type === "multiple" ? (
              <div className="mt-6 flex flex-col gap-2.5">
                {question.options.map((option) => {
                  const isSelected = selected.includes(option.id);
                  const isAnswer = question.answerKey.includes(option.id);
                  return (
                    <Checkbox
                      key={option.id}
                      className={cx(
                        "option-card w-full rounded-2xl border p-4 transition-colors",
                        optionTone(revealed, isSelected, isAnswer),
                      )}
                      isSelected={isSelected}
                      isDisabled={locked}
                      onChange={() => selectOption(option.id)}
                    >
                      <span className="flex w-full items-start gap-3">
                        <OptionBadge label={option.label} selected={isSelected} revealed={revealed} correct={isAnswer} />
                        <span className="pt-0.5 text-body-regular text-text-primary">{option.text}</span>
                      </span>
                    </Checkbox>
                  );
                })}
              </div>
            ) : (
              <RadioGroup
                aria-label="选择答案"
                value={selected[0] ?? ""}
                onChange={(value) => selectOption(value)}
                className="mt-6 flex flex-col gap-2.5"
              >
                {question.options.map((option) => {
                  const isSelected = selected.includes(option.id);
                  const isAnswer = question.answerKey.includes(option.id);
                  return (
                    <div
                      key={option.id}
                      className={cx(
                        "option-card rounded-2xl border p-4 transition-colors",
                        optionTone(revealed, isSelected, isAnswer),
                      )}
                      onClick={() => selectOption(option.id)}
                    >
                      <Radio value={option.id} isDisabled={locked} className="w-full">
                        <span className="flex w-full items-start gap-3">
                          <OptionBadge label={option.label} selected={isSelected} revealed={revealed} correct={isAnswer} />
                          <span className="pt-0.5 text-body-regular text-text-primary">{option.text}</span>
                        </span>
                      </Radio>
                    </div>
                  );
                })}
              </RadioGroup>
            )}

            {revealed ? (
              <div
                className={cx(
                  "mt-6 rounded-2xl border p-4",
                  correct ? "border-status-lime-text/30 bg-status-lime-background" : "border-status-rose-text/30 bg-status-rose-background",
                )}
              >
                <p className={cx("flex items-center gap-2 text-body-semibold", correct ? "text-status-lime-text" : "text-status-rose-text")}>
                  {correct ? <RiCheckboxCircleLine className="size-5" /> : <RiCloseCircleLine className="size-5" />}
                  {correct ? "回答正确" : "回答错误"}
                </p>
                <p className="mt-2 text-body-2-regular text-text-primary">
                  官方答案：<strong>{question.answerText.join(" / ")}</strong>
                </p>
                {question.explanation ? (
                  <p className="mt-3 whitespace-pre-line text-body-2-regular text-text-primary">
                    <strong>官方解析：</strong>{question.explanation}
                  </p>
                ) : null}
                <p className="mt-1 text-caption-1-medium text-text-secondary">来源：{question.sourceTitle}</p>
              </div>
            ) : null}

            <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
              <Button
                size="medium"
                variant="secondary"
                leadingIcon={RiArrowLeftLine}
                isDisabled={session.currentIndex === 0}
                onClick={() => actions.moveQuestion(session.currentIndex - 1)}
              >
                上一题
              </Button>
              <div className="flex flex-wrap items-center justify-end gap-2">
                {question.type === "multiple" ? (
                  <Button
                    size="medium"
                    variant={revealed ? "secondary" : "primary"}
                    isDisabled={locked || selected.length === 0}
                    onClick={submitMultipleAnswer}
                  >
                    {revealed ? "已提交" : "提交答案"}
                  </Button>
                ) : null}
                {completed && session.currentIndex < session.questionIds.length - 1 ? (
                  <Button size="medium" variant="secondary" trailingIcon={RiArrowRightLine} onClick={() => actions.moveQuestion(session.currentIndex + 1)}>
                    下一题
                  </Button>
                ) : null}
                <Button
                  size="medium"
                  variant={question.type === "multiple" && !revealed ? "secondary" : "primary"}
                  trailingIcon={RiArrowRightLine}
                  isDisabled={question.type === "multiple" && !locked}
                  onClick={completed ? finish : next}
                >
                  {completed || session.currentIndex >= session.questionIds.length - 1 ? "完成练习" : "下一题"}
                </Button>
              </div>
            </div>
            {question.type === "multiple" && !locked ? (
              <p className="mt-3 text-caption-1-medium text-text-tertiary">
                多选题：点击整条选项可勾选或取消，选好后点击“提交答案”查看对错与解析，再点击“下一题 / 完成练习”继续。
              </p>
            ) : null}
          </Panel>

          {linkedCards.length > 0 ? (
            <Panel className="p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="flex items-center gap-2 text-body-2-semibold text-text-primary">
                  <RiLightbulbFlashLine className="size-4 text-accent-600" aria-hidden />
                  关联知识卡
                </p>
                <Button size="xs" variant="ghost" onClick={() => navigate("/cards")}>
                  去复习
                </Button>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {linkedCards.map((card) => (
                  <Chip key={card.cardId} color="purple" variant="caption">
                    {card.title}
                  </Chip>
                ))}
              </div>
            </Panel>
          ) : null}
        </div>

        {showNavigator ? (
          <Panel className="h-fit p-4">
            <p className="mb-3 text-caption-1-semibold uppercase tracking-[0.1em] text-text-tertiary">题卡</p>
            <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-8 xl:grid-cols-6">
              {session.questionIds.map((id, index) => {
                const answered = Boolean(session.revealed[id]);
                const flagged = session.flagged.includes(id);
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
                          ? "bg-status-lime-background text-status-lime-text"
                          : "bg-background-secondary-default text-text-secondary hover:bg-background-tertiary-default",
                    )}
                    aria-label={`第 ${index + 1} 题${answered ? "，已作答" : ""}${flagged ? "，已标记" : ""}`}
                  >
                    {index + 1}
                    {flagged ? <span className="absolute end-0.5 top-0.5 size-1.5 rounded-full bg-orange-500" /> : null}
                  </button>
                );
              })}
            </div>
            <div className="mt-4 flex items-center justify-between border-t border-separator-border pt-3 text-caption-1-medium text-text-tertiary">
              <span>已答 {Object.keys(session.revealed).length}</span>
              <span>共 {session.questionIds.length}</span>
            </div>
          </Panel>
        ) : null}
      </div>
    </div>
  );
}

function PendingSingleCommit({
  questionId,
  selected,
  enabled,
}: {
  questionId: string;
  selected: string[];
  enabled: boolean;
}) {
  const { actions } = useStore();
  useEffect(() => {
    if (enabled) actions.answerPractice(questionId, selected);
  }, [actions, enabled, questionId, selected]);
  return null;
}

function formatSelectedAnswer(question: BankQuestion, selected: readonly string[]): string | null {
  if (selected.length === 0) return null;
  const chosen = new Set(selected);
  const parts = question.options
    .filter((option) => chosen.has(option.id))
    .map((option) => `${option.label}. ${option.text}`);
  const unknown = selected.filter((id) => !question.options.some((option) => option.id === id)).length;
  if (unknown > 0) parts.push("选项已更新");
  return parts.length > 0 ? parts.join(" / ") : null;
}

function optionTone(revealed: boolean, selected: boolean, answer: boolean): string {
  if (revealed && answer) return "border-status-lime-text bg-status-lime-background";
  if (revealed && selected && !answer) return "border-status-rose-text bg-status-rose-background";
  if (selected) return "border-accent-400 bg-accent-50";
  return "border-border-button-default bg-background-primary-default hover:border-border-button-hover hover:bg-background-primary-hover";
}

function OptionBadge({
  label,
  selected,
  revealed,
  correct,
}: {
  label: string;
  selected: boolean;
  revealed: boolean;
  correct: boolean;
}) {
  return (
    <span
      className={cx(
        "flex size-7 shrink-0 items-center justify-center rounded-full text-caption-1-semibold",
        revealed && correct
          ? "bg-status-lime-text text-white"
          : revealed && selected
            ? "bg-status-rose-text text-white"
            : selected
              ? "bg-accent-600 text-white"
              : "bg-background-secondary-default text-text-secondary",
      )}
    >
      {label}
    </span>
  );
}

export function QuestionListPage({ kind }: { kind: "mistakes" | "favorites" }) {
  const { projection, actions, activeBank } = useStore();
  const [chapterId, setChapterId] = useState("");
  const [search, setSearch] = useState("");
  const [seed, setSeed] = useState("");
  const bankQuestionIds = new Set(activeBank.questions.map((question) => question.questionId));
  const ids = (kind === "mistakes" ? projection.wrongQuestionIds : projection.favoriteQuestionIds).filter((id) =>
    bankQuestionIds.has(id),
  );
  const questions = ids
    .map((id) => getQuestion(id))
    .filter((question): question is NonNullable<typeof question> => Boolean(question))
    .filter((question) => !chapterId || question.chapterId === chapterId)
    .filter((question) => !search || question.stem.includes(search) || question.sourceTitle.includes(search));

  function startDrill() {
    const created = actions.startSession({
      kind: "practice",
      mode: kind,
      bankId: activeBank.bankId,
      count: Math.max(1, Math.min(questions.length, 100)),
      seed,
      title: kind === "mistakes" ? "错题重练" : "收藏练习",
    });
    if (!created) {
      toast.error("没有可练习的题目");
      return;
    }
    navigate("/session");
  }

  return (
    <div className="animate-rise flex flex-col gap-6">
      <PageHeader
        eyebrow={kind === "mistakes" ? "Mistakes" : "Favorites"}
        title={kind === "mistakes" ? "错题本" : "收藏夹"}
        description={
          kind === "mistakes"
            ? "只收录最近一次作答错误的题目；重新答对后会移出错题本，历史记录仍保留在本机事件日志中。"
            : "收藏使用 append-only 事件记录；取消收藏只写入墓碑，不删除历史。"
        }
        actions={
          <Button leadingIcon={RiPlayCircleLine} onClick={startDrill} isDisabled={questions.length === 0}>
            开始{kind === "mistakes" ? "错题重练" : "收藏练习"}
          </Button>
        }
      />

      <Panel className="flex flex-col gap-3 p-4 sm:flex-row sm:items-end">
        <Select label="章节" className="sm:w-80" selectedKey={chapterId || "all"} onSelectionChange={(key) => setChapterId(String(key) === "all" ? "" : String(key))}>
          <SelectItem id="all">全部章节</SelectItem>
          {activeBank.chapters.map((chapter) => (
            <SelectItem id={chapter.chapterId} key={chapter.chapterId}>
              {chapter.title}
            </SelectItem>
          ))}
        </Select>
        <Input label="搜索题干或来源" value={search} onChange={(value) => setSearch(value)} className="sm:w-72" placeholder="输入关键词" />
        <div className="flex items-center gap-2 sm:ms-auto">
          <Input label="种子（可选）" value={seed} onChange={(value) => setSeed(value)} className="w-36" placeholder="自动" />
          <Button size="small" variant="secondary" leadingIcon={RiShuffleLine} onClick={startDrill} isDisabled={questions.length === 0}>
            抽题练习
          </Button>
        </div>
      </Panel>

      {questions.length === 0 ? (
        <Panel>
          <EmptyState
            icon={kind === "mistakes" ? RiErrorWarningLine : RiStarLine}
            title={kind === "mistakes" ? "错题本是空的" : "还没有收藏"}
            description={
              kind === "mistakes"
                ? "完成练习后，最近一次答错的题会自动进入这里。"
                : "在练习或复盘时点击星标，就能把题目收进这里。"
            }
            actionLabel="去练习"
            onAction={() => navigate("/practice")}
          />
        </Panel>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-caption-1-medium text-text-tertiary">共 {questions.length} 题</p>
          {questions.slice(0, 100).map((question) => {
            const stat = projection.statsByQuestion.get(question.questionId);
            return (
              <Panel key={question.questionId} className="p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <Chip color={kind === "mistakes" ? "rose" : "orange"} variant="caption">
                        {question.type === "judgment" ? "判断题" : question.type === "multiple" ? "多选题" : "单选题"}
                      </Chip>
                      <span className="truncate text-caption-1-medium text-text-tertiary">{question.sourceTitle}</span>
                    </div>
                    <p className="text-body-medium text-text-primary">{question.stem}</p>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-caption-1-medium text-text-secondary">
                      <span>官方答案：{question.answerText.join(" / ")}</span>
                      <span>
                        上次作答：
                        {formatSelectedAnswer(question, stat?.lastSelected ?? []) ?? "暂无作答记录"}
                      </span>
                    </div>
                    {question.explanation ? (
                      <p className="mt-2 whitespace-pre-line text-caption-1-medium text-text-secondary">
                        <strong>官方解析：</strong>{question.explanation}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      iconOnly
                      size="small"
                      variant="secondary"
                      leadingIcon={stat?.favorite ? RiStarFill : RiStarLine}
                      aria-label={stat?.favorite ? "取消收藏" : "收藏"}
                      onClick={() => actions.toggleFavorite(question.questionId)}
                    />
                    <Button size="xs" variant="ghost" onClick={() => navigate(`/practice?mode=${kind}&chapter=${question.chapterId}`)}>
                      练同类
                    </Button>
                  </div>
                </div>
              </Panel>
            );
          })}
        </div>
      )}
    </div>
  );
}
