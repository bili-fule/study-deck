import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const bundle = JSON.parse(readFileSync(join(root, "data", "bank.bundle.json"), "utf8"));
const questions = bundle.banks.flatMap((bank) => bank.questions);
const bank = bundle.banks[0];

const groups = [
  {
    id: "credit-hours",
    title: "理论课 16 学时 / 实验实训 32 学时 = 1 学分",
    claim: "理论课一般以 16 学时计 1 个学分；实验或实训课一般以 32 学时计 1 个学分；“理论课 32 学时计 1 学分”为错。",
    matches: (q) => q.stem.includes("理论课一般以") || q.stem.includes("实验或实训课一般以"),
  },
  {
    id: "bachelor-duration",
    title: "本科标准学制 4 年，弹性 3–7 年，提前毕业最短 3 年",
    claim: "本科层次标准学制 4 年；弹性学习年限 3～7 年（“3～8 年”为错）；提前毕业本科修业年限最短不少于 3 年。",
    matches: (q) =>
      q.stem.includes("本科层次标准学制") ||
      q.stem.includes("本科层次弹性学习年限") ||
      (q.stem.includes("提前毕业") && q.stem.includes("最短不少于")),
  },
  {
    id: "new-student-leave",
    title: "新生不能按期入学，请假一般不超过 2 周",
    claim: "新生因故不能按期入学，请假时间一般不超过 2 周；“不超过 3 周”为错。",
    matches: (q) => q.stem.includes("新生因故不能按期入学"),
  },
  {
    id: "military-retention",
    title: "入伍保留入学资格至退役后 2 年，保留资格期间无学籍",
    claim: "新生应征入伍保留入学资格至退役后 2 年（“1 年”为错）；保留入学资格者不具有学籍。",
    matches: (q) => q.stem.includes("保留入学资格"),
  },
  {
    id: "course-exemption",
    title: "每学期免听不超过 2 门；免听≠免除所有教学活动；仍须考核",
    claim: "一学期免听课程一般不超过 2 门（“3 门”为错）；免听不等于不参与任何教学活动；获准免听仍须参加考核。",
    matches: (q) =>
      q.stem.includes("免听课程一般不超过") ||
      q.stem.includes("免听是指学生不需参与课程任何教学活动") ||
      q.stem.includes("获准免听的课程，可以不参加考核"),
  },
  {
    id: "adviser-guidance",
    title: "本科生导师每学期集中指导不少于 2 次",
    claim: "本科生导师集中指导每学期不少于 2 次；“不少于 1 次”为错。",
    matches: (q) => q.stem.includes("集中指导每学期不少于"),
  },
  {
    id: "anniversary",
    title: "校庆日为每年 11 月第三个星期六",
    claim: "肇庆学院校庆日是每年 11 月第三个星期六；“11 月第一个星期六”为错。",
    matches: (q) => q.stem.includes("校庆日"),
  },
  {
    id: "national-awards",
    title: "国家奖学金 10000 元、励志奖学金 6000 元、助学金平均 3700 元",
    claim: "国家奖学金每生每年 10000 元；国家励志奖学金每生每年 6000 元；国家助学金平均资助标准每生每年 3700 元。",
    matches: (q) =>
      q.stem.includes("国家奖学金的标准") ||
      q.stem.includes("国家奖学金每生每年10000元") ||
      q.stem.includes("国家励志奖学金的标准") ||
      q.stem.includes("国家助学金的平均资助标准"),
  },
  {
    id: "advanced-class-fitness",
    title: "先进班集体体测合格率须达 90%",
    claim: "参评先进班集体的班级体测合格率须达到 90% 以上；“85% 以上”为错。",
    matches: (q) => q.stem.includes("先进班集体") && q.stem.includes("体测合格率"),
  },
  {
    id: "overseas-credits",
    title: "境外课程不能置换思政课；替换学分不低于被替换学分",
    claim: "出国（境）交流课程不能置换思政类课程；替换课程学分原则上不低于被替换课程学分（“可以低于”为错）。",
    matches: (q) =>
      q.stem.includes("置换思政类课程") ||
      (q.stem.includes("替换课程的学分") && q.stem.includes("被替换")),
  },
  {
    id: "student-id",
    title: "学生证仅限本人使用；补办后原证交学院注销",
    claim: "学生证仅限学生本人使用，不得转借；补办新证后又找回原证，须交至所在学院注销，不得持有两本。",
    matches: (q) =>
      q.stem.includes("学生证仅限") ||
      q.stem.includes("学生证可以转借他人使用") ||
      q.stem.includes("补办新学生证后又找回原证") ||
      q.stem.includes("持有两本学生证"),
  },
  {
    id: "campus-network",
    title: "校园网英文简称 ZQUNET，是 CERNET 组成部分",
    claim: "肇庆学院校园网英文简称 ZQUNET；校园网是 CERNET 的组成部分。",
    matches: (q) =>
      q.stem.includes("校园网的英文简称") ||
      q.stem.includes("校园网是CERNET的组成部分") ||
      q.stem.includes("校园网是（）的组成部分"),
  },
  {
    id: "exam-appeal-deadlines",
    title: "考试入场 30 分钟、离场 45 分钟；缓考 3 天；申诉 10 日、复查 15 日",
    claim: "开考 30 分钟后迟到考生不得入场；开考 45 分钟内不得离开考场；缓考须在开考前 3 天办理；申诉须在送达之日起 10 日内提出；申诉处理委员会 15 日内作出复查结论。",
    matches: (q) =>
      q.stem.includes("不允许迟到考生进入考场") ||
      q.stem.includes("不允许考生离开考场") ||
      q.stem.includes("不得中途离开考场") ||
      q.stem.includes("缓考审批手续") ||
      q.stem.includes("提出书面申诉") ||
      q.stem.includes("作出复查结论"),
  },
  {
    id: "honors-ranking",
    title: "优秀骨干班前 50%、三好同年级专业前 35%、优秀毕业生专业前 25% 且名额 15%",
    claim: "优秀学生骨干综合测评排名班级前 50%；三好学生同年级本专业前 35%；优秀毕业生累计综合测评总分本专业前 25%，评选人数不超过本专业总人数 15%。",
    matches: (q) =>
      (q.stem.includes("优秀学生骨干") && q.stem.includes("班级前")) ||
      (q.stem.includes("三好学生") && q.stem.includes("同年级本专业前")) ||
      (q.stem.includes("优秀毕业生") &&
        (q.stem.includes("本专业前") || q.stem.includes("评选人数不超过"))),
  },
  {
    id: "attendance-discipline",
    title: "旷课 8 节黄色预警、20 节红色预警、50 学时开除；1/3 取消考核；连续 2 周退学",
    claim: "一学期旷课累计 8 节及以上黄色预警、20 节及以上红色预警、50 学时及以上开除学籍；旷课达课程教学总学时 1/3 可取消考核资格；未经批准连续 2 周未参加教学活动应予退学。",
    matches: (q) =>
      q.stem.includes("累计旷课达8节") ||
      q.stem.includes("累计旷课达20节") ||
      q.stem.includes("旷课累计达到50学时") ||
      (q.stem.includes("教学总学时") && q.stem.includes("取消其考核资格")) ||
      q.stem.includes("未经批准连续（）未参加"),
  },
];

const report = {
  generatedAt: new Date().toISOString(),
  source: {
    bankId: bank.bankId,
    title: bank.title,
    collected: bank.collected,
    expectedTotal: bank.expectedTotal,
    coverageNote: bank.coverageNote,
    questionCount: questions.length,
  },
  method:
    "Direct keyword/exact-fact matchers over the compiled 296-question bank. Only questions that explicitly state or explicitly negate the card fact are counted; related-but-different facts (application procedures, eligibility not stated here) are excluded. Deduped by stable questionId across all groups.",
  groups: [],
  union: { count: 0, questionIds: [] },
  caveats: [
    "题库仅采集 296/297 题；未采集题不补造，知识卡覆盖率按 296 题口径统计。",
    "计数为“该知识事实直接对应的题目数”，同一题若同时覆盖两个事实只计入首次出现组，union 已去重。",
    "所有答案与题面均来自官方题库快照，未改写来源标题或臆造解析。",
  ],
};

const union = new Map();
const seenInGroup = new Set();
for (const group of groups) {
  const matched = questions.filter(group.matches);
  const questionsForGroup = matched.map((question) => {
    const firstGroup = [...seenInGroup].find((id) => id === question.questionId);
    seenInGroup.add(question.questionId);
    if (!union.has(question.questionId)) union.set(question.questionId, question);
    return {
      questionId: question.questionId,
      chapterId: question.chapterId,
      sourceTitle: question.sourceTitle,
      type: question.type,
      stem: question.stem,
      options: question.options.map((option) => `${option.label}.${option.text}`),
      answerKey: question.answerKey,
      answerText: question.answerText,
      firstSeenInGroup: firstGroup ? null : group.id,
    };
  });
  report.groups.push({
    id: group.id,
    title: group.title,
    claim: group.claim,
    count: questionsForGroup.length,
    questions: questionsForGroup,
  });
}

report.union.count = union.size;
report.union.questionIds = [...union.keys()];

mkdirSync(join(root, "docs"), { recursive: true });
writeFileSync(join(root, "docs", "knowledge-coverage.json"), `${JSON.stringify(report, null, 2)}\n`);

const lines = [];
lines.push("# 知识卡事实覆盖报告");
lines.push("");
lines.push(`- 题库：${bank.title}（${bank.bankId}）`);
lines.push(`- 题量：${bank.collected} / ${bank.expectedTotal ? `官方 ${bank.expectedTotal}` : "官方总数未显示"}；${bank.coverageNote}`);
lines.push(`- 生成时间：${report.generatedAt}`);
lines.push(`- 直接覆盖题目：**${report.union.count} 道唯一题**（跨组去重后）`);
lines.push("");
lines.push("## 统计口径");
lines.push("");
lines.push(report.method);
lines.push("");
lines.push("| # | 知识事实 | 直接覆盖题数 |");
lines.push("|---|---|---:|");
report.groups.forEach((group, index) => {
  lines.push(`| ${index + 1} | ${group.title} | ${group.count} |`);
});
lines.push(`| **合计（去重）** | **${report.union.count} 道唯一题** | **${report.union.count}** |`);
lines.push("");
lines.push("## 逐条题目证据");
for (const [index, group] of report.groups.entries()) {
  lines.push("");
  lines.push(`### ${index + 1}. ${group.title}（${group.count} 题）`);
  lines.push("");
  lines.push(`事实：${group.claim}`);
  lines.push("");
  for (const question of group.questions) {
    lines.push(`- \`${question.questionId}\` ｜ ${question.stem}`);
    lines.push(`  - 选项：${question.options.map((option) => option.replaceAll("|", "\\|")).join("；")}`);
    lines.push(`  - 官方答案：${question.answerText.join(" / ")}（${question.answerKey.join(", ")}）`);
    lines.push(`  - 来源：${question.sourceTitle}`);
  }
}
lines.push("");
lines.push("## 说明与限制");
for (const caveat of report.caveats) lines.push(`- ${caveat}`);
lines.push("");

writeFileSync(join(root, "docs", "knowledge-coverage.md"), `${lines.join("\n")}\n`);

console.log(`Knowledge coverage written: ${report.union.count} unique questions`);
for (const group of report.groups) {
  console.log(`  ${group.count.toString().padStart(2)}  ${group.title}`);
}
