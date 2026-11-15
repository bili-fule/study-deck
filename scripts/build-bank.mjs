import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const sourcesDir = process.env.STUDY_DECK_SOURCES_DIR
  ? resolve(process.env.STUDY_DECK_SOURCES_DIR)
  : join(root, "data", "sources");
const outputDir = process.env.STUDY_DECK_OUTPUT_DIR
  ? resolve(process.env.STUDY_DECK_OUTPUT_DIR)
  : join(root, "data");
const manifestPath = join(sourcesDir, "manifest.json");
const outputBundle = join(outputDir, "bank.bundle.json");
const outputCatalog = join(outputDir, "catalog.json");

const errors = [];
const warnings = [];

function fail(message) {
  errors.push(message);
}

function normalize(text) {
  return text.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function sha1(text) {
  return createHash("sha1").update(text, "utf8").digest("hex");
}

function splitSourcePrefix(raw) {
  const text = normalize(raw);
  if (!text.startsWith("（")) return { source: "", stem: text };
  // A leading full-width parenthetical is the exam bank's per-question source
  // label. Generic imported banks may omit it and use explicit metadata below.
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "（") depth += 1;
    else if (ch === "）") {
      depth -= 1;
      if (depth === 0) {
        return {
          source: text.slice(1, i).trim(),
          stem: text.slice(i + 1).trim(),
        };
      }
    }
  }
  fail(`Unbalanced source parentheses: ${text.slice(0, 80)}`);
  return { source: "", stem: text };
}

function parseOptions(rawOptions) {
  return rawOptions.map((raw, index) => {
    const match = /^([A-Z])\s*[.．、:：]\s*(.*)$/.exec(normalize(raw));
    if (!match) {
      fail(`Cannot parse option label: ${raw}`);
      return { label: String.fromCharCode(65 + index), text: normalize(raw) };
    }
    return { label: match[1], text: normalize(match[2]) };
  });
}

function stableOptionId(text, used) {
  const base = `o_${sha1(text).slice(0, 10)}`;
  let id = base;
  let suffix = 2;
  while (used.has(id)) {
    id = `${base}_${suffix}`;
    suffix += 1;
  }
  used.add(id);
  return id;
}

function classifyCategory(source) {
  if (/(军事|国防|入伍|服役|退役|军训|征兵)/.test(source)) return "军事国防";
  if (/(奖助学金|奖学金|助学金|资助|贷款|勤工助学|评优|评奖|优秀毕业生|三好学生|先进班集体|优秀学生骨干|优秀青年志愿者|综合素质测评)/.test(source)) return "评优资助";
  if (/(学籍|学分|课程|考试|成绩|学位|毕业|修读|转专业|选课|注册|休学|复学|退学|预警|修业)/.test(source)) return "学籍管理";
  if (/(违纪|处分|申诉|学生证|校园网|学费|住宿费|章程|考勤|学生管理)/.test(source)) return "校规校纪";
  return "综合";
}

function buildBank(entry) {
  const filePath = join(sourcesDir, entry.file);
  let source;
  try {
    source = JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    fail(`Cannot read ${entry.file}: ${error.message}`);
    return null;
  }
  if (!Array.isArray(source.questions)) {
    fail(`${entry.file} has no questions array`);
    return null;
  }

  const chapterMap = new Map();
  const questions = [];
  const seenIds = new Map();

  for (const [index, raw] of source.questions.entries()) {
    const hasExplicitMetadata = Boolean(
      raw.sourceTitle || raw.source || raw.chapter || raw.chapterId,
    );
    const split = hasExplicitMetadata
      ? { source: "", stem: normalize(raw.question ?? "") }
      : splitSourcePrefix(raw.question ?? "");
    const explicitChapter = typeof raw.chapter === "string" ? normalize(raw.chapter) : "";
    const explicitSource = raw.sourceTitle ?? raw.source;
    const chapterTitle = normalize(
      explicitChapter || split.source || entry.defaultChapterTitle || explicitSource || "综合练习",
    );
    const sourceTitle = normalize(
      explicitSource || split.source || explicitChapter || entry.defaultChapterTitle || "综合练习",
    );
    const chapterCategory = normalize(
      (typeof raw.category === "string" ? raw.category : "") ||
        entry.defaultCategory ||
        classifyCategory(chapterTitle),
    );
    const stem = split.stem;
    if (!stem) fail(`${entry.file} #${index + 1}: empty question body`);
    if (raw.type !== undefined && !["single", "judgment", "multiple"].includes(raw.type)) {
      fail(`${entry.file} #${index + 1}: invalid explicit type ${raw.type}`);
    }

    const parsedOptions = parseOptions(raw.options ?? []);
    if (parsedOptions.length < 2) fail(`${entry.file} #${index + 1}: fewer than 2 options`);
    const optionTexts = parsedOptions.map((option) => option.text);
    if (new Set(optionTexts).size !== optionTexts.length) {
      fail(`${entry.file} #${index + 1}: duplicate option text`);
    }

    const sortedOptionKey = [...optionTexts].sort().join("\u0000");
    const questionId = `q_${sha1([entry.bankId, sourceTitle, stem, sortedOptionKey].join("\u0000")).slice(0, 12)}`;
    if (seenIds.has(questionId)) {
      fail(
        `${entry.file}: duplicate questionId ${questionId} — "${stem.slice(0, 40)}" collides with #${seenIds.get(questionId)}`,
      );
    }
    seenIds.set(questionId, index + 1);

    const chapterId =
      raw.chapterId ?? `ch_${sha1(`${entry.bankId}\u0000${chapterTitle}`).slice(0, 10)}`;
    if (!chapterMap.has(chapterId)) {
      chapterMap.set(chapterId, {
        chapterId,
        bankId: entry.bankId,
        title: chapterTitle,
        category: chapterCategory,
        questionCount: 0,
      });
    }

    const used = new Set();
    const options = parsedOptions.map((option) => ({
      id: stableOptionId(option.text, used),
      label: option.label,
      text: option.text,
    }));
    const optionKeys = options.map((option) => option.id);

    const answerLetters = String(raw.answer ?? "").replace(/[^A-Z]/g, "").split("").filter(Boolean);
    if (answerLetters.length === 0) fail(`${entry.file} #${index + 1}: missing answer`);
    const answerKey = [];
    for (const letter of answerLetters) {
      const option = options.find((candidate) => candidate.label === letter);
      if (!option) {
        fail(`${entry.file} #${index + 1}: answer ${letter} has no matching option`);
        continue;
      }
      if (answerKey.includes(option.id)) continue;
      answerKey.push(option.id);
    }

    const answerText = (raw.answerText ?? []).map(normalize);
    const answerTextSet = [...new Set(answerText)].sort();
    const keyTextSet = answerKey
      .map((id) => options.find((option) => option.id === id)?.text ?? "")
      .sort();
    if (JSON.stringify(answerTextSet) !== JSON.stringify(keyTextSet)) {
      fail(
        `${entry.file} #${index + 1}: answerText ${JSON.stringify(answerTextSet)} does not match answerKey texts ${JSON.stringify(keyTextSet)}`,
      );
    }

    const isJudgment =
      options.length === 2 && options.every((option) => ["对", "错", "正确", "错误"].includes(option.text));
    const type = raw.type ?? (isJudgment ? "judgment" : answerKey.length > 1 ? "multiple" : "single");
    if (type === "judgment" && options.length !== 2) {
      fail(`${entry.file} #${index + 1}: judgment type needs exactly 2 options`);
    }
    if (type === "single" && answerKey.length > 1) {
      fail(`${entry.file} #${index + 1}: single type has ${answerKey.length} correct options`);
    }
    if (type === "multiple" && options.length < 2) {
      fail(`${entry.file} #${index + 1}: multiple type needs at least 2 options`);
    }

    const chapter = chapterMap.get(chapterId);
    chapter.questionCount += 1;

    questions.push({
      questionId,
      bankId: entry.bankId,
      chapterId,
      order: questions.length,
      type,
      stem,
      options,
      optionKeys,
      answerKey,
      answerText,
      sourceTitle,
      score: raw.score ?? null,
      rounds: raw.rounds ?? [],
      occurrences: raw.occurrences ?? null,
    });
  }

  const chapters = [...chapterMap.values()];
  const stats = {
    single: questions.filter((q) => q.type === "single").length,
    judgment: questions.filter((q) => q.type === "judgment").length,
    multiple: questions.filter((q) => q.type === "multiple").length,
  };

  return {
    bankId: entry.bankId,
    title: entry.title,
    shortTitle: entry.shortTitle ?? entry.title,
    description: entry.description ?? "",
    sourceUrl: entry.sourceUrl ?? "",
    expectedTotal: typeof entry.expectedTotal === "number" ? entry.expectedTotal : null,
    collected: questions.length,
    coverageNote:
      entry.coverageNote ??
      (typeof entry.expectedTotal === "number" && entry.expectedTotal !== questions.length
        ? `官方总数 ${entry.expectedTotal}，已采集 ${questions.length}。`
        : ""),
    rounds: Array.isArray(source.rounds) ? source.rounds : [],
    stats,
    chapters,
    questions,
  };
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
if (!Array.isArray(manifest.banks) || manifest.banks.length === 0) {
  fail("manifest.json must contain a non-empty banks array");
}

const banks = [];
const bankIds = new Set();
for (const entry of manifest.banks ?? []) {
  if (bankIds.has(entry.bankId)) fail(`duplicate bankId ${entry.bankId}`);
  bankIds.add(entry.bankId);
  const bank = buildBank(entry);
  if (bank) banks.push(bank);
}

const allQuestions = banks.flatMap((bank) => bank.questions);
const questionIds = new Set();
for (const question of allQuestions) {
  if (questionIds.has(question.questionId)) fail(`duplicate questionId ${question.questionId}`);
  questionIds.add(question.questionId);
  if (question.answerKey.some((id) => !question.optionKeys.includes(id))) {
    fail(`${question.questionId}: answerKey contains an unknown option id`);
  }
}

const unusedFiles = readdirSync(sourcesDir).filter(
  (file) => /\.json$/i.test(file) && file !== "manifest.json" && !manifest.banks.some((bank) => bank.file === file),
);
for (const file of unusedFiles) warnings.push(`Unregistered source file ignored: ${file}`);

if (errors.length > 0) {
  console.error(`Bank compile failed with ${errors.length} error(s):`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

const generatedAt = new Date().toISOString();
const bundle = {
  schemaVersion: 1,
  generatedAt,
  banks,
};
const catalog = {
  schemaVersion: 1,
  generatedAt,
  banks: banks.map((bank) => ({
    bankId: bank.bankId,
    title: bank.title,
    questionCount: bank.collected,
  })),
  chapters: banks.flatMap((bank) =>
    bank.chapters.map((chapter) => ({
      bankId: bank.bankId,
      chapterId: chapter.chapterId,
      title: chapter.title,
      category: chapter.category,
    })),
  ),
  questions: allQuestions.map((question) => ({
    questionId: question.questionId,
    bankId: question.bankId,
    chapterId: question.chapterId,
    type: question.type,
    optionKeys: question.optionKeys,
    answerKey: question.answerKey,
  })),
};

mkdirSync(dirname(outputBundle), { recursive: true });
writeFileSync(outputBundle, `${JSON.stringify(bundle, null, 2)}\n`);
writeFileSync(outputCatalog, `${JSON.stringify(catalog, null, 2)}\n`);

console.log("Bank compile OK");
for (const bank of banks) {
  console.log(
    `  ${bank.bankId}: ${bank.collected} questions · ${bank.chapters.length} chapters · ` +
      `${bank.stats.single} single / ${bank.stats.judgment} judgment / ${bank.stats.multiple} multiple`,
  );
  if (bank.coverageNote) console.log(`  coverage: ${bank.coverageNote}`);
}
console.log(`  wrote ${outputBundle}`);
console.log(`  wrote ${outputCatalog}`);
for (const warning of warnings) console.warn(`  warning: ${warning}`);
