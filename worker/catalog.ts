import rawCatalog from "../data/catalog.json";

export type QuestionType = "single" | "judgment" | "multiple";

export interface CatalogQuestion {
  questionId: string;
  bankId: string;
  chapterId: string;
  type: QuestionType;
  /** Content-stable option ids in current display order. */
  optionKeys: readonly string[];
  optionKeySet: ReadonlySet<string>;
  answerKey: readonly string[];
  answerKeySet: ReadonlySet<string>;
}

export interface CatalogBank {
  bankId: string;
  title: string;
  questionCount: number;
}

export interface CatalogChapter {
  bankId: string;
  chapterId: string;
  title: string;
  category?: string;
}

interface RawQuestion {
  questionId: string;
  bankId: string;
  chapterId: string;
  type: QuestionType;
  optionKeys: string[];
  answerKey: string[];
}

interface RawBank {
  bankId: string;
  title: string;
  questionCount: number;
}

interface RawChapter {
  bankId: string;
  chapterId: string;
  title: string;
  category?: string;
}

interface RawCatalog {
  schemaVersion?: number;
  generatedAt?: string;
  banks?: RawBank[];
  chapters?: RawChapter[];
  questions?: RawQuestion[];
}

const QUESTION_TYPES: readonly QuestionType[] = ["single", "judgment", "multiple"];
const ID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;

export const catalogQuestionKey = (bankId: string, questionId: string): string =>
  `${bankId}\u0000${questionId}`;

export const catalogChapterKey = (bankId: string, chapterId: string): string =>
  `${bankId}\u0000${chapterId}`;

function fail(message: string): never {
  throw new Error(`Invalid data/catalog.json: ${message}`);
}

function buildCatalog(raw: RawCatalog) {
  if (raw.schemaVersion !== 1) fail("schemaVersion must be 1");
  if (!Array.isArray(raw.banks) || raw.banks.length === 0) fail("banks must be a non-empty array");
  if (!Array.isArray(raw.questions) || raw.questions.length === 0) {
    fail("questions must be a non-empty array");
  }
  if (typeof raw.generatedAt !== "string" || !Number.isFinite(Date.parse(raw.generatedAt))) {
    fail("generatedAt must be an ISO-8601 timestamp");
  }

  const banks = new Map<string, CatalogBank>();
  for (const bank of raw.banks) {
    if (typeof bank.bankId !== "string" || !ID_PATTERN.test(bank.bankId)) {
      fail(`invalid bankId ${JSON.stringify(bank.bankId)}`);
    }
    if (banks.has(bank.bankId)) fail(`duplicate bankId ${bank.bankId}`);
    if (typeof bank.title !== "string" || bank.title.trim() === "") {
      fail(`bank ${bank.bankId} is missing a title`);
    }
    if (!Number.isInteger(bank.questionCount) || bank.questionCount < 0) {
      fail(`bank ${bank.bankId} has an invalid questionCount`);
    }
    banks.set(bank.bankId, {
      bankId: bank.bankId,
      title: bank.title,
      questionCount: bank.questionCount,
    });
  }

  const questions = new Map<string, CatalogQuestion>();
  const countsByBank = new Map<string, number>();
  for (const question of raw.questions) {
    if (typeof question.questionId !== "string" || !ID_PATTERN.test(question.questionId)) {
      fail(`invalid questionId ${JSON.stringify(question.questionId)}`);
    }
    if (typeof question.bankId !== "string" || !banks.has(question.bankId)) {
      fail(`question ${question.questionId} references unknown bank ${JSON.stringify(question.bankId)}`);
    }
    if (typeof question.chapterId !== "string" || question.chapterId.trim() === "") {
      fail(`question ${question.questionId} is missing chapterId`);
    }
    if (!QUESTION_TYPES.includes(question.type)) {
      fail(`question ${question.questionId} has unsupported type ${JSON.stringify(question.type)}`);
    }
    if (!Array.isArray(question.optionKeys) || question.optionKeys.length === 0) {
      fail(`question ${question.questionId} is missing optionKeys`);
    }
    const optionKeySet = new Set<string>();
    for (const option of question.optionKeys) {
      if (typeof option !== "string" || !ID_PATTERN.test(option)) {
        fail(`question ${question.questionId} has an invalid option id`);
      }
      if (optionKeySet.has(option)) {
        fail(`question ${question.questionId} has duplicate option ${option}`);
      }
      optionKeySet.add(option);
    }
    if (!Array.isArray(question.answerKey) || question.answerKey.length === 0) {
      fail(`question ${question.questionId} is missing answerKey`);
    }
    const answerKeySet = new Set<string>();
    for (const answer of question.answerKey) {
      if (!optionKeySet.has(answer)) {
        fail(`question ${question.questionId} answer ${answer} is not in optionKeys`);
      }
      if (answerKeySet.has(answer)) {
        fail(`question ${question.questionId} has duplicate answer key ${answer}`);
      }
      answerKeySet.add(answer);
    }
    if (question.type !== "multiple" && question.answerKey.length !== 1) {
      fail(`question ${question.questionId} (${question.type}) must have exactly one answer`);
    }
    const key = catalogQuestionKey(question.bankId, question.questionId);
    if (questions.has(key)) fail(`duplicate question ${question.questionId}`);
    questions.set(key, {
      questionId: question.questionId,
      bankId: question.bankId,
      chapterId: question.chapterId,
      type: question.type,
      optionKeys: question.optionKeys,
      optionKeySet,
      answerKey: question.answerKey,
      answerKeySet,
    });
    countsByBank.set(question.bankId, (countsByBank.get(question.bankId) ?? 0) + 1);
  }

  for (const bank of banks.values()) {
    const actual = countsByBank.get(bank.bankId) ?? 0;
    if (actual !== bank.questionCount) {
      fail(
        `bank ${bank.bankId} declares questionCount=${bank.questionCount} but catalog has ${actual} questions`,
      );
    }
  }

  const chapters = new Map<string, CatalogChapter>();
  if (raw.chapters !== undefined) {
    if (!Array.isArray(raw.chapters)) fail("chapters must be an array");
    for (const chapter of raw.chapters) {
      if (typeof chapter.bankId !== "string" || !banks.has(chapter.bankId)) {
        fail(`chapter references unknown bank ${JSON.stringify(chapter.bankId)}`);
      }
      if (typeof chapter.chapterId !== "string" || chapter.chapterId.trim() === "") {
        fail(`chapter in bank ${chapter.bankId} is missing chapterId`);
      }
      if (typeof chapter.title !== "string" || chapter.title.trim() === "") {
        fail(`chapter ${chapter.chapterId} is missing a title`);
      }
      const key = catalogChapterKey(chapter.bankId, chapter.chapterId);
      if (chapters.has(key)) fail(`duplicate chapter ${chapter.chapterId}`);
      chapters.set(key, {
        bankId: chapter.bankId,
        chapterId: chapter.chapterId,
        title: chapter.title,
        category: typeof chapter.category === "string" ? chapter.category : undefined,
      });
    }
  }

  return {
    schemaVersion: 1 as const,
    generatedAt: raw.generatedAt,
    banks,
    questions,
    chapters,
    bankCount: banks.size,
    questionCount: questions.size,
    getBank: (bankId: string): CatalogBank | undefined => banks.get(bankId),
    getQuestion: (bankId: string, questionId: string): CatalogQuestion | undefined =>
      questions.get(catalogQuestionKey(bankId, questionId)),
    getChapter: (bankId: string, chapterId: string): CatalogChapter | undefined =>
      chapters.get(catalogChapterKey(bankId, chapterId)),
  };
}

export const catalog = buildCatalog(rawCatalog as unknown as RawCatalog);

/** Set-equality scoring over content-stable option ids. */
export function isAnswerCorrect(
  question: CatalogQuestion,
  selected: readonly string[],
): boolean {
  if (selected.length !== question.answerKey.length) return false;
  const unique = new Set(selected);
  if (unique.size !== selected.length) return false;
  for (const answer of question.answerKey) {
    if (!unique.has(answer)) return false;
  }
  return true;
}
