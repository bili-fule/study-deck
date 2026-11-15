import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const compiler = join(root, "scripts", "build-bank.mjs");

function compile(fixture) {
  const dir = mkdtempSync(join(tmpdir(), "studydeck-import-"));
  const sources = join(dir, "sources");
  mkdirSync(sources);
  writeFileSync(join(sources, "manifest.json"), JSON.stringify(fixture.manifest));
  writeFileSync(join(sources, fixture.file), JSON.stringify(fixture.source));
  const result = spawnSync(process.execPath, [compiler], {
    encoding: "utf8",
    env: { ...process.env, STUDY_DECK_SOURCES_DIR: sources, STUDY_DECK_OUTPUT_DIR: dir },
  });
  const bundlePath = join(dir, "bank.bundle.json");
  const catalogPath = join(dir, "catalog.json");
  let bundle = null;
  let catalog = null;
  if (result.status === 0) {
    bundle = JSON.parse(readFileSync(bundlePath, "utf8"));
    catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
  }
  rmSync(dir, { recursive: true, force: true });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, bundle, catalog };
}

const baseManifest = {
  banks: [
    {
      file: "bank.json",
      bankId: "bank_fixture",
      title: "Fixture",
      expectedTotal: 1,
    },
  ],
};

const baseQuestion = {
  number: 1,
  question: "（测试章程） 理论课一般以（ ）计 1 个学分。",
  options: ["A.16学时", "B.32学时"],
  answer: "A",
  answerText: ["16学时"],
};

const direct = compile({ manifest: baseManifest, file: "bank.json", source: { questions: [baseQuestion] } });
if (direct.status !== 0) throw new Error(`direct fixture failed: ${direct.stderr}`);

const reordered = compile({
  manifest: baseManifest,
  file: "bank.json",
  source: {
    questions: [
      {
        ...baseQuestion,
        options: ["A.32学时", "B.16学时"],
        answer: "B",
        answerText: ["16学时"],
      },
    ],
  },
});
if (reordered.status !== 0) throw new Error(`reordered fixture failed: ${reordered.stderr}`);

const original = direct.bundle.banks[0].questions[0];
const changed = reordered.bundle.banks[0].questions[0];
if (original.questionId !== changed.questionId) {
  throw new Error(`questionId changed after option reorder: ${original.questionId} -> ${changed.questionId}`);
}
const keyText = (question) =>
  question.answerKey.map((id) => question.options.find((option) => option.id === id)?.text).join(",");
if (keyText(original) !== "16学时" || keyText(changed) !== "16学时") {
  throw new Error(`answer content drifted after option reorder: ${keyText(original)} / ${keyText(changed)}`);
}

const generic = compile({
  manifest: { ...baseManifest, banks: [{ ...baseManifest.banks[0], expectedTotal: 2, defaultChapterTitle: "通用章节" }] },
  file: "bank.json",
  source: {
    questions: [
      { question: "无来源前缀的题目。", options: ["A.甲", "B.乙"], answer: "A", answerText: ["甲"] },
      {
        question: "显式多选题，只有一个正确答案也可以。",
        type: "multiple",
        options: ["A.甲", "B.乙", "C.丙"],
        answer: "B",
        answerText: ["乙"],
      },
    ],
  },
});
if (generic.status !== 0) throw new Error(`generic fixture failed: ${generic.stderr}`);
if (generic.bundle.banks[0].questions.length !== 2) throw new Error("generic fixture question count mismatch");
if (generic.bundle.banks[0].questions[0].sourceTitle !== "通用章节") {
  throw new Error(`generic source fallback mismatch: ${generic.bundle.banks[0].questions[0].sourceTitle}`);
}
if (generic.bundle.banks[0].questions[1].type !== "multiple") {
  throw new Error("explicit multiple type was not respected");
}

const badAnswerText = compile({
  manifest: baseManifest,
  file: "bank.json",
  source: { questions: [{ ...baseQuestion, answer: "A", answerText: ["32学时"] }] },
});
if (badAnswerText.status === 0) throw new Error("answerText/answerKey mismatch was accepted");

console.log("Importer edge tests OK");
console.log("  option reorder: stable questionId + content-stable answerKey");
console.log("  generic no-prefix question: accepted with explicit/default chapter");
console.log("  explicit multiple type: respected with one correct option");
console.log("  answerText mismatch: rejected");
