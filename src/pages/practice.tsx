import { useEffect, useMemo, useState } from "react";
import {
  RiArrowLeftLine,
  RiArrowRightLine,
  RiBookOpenLine,
  RiCheckboxCircleLine,
  RiCloseCircleLine,
  RiErrorWarningLine,
  RiEyeLine,
  RiFlagFill,
  RiFlagLine,
  RiLightbulbFlashLine,
  RiPlayCircleLine,
  RiShuffleLine,
  RiSparklingLine,
  RiStarFill,
  RiStarLine,
} from "@remixicon/react";
import { Button } from "@/components/base/buttons/button";
import { Checkbox } from "@/components/base/checkbox/checkbox";
import { Radio, RadioGroup } from "@/components/base/radio/radio";
import { Select, SelectItem } from "@/components/base/select/select";
import { Input } from "@/components/base/input/input";
import { Chip } from "@/components/base/badges/chip";
import { Drawer, DrawerBody, DrawerHeader } from "@/components/base/drawer/drawer";
import { Switch } from "@/components/base/switch/switch";
import { toast } from "@/components/base/toast/toast";
import { useStore } from "@/store/app-store";
import { cardsForBank, getBank, getQuestion } from "@/lib/bank";
import { navigate, routeQuery } from "@/lib/router";
import { isCorrect, percent } from "@/lib/scoring";
import type { BankChapter, BankQuestion } from "@/lib/types";
import { EmptyState, Panel, PageHeader } from "@/ui/common";
import { cx } from "@/utils/cx";

/** 顺序练习是主入口（全库/章节断点续练）；其余为即点即练的快捷方式。 */
const QUICK_MODES = [
  {
    mode: "random",
    title: "随机练习",
    description: "整库洗牌且不重复，20 题一组。",
    icon: RiShuffleLine,
    tone: "bg-status-lime-background text-status-lime-text",
    count: (collected: number) => Math.min(20, collected),
  },
  {
    mode: "adaptive",
    title: "智能加权",
    description: "优先新题、错题和到期内容，20 题一组。",
    icon: RiSparklingLine,
    tone: "bg-status-purple-background text-status-purple-text",
    count: (collected: number) => Math.min(20, collected),
  },
  {
    mode: "mistakes",
    title: "错题重练",
    description: "最近一次答错的题，答对自动移出。",
    icon: RiErrorWarningLine,
    tone: "bg-status-rose-background text-status-rose-text",
    count: (collected: number) => collected,
  },
  {
    mode: "favorites",
    title: "收藏练习",
    description: "只练收藏过的题，适合考前回看。",
    icon: RiStarLine,
    tone: "bg-status-orange-background text-status-orange-text",
    count: (collected: number) => collected,
  },
] as const;

export function PracticeSetupPage({ route }: { route: string }) {
  const { state, projection, session, actions, activeBank } = useStore();
  const query = routeQuery(route);
  const unansweredCount = activeBank.collected - projection.attempted;

  const chapterRows = useMemo(
    () =>
      activeBank.chapters.map((chapter) => {
        const questions = activeBank.questions.filter((question) => question.chapterId === chapter.chapterId);
        const attempted = questions.filter((question) => (projection.statsByQuestion.get(question.questionId)?.attempts ?? 0) > 0).length;
        const correct = questions.reduce((sum, question) => sum + (projection.statsByQuestion.get(question.questionId)?.correct ?? 0), 0);
        const attempts = questions.reduce((sum, question) => sum + (projection.statsByQuestion.get(question.questionId)?.attempts ?? 0), 0);
        return { chapter, attempted, total: questions.length, accuracy: attempts ? percent(correct, attempts) : 0 };
      }),
    [activeBank, projection.statsByQuestion],
  );

  function startSequential(chapter?: BankChapter) {
    const created = actions.startSession({
      kind: "practice",
      mode: "chapter",
      bankId: activeBank.bankId,
      chapterId: chapter?.chapterId,
      count: chapter ? chapter.questionCount : activeBank.collected,
      resume: true,
      title: chapter ? `顺序练习 · ${chapter.title}` : "顺序练习",
    });
    if (!created) {
      toast.error("无法开始练习", { description: "题库为空。" });
      return;
    }
    navigate("/session");
  }

  function startUnanswered() {
    if (session?.kind === "mock" && session.status === "active") {
      navigate("/exam");
      return;
    }
    const created = actions.startSession({
      kind: "practice",
      mode: "unanswered",
      bankId: activeBank.bankId,
      count: activeBank.collected,
      title: "只刷未做题",
      studyMode: false,
    });
    if (!created) {
      toast.info("本题库已全部作答");
      navigate("/practice");
      return;
    }
    navigate("/session");
  }

  function startQuick(item: (typeof QUICK_MODES)[number]) {
    const pool =
      item.mode === "mistakes"
        ? projection.wrongQuestionIds.length
        : item.mode === "favorites"
          ? projection.favoriteQuestionIds.length
          : activeBank.collected;
    if (pool === 0) {
      toast.error(item.mode === "favorites" ? "还没有收藏的题目" : "还没有错题", {
        description: item.mode === "favorites" ? "练习时点星标即可收藏。" : "先做几道题，答错的会自动进入错题本。",
      });
      return;
    }
    const created = actions.startSession({
      kind: "practice",
      mode: item.mode,
      bankId: activeBank.bankId,
      count: item.count(pool),
      title: item.title,
    });
    if (!created) {
      toast.error("无法开始练习");
      return;
    }
    navigate("/session");
  }

  // 旧入口 ?mode=chapter(&chapter=...) 直接进入顺序练习；其余模式一键开始。
  useEffect(() => {
    const mode = query.get("mode");
    if (!mode) return;
    // 模考有倒计时，优先回到考试；进行中的练习直接由新入口替换，避免入口被旧的挡住。
    if (session?.kind === "mock" && session.status === "active") {
      navigate("/exam");
      return;
    }
    if (mode === "chapter") {
      const chapter = activeBank.chapters.find((item) => item.chapterId === query.get("chapter"));
      startSequential(chapter);
      return;
    }
    if (mode === "unanswered") {
      startUnanswered();
      return;
    }
    const item = QUICK_MODES.find((entry) => entry.mode === mode);
    if (item) startQuick(item);
    else navigate("/practice");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route]);

  const activePractice = session?.kind === "practice" && session.status === "active" ? session : null;
  const activeMock = session?.kind === "mock" && session.status === "active" ? session : null;
  const ongoing = activePractice ?? activeMock;

  return (
    <div className="animate-rise flex flex-col gap-6">
      <PageHeader
        eyebrow="Practice"
        title="开始练习"
        description="顺序练习从上次未做的题继续；单选/判断点选即判分，多选提交后判分。"
        actions={
          <Button variant="secondary" onClick={() => navigate("/mock")}>
            模拟考试
          </Button>
        }
      />

      {ongoing ? (
        <Panel className="flex flex-col gap-3 border-accent-200 bg-accent-50/60 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-body-2-semibold text-text-primary">进行中：{ongoing.title}</p>
            <p className="mt-0.5 text-caption-1-medium text-text-secondary">
              {ongoing.currentIndex + 1}/{ongoing.questionIds.length} 题
            </p>
          </div>
          <div className="flex gap-2">
            <Button size="small" onClick={() => navigate(activeMock ? "/exam" : "/session")}>
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

      <div className="flex flex-col gap-3 rounded-2xl border border-border-button-default bg-background-primary-default p-4 sm:flex-row sm:items-center">
        <Switch
          isSelected={state.settings.studyMode}
          onChange={(value) => actions.updateSettings({ studyMode: value })}
        >
          <span className="flex items-center gap-1.5 text-body-2-medium text-text-primary">
            <RiEyeLine className="size-4 text-accent-600" aria-hidden />
            背题模式
          </span>
        </Switch>
        <p className="text-caption-1-medium text-text-tertiary sm:ms-auto">
          {state.settings.studyMode ? "已开启：直接显示答案与解析，作答不计入统计。「只刷未做题」仍正常作答。" : "关闭时正常作答并统计正确率。"}
        </p>
      </div>

      <Panel className="flex flex-col gap-4 p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-title-3-semibold text-text-primary">顺序练习</h2>
            <p className="mt-0.5 text-caption-1-medium text-text-tertiary">
              已练 {projection.attempted}/{activeBank.collected} 题 · 从第一道未做的题继续
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" leadingIcon={RiPlayCircleLine} onClick={() => startSequential()}>
              {projection.attempted > 0 ? "继续顺序练习" : "开始顺序练习"}
            </Button>
            <Button isDisabled={unansweredCount === 0} onClick={startUnanswered}>
              {unansweredCount > 0 ? `只刷未做题 · 剩 ${unansweredCount} 题` : "本题库已全部作答"}
            </Button>
          </div>
        </div>
        <div className="flex flex-col divide-y divide-separator-border">
          {chapterRows.map((row) => (
            <button
              key={row.chapter.chapterId}
              type="button"
              className="group flex cursor-pointer items-center gap-3 py-3 text-start"
              onClick={() => startSequential(row.chapter)}
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-50 text-accent-700">
                <RiBookOpenLine className="size-5" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body-2-semibold text-text-primary">{row.chapter.title}</span>
                <span className="mt-0.5 block text-caption-1-medium text-text-tertiary">
                  {row.attempted}/{row.total} 题{row.attempted > 0 ? ` · ${row.accuracy}% 正确` : ""}
                  {row.attempted >= row.total ? " · 已练完，点击从头回看" : ""}
                </span>
              </span>
              <span className="hidden w-28 shrink-0 sm:block">
                <span className="block h-1.5 overflow-hidden rounded-full bg-background-tertiary-default">
                  <span
                    className="block h-full rounded-full bg-accent-500"
                    style={{ width: `${percent(row.attempted, row.total)}%` }}
                  />
                </span>
              </span>
              <RiArrowRightLine className="size-4 shrink-0 text-text-tertiary transition-transform group-hover:translate-x-0.5" aria-hidden />
            </button>
          ))}
        </div>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {QUICK_MODES.map((item) => {
          const Icon = item.icon;
          const meta =
            item.mode === "mistakes"
              ? `${projection.wrongQuestionIds.length} 题待重练`
              : item.mode === "favorites"
                ? `${projection.favoriteQuestionIds.length} 题已收藏`
                : `共 ${activeBank.collected} 题`;
          return (
            <button
              key={item.mode}
              type="button"
              onClick={() => startQuick(item)}
              className="group flex cursor-pointer flex-col items-start rounded-2xl border border-border-button-default bg-background-primary-default p-4 text-start transition-[border-color,box-shadow] hover:border-border-button-hover hover:shadow-md"
            >
              <span className={cx("mb-3 flex size-10 items-center justify-center rounded-xl", item.tone)}>
                <Icon className="size-5" aria-hidden />
              </span>
              <span className="text-body-semibold text-text-primary">{item.title}</span>
              <span className="mt-1 text-body-2-regular text-text-secondary">{item.description}</span>
              <span className="mt-3 text-caption-1-semibold text-text-tertiary">{meta}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function PracticeSessionPage() {
  const { state, session, projection, actions } = useStore();
  const [sheetOpen, setSheetOpen] = useState(false);

  const activeQuestion =
    session && session.kind === "practice" ? getQuestion(session.questionIds[session.currentIndex]) : undefined;
  const study = Boolean(session?.studyMode);
  const completed = session?.status === "completed";
  // 驾考宝典式节奏：单选/判断答对后短暂显示反馈再自动跳下一题；答错停留看解析。
  useEffect(() => {
    if (!session || session.kind !== "practice" || session.status !== "active") return;
    if (study || completed || !state.settings.autoNextOnCorrect) return;
    if (!activeQuestion || activeQuestion.type === "multiple" || !session.revealed[activeQuestion.questionId]) return;
    if (!isCorrect(activeQuestion, session.answers[activeQuestion.questionId] ?? [])) return;
    const timer = window.setTimeout(() => {
      // 末题答对不自动结束：留给用户看反馈后手动点“完成练习”。
      if (session.currentIndex < session.questionIds.length - 1) actions.moveQuestion(session.currentIndex + 1);
    }, 600);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id, session?.currentIndex, activeQuestion?.questionId, study, completed, state.settings.autoNextOnCorrect]);
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

  const question = activeQuestion;
  if (!question) {
    return (
      <Panel>
        <EmptyState icon={RiErrorWarningLine} title="题目不存在" description="题库数据可能已更新，请重新开始一轮练习。" actionLabel="返回" onAction={() => navigate("/practice")} />
      </Panel>
    );
  }
  const selected = session.answers[question.questionId] ?? [];
  const revealed = study || Boolean(session.revealed[question.questionId]);
  const locked = completed || revealed;
  const graded = !study && Boolean(session.revealed[question.questionId]);
  const correct = graded && isCorrect(question, selected);
  const bank = getBank(session.bankId);
  const chapter = bank.chapters.find((item) => item.chapterId === question.chapterId);
  const linkedCards = cardsForBank(bank.bankId).filter((card) => card.questionIds.includes(question.questionId));
  const sessionCorrect = session.questionIds.filter((id) => {
    const item = getQuestion(id);
    return item && session.revealed[id] && isCorrect(item, session.answers[id] ?? []);
  }).length;
  const sessionWrong = Object.keys(session.revealed).length - sessionCorrect;
  const isLast = session.currentIndex >= session.questionIds.length - 1;

  function selectOption(optionId: string) {
    if (study || locked || !question) return;
    if (question.type === "multiple") {
      const nextSelected = selected.includes(optionId) ? selected.filter((id) => id !== optionId) : [...selected, optionId];
      actions.setSessionAnswer(question.questionId, nextSelected);
    } else {
      actions.answerPractice(question.questionId, [optionId]);
    }
  }

  function finish() {
    actions.finishPractice();
    toast.success("本轮练习已结束", {
      description: session?.mode === "unanswered"
        ? "作答记录已保留；再次进入只会刷还没做的题。"
        : "作答记录与错题/收藏已保留；下次顺序练习从断点继续。",
    });
    navigate("/practice");
  }

  function next() {
    if (!session) return;
    if (isLast) {
      finish();
      return;
    }
    actions.moveQuestion(session.currentIndex + 1);
  }

  function submitMultipleAnswer() {
    if (!question || question.type !== "multiple" || study || locked || selected.length === 0) return;
    actions.answerPractice(question.questionId, selected);
  }

  const sheet = (
    <div>
      {!study ? (
        <div className="mb-4 flex items-center justify-between gap-3 text-body-2-semibold">
          <span className="flex items-center gap-1.5 text-status-lime-text">
            <RiCheckboxCircleLine className="size-4" aria-hidden />
            答对 {sessionCorrect}
          </span>
          <span className="flex items-center gap-1.5 text-status-rose-text">
            <RiCloseCircleLine className="size-4" aria-hidden />
            答错 {sessionWrong}
          </span>
          <span className="text-caption-1-medium text-text-tertiary">
            已答 {Object.keys(session.revealed).length}/{session.questionIds.length}
          </span>
        </div>
      ) : null}
      <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-10 xl:grid-cols-6">
        {session.questionIds.map((id, index) => {
          const answered = Boolean(session.revealed[id]);
          const item = getQuestion(id);
          const wasCorrect = answered && item && isCorrect(item, session.answers[id] ?? []);
          const flagged = session.flagged.includes(id);
          return (
            <button
              key={id}
              type="button"
              onClick={() => {
                actions.moveQuestion(index);
                setSheetOpen(false);
              }}
              className={cx(
                "relative flex aspect-square cursor-pointer items-center justify-center rounded-lg text-caption-2-semibold tabular",
                index === session.currentIndex
                  ? "bg-accent-600 text-white"
                  : answered
                    ? wasCorrect
                      ? "bg-status-lime-background text-status-lime-text"
                      : "bg-status-rose-background text-status-rose-text"
                    : "bg-background-secondary-default text-text-secondary hover:bg-background-tertiary-default",
              )}
              aria-label={`第 ${index + 1} 题${answered ? (wasCorrect ? "，答对" : "，答错") : "，未作答"}${flagged ? "，已标记" : ""}`}
            >
              {index + 1}
              {flagged ? <span className="absolute end-0.5 top-0.5 size-1.5 rounded-full bg-orange-500" /> : null}
            </button>
          );
        })}
      </div>
      {!study && state.settings.autoNextOnCorrect ? (
        <p className="mt-4 text-caption-1-medium text-text-tertiary">答对自动跳下一题已开启，可在“设置与数据”关闭。</p>
      ) : null}
    </div>
  );

  return (
    // 不加 animate-rise：动画的 transform 会把 fixed 底栏变成随页面滚动的定位。
    <div className="flex flex-col gap-4 pb-24">
      <div className="sticky top-16 z-20 -mx-1 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border-button-default bg-background-primary-default px-3 py-2 shadow-sm lg:top-2">
        <div className="flex min-w-0 items-center gap-2">
          <Button iconOnly size="small" variant="ghost" leadingIcon={RiArrowLeftLine} aria-label="退出练习" onClick={() => navigate("/practice")} />
          <span className="truncate text-body-2-semibold text-text-primary">{session.title}</span>
          <span className="shrink-0 text-caption-1-medium text-text-tertiary tabular">
            {session.currentIndex + 1}/{session.questionIds.length}
          </span>
          {study ? (
            <Chip color="purple" variant="caption">
              背题
            </Chip>
          ) : null}
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
        </div>
        <div className="basis-full">
          <div className="h-1 overflow-hidden rounded-full bg-background-tertiary-default">
            <div
              className="h-full rounded-full bg-accent-600 transition-[width] duration-300"
              style={{ width: `${((session.currentIndex + 1) / session.questionIds.length) * 100}%` }}
            />
          </div>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_280px]">
        <div className="flex flex-col gap-4">
          {completed ? (
            <Panel className="border-status-lime-text/30 bg-status-lime-background p-4">
              <p className="text-body-2-semibold text-status-lime-text">本轮练习已完成</p>
              <p className="mt-0.5 text-caption-1-medium text-text-secondary">
                当前为只读回看；已作答 {Object.keys(session.revealed).length}/{session.questionIds.length} 题。
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
                  study
                    ? "border-accent-200 bg-accent-50/60"
                    : correct
                      ? "border-status-lime-text/30 bg-status-lime-background"
                      : "border-status-rose-text/30 bg-status-rose-background",
                )}
              >
                {study ? (
                  <p className="flex items-center gap-2 text-body-semibold text-accent-700">
                    <RiEyeLine className="size-5" aria-hidden />
                    背题模式 · 不计入统计
                  </p>
                ) : (
                  <p className={cx("flex items-center gap-2 text-body-semibold", correct ? "text-status-lime-text" : "text-status-rose-text")}>
                    {correct ? <RiCheckboxCircleLine className="size-5" /> : <RiCloseCircleLine className="size-5" />}
                    {correct ? "回答正确" : "回答错误"}
                  </p>
                )}
                <p className="mt-2 text-body-2-regular text-text-primary">
                  官方答案：<strong>{question.answerText.join(" / ")}</strong>
                </p>
                {question.explanation ? (
                  <p className="mt-3 whitespace-pre-line text-body-2-regular text-text-primary">
                    <strong>官方解析：</strong>{question.explanation}
                  </p>
                ) : null}
                {state.settings.showSourceInPractice ? (
                  <p className="mt-1 text-caption-1-medium text-text-secondary">来源：{question.sourceTitle}</p>
                ) : null}
              </div>
            ) : null}

            {question.type === "multiple" && !locked ? (
              <p className="mt-3 text-caption-1-medium text-text-tertiary">
                多选题：勾选后点击底部“提交答案”判分。
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

        <Panel className="hidden h-fit p-4 xl:block">
          <p className="mb-3 text-caption-1-semibold uppercase tracking-[0.1em] text-text-tertiary">题卡</p>
          {sheet}
        </Panel>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-separator-border bg-background-primary-default lg:ps-[284px]">
        <div className="mx-auto flex max-w-[1280px] flex-wrap items-center gap-2 px-4 py-3 sm:px-6 lg:px-10">
          {!study ? (
            <div className="me-2 flex items-center gap-3 text-body-2-semibold tabular">
              <span className="flex items-center gap-1 text-status-lime-text">
                <RiCheckboxCircleLine className="size-4" aria-hidden />
                {sessionCorrect}
              </span>
              <span className="flex items-center gap-1 text-status-rose-text">
                <RiCloseCircleLine className="size-4" aria-hidden />
                {sessionWrong}
              </span>
            </div>
          ) : null}
          <Button size="small" variant="secondary" onClick={() => setSheetOpen(true)} className="xl:hidden">
            题卡 {session.currentIndex + 1}/{session.questionIds.length}
          </Button>
          <div className="ms-auto flex items-center gap-2">
            <Button
              size="medium"
              variant="secondary"
              leadingIcon={RiArrowLeftLine}
              isDisabled={session.currentIndex === 0}
              onClick={() => session && actions.moveQuestion(session.currentIndex - 1)}
            >
              上一题
            </Button>
            {question.type === "multiple" && !study && !locked ? (
              <Button size="medium" isDisabled={selected.length === 0} onClick={submitMultipleAnswer}>
                提交答案
              </Button>
            ) : null}
            <Button
              size="medium"
              variant={question.type === "multiple" && !study && !locked ? "secondary" : "primary"}
              trailingIcon={RiArrowRightLine}
              isDisabled={question.type === "multiple" && !study && !locked}
              onClick={next}
            >
              {isLast ? "完成练习" : "下一题"}
            </Button>
          </div>
        </div>
      </div>

      <Drawer isOpen={sheetOpen} onOpenChange={setSheetOpen} placement="bottom" aria-label="题卡">
        <DrawerHeader title="题卡" description={`${session.title} · 点击题号跳转`} />
        <DrawerBody className="p-4">{sheet}</DrawerBody>
      </Drawer>
    </div>
  );
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
        <Button size="small" variant="secondary" leadingIcon={RiShuffleLine} onClick={startDrill} isDisabled={questions.length === 0} className="sm:ms-auto">
          抽题练习
        </Button>
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
