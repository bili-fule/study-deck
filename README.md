# 砺知 StudyDeck

供个人与小范围使用的通用刷题网站，支持多题库练习、模拟考试与复习，学习记录优先保存在本机。React 19 + TypeScript + Vite + Tailwind CSS v4 + BoardUI 免费组件，中文界面，桌面/手机响应式，明暗主题。学生手册、实验室安全与军事理论均为独立题库，不限定站点主题。

## 快速开始

```bash
npm install
npm run dev
```

打开 http://localhost:5173/ 。无需登录即可练习、查看错题、收藏、复习与备份，完整学习进度保存在本机。未登录学习行为也会发送最小化匿名统计；登录账号用于可选的跨设备同步。

生产构建与本地预览：

```bash
npm run build
npm run preview
```

## 功能

- 顺序练习（驾考宝典式主入口）：整库或按章节从第一道未作答的题继续，章节列表显示各章进度；答对自动跳下一题（可在设置关闭），答错停留看解析。另有随机练习（20 题一组）、智能加权（新题/错题/到期优先）、错题重练、收藏练习一键开始。练习中单选/判断点击选项即判分；多选点击整条选项卡勾选，选好后点“提交答案”判分，提交后锁定本题；多选未提交时不能下一题。答题页为固定底栏（对/错计数、题卡、上一题/提交/下一题）+ 题卡抽屉（小屏）/侧栏（大屏），题号按对错着色。
- 背题模式：练习页或设置中开启后直接显示官方答案与解析，作答不计入统计、不进错题本。
- 练习完成状态：全部题目作答后自动标记为已完成并保留只读回看，直到点击“完成练习”结束；未完成/未作答的练习仍可继续。已完成练习不会出现在概览或练习页的“进行中”横幅；旧版本遗留的“已全部作答但仍为进行中”会话会在读取时自动迁移，不改动历史事件与答案。
- 模拟考试：题量与时长可配置，默认 50 题 / 30 分钟；多选支持整条选项卡点击及键盘勾选，交卷前可修改选项，不提供练习用的逐题判分按钮；截止时间持久化，刷新后继续倒计时，到期自动交卷；交卷前不显示对错，交卷后统一批改与复盘。
- 错题本按“最近一次作答错误”收录，答对后自动移出；错题/收藏卡片并列显示官方答案与上次实际所选答案（按当前选项顺序映射稳定 ID），不再用对错状态代替选择内容。收藏使用 append-only 事件 + 墓碑，不硬删除历史。
- 知识卡：15 张由官方题库事实整理，关联 52 道唯一题；SM-2 简化调度（again/hard/good/easy）。
- 学习进度：覆盖率、正确率、连续天数、近 7 天、章节/分类明细、模拟考试历史。
- 备份/恢复 JSON；导入前校验事件结构，非法文件不会覆盖现有数据。备份不包含账号、Cookie、同步游标或 ack 元数据。
- 云端 API：前端 `https://st.xmfu.cn`，Cloudflare 后端 `https://stapi.xmfu.cn/api`；精确域名 CORS + 携带凭据请求 + API 域名专属 HttpOnly Cookie。邀请制注册；本机匿名练习在登录时仍需确认才导入账号。云端失败不会阻塞本地功能。
- 管理员页面分别展示账号与匿名行为的聚合统计，没有逐用户或逐访客的作答详情；匿名次数不与账号次数相加。

## 数据与题库扩展

题库快照在 `data/sources/question-bank.json`（296 / 官方 297 题；未采集题不补造），CSV 快照在 `data/sources/question-bank.csv`。

军事理论题库在 `data/sources/military-theory.json`：通过安卓学习通已提交模拟考试的“考试详情”采集两套快照，页面分别显示 380 题和 156 题，合并为独立题库，共 536 道唯一题（263 单选 / 117 多选 / 156 判断），按题型分为三个章节。所有题目保留官方答案和解析原文，解析即使与题干重复也不擅自改写；练习作答后、模考交卷后的复盘、题库搜索及错题/收藏列表均可查看官方解析。未获取具体考试网页链接，来源链接仅指向学习通平台首页。原始截图、XML 与个人作答记录不打包进网站；不影响原有题库或学习事件。

实验室安全题库快照在 `data/sources/lab-bank.json`：2026-11-15 经 BSK 浏览器实例访问官方 `labmgmt.zqu.edu.cn` 题库页采集（`gosjLookPage2?sjmenu=15&classid=202309000001...`）。当前页面第 1–322 题全部有官方答案：106 单选 / 186 判断 / 30 多选，0 未作答、0 题图。分类为 `通识类`（`classid=202309000001`）；官方页面未显示题库总数，因此 `expectedTotal` 留空，不把 322 宣称为官方总量。首页另外五个标签属于“在线学习”文章列表，不是本题库，未合并。本库暂不生成知识卡。编译产物：

- `data/bank.bundle.json`：浏览器完整题库（题干、选项、来源、稳定 ID，以及来源提供的可选 `explanation` 官方解析）。
- `data/catalog.json`：服务端校验用最小目录 `{bankId,questionId,chapterId,type,optionKeys,answerKey}`。
- `data/cards.json`：人工整理的知识卡与关联题目 ID。

```bash
npm run data:build       # 编译并校验题库
npm run data:coverage    # 生成 docs/knowledge-coverage.{json,md}
npm run data:test        # 导入器边界回归（选项重排/无来源前缀/显式多选/answerText 不一致）
```

稳定 ID 规则：

- `questionId = q_ + sha1(bankId + 来源标题 + 题干 + 排序后的选项文本)`；选项重排不改变题目 ID。
- 每个选项的 ID 由选项文本哈希生成，`answerKey`、`selected` 都使用该内容稳定 ID；A/B/C/D 只是 UI 标签，不持久化。
- `bankId` 纳入哈希，多个题库不会互相冲突；来源标题纳入哈希，同名但不同制度文件不会被合并。

新增题库：

1. 在 `data/sources/` 放入题库 JSON（`{ questions: [...] }`），并在 `data/sources/manifest.json` 的 `banks` 中登记 `file`、`bankId`、`title`；`expectedTotal` 可选，官网未显示总数时省略并写清 `coverageNote`，不要用采集数伪造总数。
2. 题目可继续使用行首 `（来源文件）` 前缀；通用题库也可以省略前缀，改用可选的 `sourceTitle` / `chapter` / `chapterId` / `category` / `type` 字段。`chapter` 是分类/章节标题，`sourceTitle` 是具体制度文件或来源标题（二者可同时提供）；`category` 用于覆盖自动分类，未提供时沿用内置规则。显式 `type` 支持 `single` / `judgment` / `multiple`，即使多选题只有一个正确答案也不会被误判为单选。
3. 运行 `npm run data:build`；任何缺失答案、`answerText` 与 `answerKey` 不一致、重复 ID 都会使构建失败。
4. 侧边栏题库选择器会自动列出所有已编译题库；练习、模考、错题、收藏、知识卡和进度都按当前题库作用域统计。

## 备份、隐私与本地优先

- 本地状态按作用域保存在 `localStorage`：匿名 `guest` 与 `user:<id>` 分离；退出登录后切回访客空间，不共享学习记录。
- 保存失败（配额/隐私模式）或数据损坏会显示明确提示，并保留内存进度；损坏的原始数据不会被静默覆盖。
- 导出 JSON 只含学习事件、当前会话、设置和显示名。恢复时重新校验事件 payload，并重置游标/ack 元数据，避免跨设备跳过云端记录。
- 云端只同步事件：`attempt.record`、`favorite.set`、`exam.completed`、`card.reviewed`、`card.state`。未作答题目不产生答题事件；考试历史不计入练习错误率。
- 未登录时向 `/api/telemetry` 上报同一组学习事件，服务端只保留事件类型、题目、时间及重新判定的对错，不保存完整所选答案或考试 payload。随机访客 Cookie 仅存哈希；不采集姓名或设备指纹，防滥用限流只使用短期哈希键。
- 匿名统计确认与账号同步确认分别保存；匿名上报不修改账号同步游标，不会让登录导入跳过学习记录。网络失败时保留本地待上报事件，下次学习、重新打开页面或恢复联网时继续；重复事件不重复计数。

## 云端与部署

后端代码在 `worker/**`、`migrations/**`，共享类型在 `shared/api.ts`；部署步骤与接口见 [docs/BACKEND.md](docs/BACKEND.md)。前端继续部署在 EdgeOne，Worker 仅提供 API：

```bash
npm install
npm run cf:migrate   # 初始化本地 D1，包含匿名统计迁移
npm run cf:dev       # API 监听 127.0.0.1:8787（独立终端）
npm run dev          # Vite 将 /api 代理到 8787（另一个终端）
```

前端生产构建默认连接 `https://stapi.xmfu.cn`。如需更改，在 EdgeOne 构建环境配置 `VITE_API_BASE_URL` 为 API 的来源地址（不含 `/api`），然后重新构建；开发模式默认使用 Vite 同源代理。生产白名单 `ALLOWED_ORIGINS` 位于 `wrangler.jsonc`，默认仅允许 `https://st.xmfu.cn`，不能填写 `*`。

Windows 说明：当前环境的 Wrangler/workerd 存在创建 `miniflare-email-store` 的已知权限错误；请使用 Linux / WSL 运行本地 Worker，不需要更改系统安全设置。纯前端开发与构建不依赖 Worker。

上线前创建并绑定真实 D1、应用全部迁移、初始化管理员与邀请码，再部署 Worker。`stapi.xmfu.cn` 的 Custom Domain 需要 Cloudflare 中有效的 `xmfu.cn` 区域；前端 `st.xmfu.cn` 保留原来的 EdgeOne DNS 配置。不要把域名配置完成视为已经上线。

管理员脚本（由后端提供）：`npm run admin:init` / `admin:reset` / `admin:invite`。

## 第三方与许可

BoardUI 免费组件通过 `npx boardui@latest init --yes` / `add ... --yes` 安装，源码位于 `components/`、`styles/`、`utils/`，按 BoardUI 免费源码的 MIT 许可使用；来源与版权声明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。同时保留 React Aria Components（Apache-2.0）、Remix Icon、Inter 等依赖的许可与归属。

题库内容来自肇庆学院考试平台与学习通模拟考试详情的采集快照；本项目不虚构题目、答案或解析。
