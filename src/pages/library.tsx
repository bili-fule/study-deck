import { useEffect, useMemo, useState } from "react";
import {
  RiExternalLinkLine,
  RiLightbulbFlashLine,
  RiPlayCircleLine,
  RiRefreshLine,
  RiSearchLine,
} from "@remixicon/react";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { Select, SelectItem } from "@/components/base/select/select";
import { Chip } from "@/components/base/badges/chip";
import { Tabs, TabList, Tab } from "@/components/base/tabs/tabs";
import { toast } from "@/components/base/toast/toast";
import { useStore } from "@/store/app-store";
import { cardsForBank, getQuestion } from "@/lib/bank";
import { navigate } from "@/lib/router";
import { percent } from "@/lib/scoring";
import type { BankChapter } from "@/lib/types";
import { EmptyState, Panel, PageHeader, ProgressRow, SectionHeading } from "@/ui/common";

export function BankPage() {
  const { projection, actions, activeBank } = useStore();
  const [category, setCategory] = useState("");
  const [search, setSearch] = useState("");
  const categories = useMemo(() => [...new Set(activeBank.chapters.map((chapter) => chapter.category))], [activeBank]);
  const normalized = search.trim();

  const chapters = activeBank.chapters.filter(
    (chapter) =>
      (!category || chapter.category === category) &&
      (!normalized || chapter.title.includes(normalized)),
  );
  const questionResults = normalized
    ? activeBank.questions.filter((question) => question.stem.includes(normalized) || question.sourceTitle.includes(normalized)).slice(0, 30)
    : [];

  function startChapter(chapter: BankChapter) {
    const created = actions.startSession({
      kind: "practice",
      mode: "chapter",
      bankId: activeBank.bankId,
      chapterId: chapter.chapterId,
      count: chapter.questionCount,
      title: chapter.title,
    });
    if (!created) {
      toast.error("无法开始该章节");
      return;
    }
    navigate("/session");
  }

  return (
    <div className="animate-rise flex flex-col gap-6">
      <PageHeader
        eyebrow="Question bank"
        title="题库浏览"
        description={`${activeBank.title} · ${activeBank.collected} 题 / ${activeBank.chapters.length} 个来源章节。${activeBank.coverageNote}`}
        actions={
          <Button leadingIcon={RiPlayCircleLine} onClick={() => navigate("/practice")}>
            开始练习
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Panel className="p-4">
          <p className="text-caption-1-medium text-text-tertiary">已采集</p>
          <p className="mt-1 text-title-2-semibold text-text-primary tabular">{activeBank.collected}</p>
        </Panel>
        <Panel className="p-4">
          <p className="text-caption-1-medium text-text-tertiary">题型分布</p>
          <p className="mt-1 text-body-2-semibold text-text-primary">
            单选 {activeBank.stats.single} · 判断 {activeBank.stats.judgment} · 多选 {activeBank.stats.multiple}
          </p>
        </Panel>
        <Panel className="p-4">
          <p className="text-caption-1-medium text-text-tertiary">已覆盖</p>
          <p className="mt-1 text-title-2-semibold text-text-primary tabular">{percent(projection.attempted, activeBank.collected)}%</p>
        </Panel>
      </div>

      <Panel className="flex flex-col gap-3 p-4 sm:flex-row sm:items-end">
        <Input
          label="搜索题目"
          value={search}
          onChange={(value) => setSearch(value)}
          leadingIcon={RiSearchLine}
          placeholder="输入题干或来源文件"
          className="flex-1"
        />
        <Select
          label="分类"
          className="sm:w-52"
          selectedKey={category || "all"}
          onSelectionChange={(key) => setCategory(String(key) === "all" ? "" : String(key))}
        >
          <SelectItem id="all">全部分类</SelectItem>
          {categories.map((item) => (
            <SelectItem id={item} key={item}>
              {item}
            </SelectItem>
          ))}
        </Select>
      </Panel>

      {normalized ? (
        <Panel className="p-5 sm:p-6">
          <SectionHeading title={`搜索结果 · ${questionResults.length}`} description="最多显示 30 条；点击章节卡可按来源练习。" />
          {questionResults.length === 0 ? (
            <p className="py-8 text-center text-body-2-regular text-text-tertiary">没有匹配的题目。</p>
          ) : (
            <div className="flex flex-col divide-y divide-separator-border">
              {questionResults.map((question) => (
                <div key={question.questionId} className="py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Chip color="neutral" variant="caption">
                      {question.type === "judgment" ? "判断" : question.type === "multiple" ? "多选" : "单选"}
                    </Chip>
                    <span className="truncate text-caption-1-medium text-text-tertiary">{question.sourceTitle}</span>
                  </div>
                  <p className="mt-1.5 text-body-2-medium text-text-primary">{question.stem}</p>
                  <p className="mt-1 text-caption-1-medium text-text-secondary">官方答案：{question.answerText.join(" / ")}</p>
                </div>
              ))}
            </div>
          )}
        </Panel>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {chapters.map((chapter) => {
          const questions = activeBank.questions.filter((question) => question.chapterId === chapter.chapterId);
          const attempted = questions.filter((question) => (projection.statsByQuestion.get(question.questionId)?.attempts ?? 0) > 0).length;
          const attempts = questions.reduce((sum, question) => sum + (projection.statsByQuestion.get(question.questionId)?.attempts ?? 0), 0);
          const correct = questions.reduce((sum, question) => sum + (projection.statsByQuestion.get(question.questionId)?.correct ?? 0), 0);
          return (
            <Panel key={chapter.chapterId} className="flex flex-col p-5">
              <div className="flex items-start justify-between gap-2">
                <Chip color={chapter.category === "学籍管理" ? "blue" : chapter.category === "评优资助" ? "purple" : chapter.category === "校规校纪" ? "orange" : "neutral"} variant="caption">
                  {chapter.category}
                </Chip>
                <span className="text-caption-1-medium text-text-tertiary tabular">{questions.length} 题</span>
              </div>
              <h2 className="mt-3 text-body-semibold leading-relaxed text-text-primary">{chapter.title}</h2>
              <div className="mt-4">
                <ProgressRow label="覆盖率" meta={`${attempted}/${questions.length} · ${attempts ? percent(correct, attempts) : 0}% 正确`} value={percent(attempted, questions.length)} />
              </div>
              <Button className="mt-4" size="small" variant="secondary" leadingIcon={RiPlayCircleLine} onClick={() => startChapter(chapter)}>
                练这一章
              </Button>
            </Panel>
          );
        })}
      </div>

      <Panel className="flex flex-col gap-2 p-5 text-body-2-regular text-text-secondary sm:flex-row sm:items-center sm:justify-between">
        <p>题目 ID 与选项 ID 均由内容哈希生成，选项顺序变化不会改变 ID 或历史答案的含义。</p>
        <a
          className="inline-flex items-center gap-1 text-caption-1-semibold text-accent-600 hover:text-accent-700"
          href={activeBank.sourceUrl}
          target="_blank"
          rel="noreferrer"
        >
          官方来源
          <RiExternalLinkLine className="size-3.5" aria-hidden />
        </a>
      </Panel>
    </div>
  );
}

export function CardsPage() {
  const { projection, actions, activeBank } = useStore();
  const [mode, setMode] = useState("due");
  const [category, setCategory] = useState("");
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const bankCards = cardsForBank(activeBank.bankId);
  const categories = useMemo(() => [...new Set(bankCards.map((card) => card.category))], [bankCards]);
  const cards = bankCards.filter(
    (card) =>
      (!category || card.category === category) &&
      (mode === "all" || projection.dueCardIds.includes(card.cardId)),
  );
  const card = cards[Math.min(index, Math.max(0, cards.length - 1))];

  useEffect(() => {
    setIndex(0);
    setRevealed(false);
  }, [mode, category]);

  if (!card) {
    return (
      <div className="animate-rise flex flex-col gap-6">
        <PageHeader eyebrow="Knowledge cards" title="知识卡" description="由官方题库事实整理，卡片只陈述题库能够直接支持的内容。" />
        <Panel>
          <EmptyState
            icon={RiLightbulbFlashLine}
            title={mode === "due" ? "到期卡片已清空" : "这个分类没有卡片"}
            description="切换到“全部卡片”继续复习，或去做一轮错题。"
            actionLabel="查看全部卡片"
            onAction={() => {
              setMode("all");
              setCategory("");
            }}
          />
        </Panel>
      </div>
    );
  }

  const linked = card.questionIds.map((id) => getQuestion(id)).filter((question): question is NonNullable<typeof question> => Boolean(question));

  function rate(rating: "again" | "hard" | "good" | "easy") {
    if (!card) return;
    actions.rateCard(card.cardId, rating);
    setRevealed(false);
    if (index >= cards.length - 1) setIndex(0);
    toast.success("已记录复习", { description: `${card.title} · ${rating === "again" ? "再来一次" : rating === "hard" ? "有点难" : rating === "good" ? "记得" : "很简单"}` });
  }

  return (
    <div className="animate-rise flex flex-col gap-6">
      <PageHeader
        eyebrow="Knowledge cards"
        title="知识卡"
        description={`${bankCards.length} 张卡片，覆盖 ${bankCards.reduce((sum, item) => sum + item.questionIds.length, 0)} 条题目关联。所有事实均来自官方题库。`}
        actions={
          <Button variant="secondary" leadingIcon={RiRefreshLine} onClick={() => actions.resetCardState(card.cardId)}>
            重置本卡进度
          </Button>
        }
      />

      <div className="flex flex-wrap items-end gap-3">
        <Tabs selectedKey={mode} onSelectionChange={(key) => setMode(String(key))} className="w-auto">
          <TabList aria-label="卡片筛选">
            <Tab id="due">待复习 {projection.dueCardIds.length}</Tab>
            <Tab id="all">全部 {bankCards.length}</Tab>
          </TabList>
        </Tabs>
        <Select label="分类" className="w-48" selectedKey={category || "all"} onSelectionChange={(key) => setCategory(String(key) === "all" ? "" : String(key))}>
          <SelectItem id="all">全部分类</SelectItem>
          {categories.map((item) => (
            <SelectItem id={item} key={item}>
              {item}
            </SelectItem>
          ))}
        </Select>
        <p className="ms-auto text-caption-1-medium text-text-tertiary">
          {cards.length} 张 · 第 {Math.min(index + 1, cards.length)} 张
        </p>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
        <Panel className="flex min-h-[340px] flex-col p-6 sm:p-8">
          <div className="flex items-center justify-between gap-3">
            <Chip color="purple" variant="caption">
              {card.category}
            </Chip>
            <span className="text-caption-1-medium text-text-tertiary">
              {projection.cardStates.get(card.cardId)?.reps ?? 0} 次复习
            </span>
          </div>
          <h1 className="mt-6 text-title-1-semibold leading-tight text-text-primary">{card.title}</h1>
          <p className="mt-3 text-body-regular text-text-secondary">{card.prompt}</p>

          {!revealed ? (
            <div className="mt-6 flex flex-1 flex-col justify-end">
              <div className="rounded-2xl bg-background-secondary-default p-4">
                <p className="text-caption-1-medium text-text-tertiary">先在心里回答，再展开核对。</p>
              </div>
              <Button className="mt-4" onClick={() => setRevealed(true)}>
                显示答案
              </Button>
            </div>
          ) : (
            <div className="mt-6 flex flex-1 flex-col">
              <div className="rounded-2xl border border-accent-200 bg-accent-50 p-4">
                <p className="text-body-semibold text-text-primary">{card.summary}</p>
                <ul className="mt-3 flex list-disc flex-col gap-1.5 ps-5 text-body-2-regular text-text-secondary">
                  {card.facts.map((fact) => (
                    <li key={fact}>{fact}</li>
                  ))}
                </ul>
              </div>
              <div className="mt-3 rounded-2xl bg-status-rose-background p-3 text-body-2-regular text-status-rose-text">
                易错点：{card.misconception}
              </div>
              <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Button size="small" variant="secondary" onClick={() => rate("again")}>再来一次</Button>
                <Button size="small" variant="secondary" onClick={() => rate("hard")}>有点难</Button>
                <Button size="small" onClick={() => rate("good")}>记得</Button>
                <Button size="small" variant="secondary" onClick={() => rate("easy")}>很简单</Button>
              </div>
            </div>
          )}
        </Panel>

        <div className="flex flex-col gap-4">
          <Panel className="p-5">
            <SectionHeading title="关联题目" description={`${linked.length} 道官方题直接支持这张卡`} />
            <div className="flex flex-col gap-3">
              {linked.map((question) => (
                <div key={question.questionId} className="rounded-xl bg-background-secondary-default p-3">
                  <p className="text-body-2-medium text-text-primary">{question.stem}</p>
                  <p className="mt-1 text-caption-1-medium text-text-tertiary">官方答案：{question.answerText.join(" / ")}</p>
                  <p className="mt-0.5 text-caption-2-medium text-text-tertiary">{question.sourceTitle}</p>
                </div>
              ))}
            </div>
          </Panel>
          <Panel className="p-5">
            <SectionHeading title="复习状态" />
            <div className="grid grid-cols-2 gap-3 text-body-2-regular">
              <div className="rounded-xl bg-background-secondary-default p-3">
                <p className="text-caption-1-medium text-text-tertiary">下次到期</p>
                <p className="mt-1 text-body-2-semibold text-text-primary">
                  {projection.cardStates.get(card.cardId)
                    ? new Date(projection.cardStates.get(card.cardId)!.dueAt).toLocaleDateString("zh-CN")
                    : "现在"}
                </p>
              </div>
              <div className="rounded-xl bg-background-secondary-default p-3">
                <p className="text-caption-1-medium text-text-tertiary">易度</p>
                <p className="mt-1 text-body-2-semibold text-text-primary tabular">
                  {projection.cardStates.get(card.cardId)?.ease.toFixed(2) ?? "2.50"}
                </p>
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
