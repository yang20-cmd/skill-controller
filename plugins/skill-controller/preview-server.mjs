import { createServer } from "node:http";
import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { dirname, extname, join, normalize, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 52346);
const codexHome = process.env.CODEX_HOME || join(homedir(), ".codex");
const controllerDir = join(codexHome, "skill-controller");
const overridesPath = join(controllerDir, "overrides.json");
const backupRoot = join(controllerDir, "backups");
const configPath = join(codexHome, "config.toml");
const sessionsDir = join(codexHome, "sessions");
const archivedSessionsDir = join(codexHome, "archived_sessions");
let usageCache = null;

const types = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
]);

const knownSummaries = new Map([
  ["brainstorming", "用于创意、产品、架构或写作前的方案设计，适合先澄清目标、约束、候选方案和验收标准。"],
  ["documents", "创建、编辑、渲染和检查 Word 文档，适合生成 docx、修改格式、添加批注、处理红线和做视觉 QA。"],
  ["spreadsheets", "创建、修改、分析和格式化 Excel、CSV、TSV 等表格文件，适合公式、图表、数据清洗和报表整理。"],
  ["pdf", "读取、生成、渲染和检查 PDF 文件，适合版式检查、文本提取、页面处理和交付前 QA。"],
  ["presentations", "创建、编辑和检查演示文稿，适合 PowerPoint、Google Slides、成套页面排版和视觉一致性检查。"],
  ["openai-docs", "查询 OpenAI 和 Codex 官方说明，适合模型选择、API 用法、插件、skill、MCP 和配置机制问题。"],
  ["plugin-creator", "创建和维护本地 Codex 插件，适合生成 plugin.json、marketplace 条目、skills、hooks、assets 和安装更新流程。"],
  ["skill-creator", "创建或更新 Codex skill，适合沉淀可复用工作流、触发说明、脚本、参考资料和验证步骤。"],
  ["skill-installer", "安装 Codex skill，适合从 curated 列表或 GitHub 仓库路径安装、更新和管理本地技能。"],
  ["browser:control-in-app-browser", "控制 Codex 内置浏览器，适合打开网页、测试本地页面、截图、点击填写和检查交互结果。"],
  ["chrome:control-chrome", "控制用户 Chrome 浏览器，适合依赖登录态、已有标签页、扩展或用户浏览器配置的网页任务。"],
  ["figma-code-connect", "维护 Figma Code Connect 映射文件，适合把 Figma 组件和代码组件关联起来，生成或更新 .figma.ts / .figma.js 模板。"],
  ["figma-create-new-file", "新建 Figma 文件的前置流程，适合创建空白设计文件、FigJam 白板或 Figma Slides 文件。"],
  ["figma-generate-design", "把网页、应用页面、弹窗、侧边栏或多区块界面生成到 Figma，适合从代码或描述搭建完整 UI 画面。"],
  ["figma-generate-diagram", "在 FigJam 中生成流程图、架构图、时序图、ERD、状态机、甘特图或时间线，适合把系统关系可视化。"],
  ["figma-generate-library", "在 Figma 中创建或更新设计系统和组件库，适合变量、tokens、主题、组件 variants 和规范化组件资产。"],
  ["figma-implement-motion", "把 Figma 中已有的动效和动画翻译成生产代码，适合实现设计稿里的 motion、过渡和组件动画。"],
  ["figma-swiftui", "处理 SwiftUI 与 Figma 的双向转换，适合 iOS、iPhone、iPad、.swift 或 Xcode 项目和 Figma 设计互转。"],
  ["figma:figma-use", "在 Figma 文件中创建、编辑和检查节点，适合设计稿自动化、组件搭建、变量绑定和设计资产整理。"],
  ["figma-use", "执行底层 Figma 文件读写操作，适合创建/编辑节点、变量、组件、自动布局、填充和检查文件结构。"],
  ["figma-use-figjam", "为 FigJam 文件提供专用操作上下文，适合白板、流程图、便利贴和 FigJam 画布类任务。"],
  ["figma-use-motion", "在 Figma 文件内部创建、编辑或检查动效，适合关键帧、动画样式、缓动曲线和时间线配置。"],
  ["figma-use-slides", "为 Figma Slides 提供专用操作上下文，适合幻灯片页面、演示结构和 Slides 文件内编辑。"],
  ["github", "处理 GitHub 仓库、Issue、PR 和项目上下文，适合读取元信息、总结变更、定位分支和协作入口。"],
  ["gh-address-comments", "处理 GitHub PR 审查意见，适合读取未解决评论、定位代码行、逐条修复并回应 review feedback。"],
  ["gh-fix-ci", "排查和修复 GitHub Actions 或 PR checks 失败，适合查看失败日志、定位原因并提交修复。"],
  ["yeet", "把本地改动发布到 GitHub，适合确认范围、提交、推送分支并创建 draft PR。"],
  ["canva:canva-resize-for-all-social-media", "把一个 Canva 设计批量调整为 Facebook、Instagram、LinkedIn 等社交平台规格，并准备可导出的图片和编辑链接。"],
  ["canva-resize-for-all-social-media", "把一个 Canva 设计批量调整为 Facebook、Instagram、LinkedIn 等社交平台规格，并准备可导出的图片和编辑链接。"],
  ["canva-branded-presentation", "根据 brief、提纲或现有设计生成带品牌风格的 Canva 演示文稿，适合品牌 deck 和提案类幻灯片。"],
  ["canva-translate-design", "翻译 Canva 设计中的文本并尽量保持原布局，适合把现有设计本地化成另一种语言。"],
]);

const knownCategories = new Map([
  ["brainstorming", "系统"],
  ["skill-creator", "系统"],
  ["skill-installer", "系统"],
  ["plugin-creator", "系统"],
  ["openai-docs", "系统"],
  ["gh-address-comments", "代码协作"],
  ["gh-fix-ci", "代码协作"],
  ["github", "代码协作"],
  ["yeet", "代码协作"],
]);

function hashId(value) {
  return createHash("sha1").update(value).digest("hex").slice(0, 12);
}

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function normalizeYamlValue(value) {
  return value.trim().replace(/^['"]|['"]$/g, "").replace(/\\"/g, '"').replace(/\\'/g, "'");
}

function parseFrontmatter(markdown) {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const data = {};
  for (const line of match[1].split(/\r?\n/)) {
    const pair = line.match(/^([A-Za-z0-9_-]+):\s*(.+)$/);
    if (pair) data[pair[1]] = normalizeYamlValue(pair[2]);
  }
  return data;
}

function bodyText(markdown) {
  return markdown.replace(/^---\r?\n[\s\S]*?\r?\n---/, "").replace(/```[\s\S]*?```/g, " ");
}

function sourceFromPath(filePath) {
  const normalized = filePath.toLowerCase();
  if (normalized.includes(`${sep}.system${sep}`.toLowerCase())) return "system";
  if (normalized.includes(`${sep}plugins${sep}cache${sep}`.toLowerCase())) return "plugin";
  return "personal";
}

function sourceLabel(source) {
  return { system: "系统", plugin: "插件", personal: "个人" }[source] || source;
}

function categoryFor(name, description, body = "") {
  if (knownCategories.has(name)) return knownCategories.get(name);
  const text = `${name} ${description} ${body}`.toLowerCase();
  const triggerText = `${name} ${description}`.toLowerCase();
  if (triggerText.includes("github") || /^gh[-:]/.test(name) || triggerText.includes("pull request") || triggerText.includes(" pr ") || triggerText.includes("ci checks") || triggerText.includes("github actions")) return "代码协作";
  if (triggerText.includes("skill") || triggerText.includes("plugin") || triggerText.includes("codex") || triggerText.includes("openai") || triggerText.includes("mcp")) return "系统";
  if (text.includes("canva") || text.includes("figma") || text.includes("design") || text.includes("swiftui")) return "设计";
  if (text.includes("browser") || text.includes("chrome") || text.includes("playwright") || text.includes("computer use")) return "浏览器";
  if (text.includes("document") || text.includes("docx") || text.includes("word") || text.includes("pdf") || text.includes("spreadsheet") || text.includes("excel") || text.includes("presentation") || text.includes("powerpoint")) return "办公";
  if (text.includes("image") || text.includes("video") || text.includes("hyperframes") || text.includes("remotion") || text.includes("social media")) return "媒体";
  if (text.includes("obsidian") || text.includes("markdown") || text.includes("canvas")) return "知识库";
  return "其他";
}

function detailFromEnglish(name, description, body = "") {
  const text = `${name} ${description} ${body}`.toLowerCase();
  const parts = [];

  if (text.includes("canva") && text.includes("resize")) {
    parts.push("把一个 Canva 设计批量改成多平台社交媒体尺寸");
    parts.push("适合 Facebook、Instagram、LinkedIn 等帖子、故事和活动图导出");
    parts.push("会保留原设计，通过副本生成不同规格，并整理下载链接和编辑链接");
  } else if (name.includes("figma-code-connect")) {
    parts.push("维护 Figma 组件与代码组件之间的 Code Connect 映射");
    parts.push("适合创建或更新 .figma.ts / .figma.js，让设计组件能对应到真实代码片段");
  } else if (name.includes("figma-create-new-file")) {
    parts.push("新建 Figma 文件的前置流程");
    parts.push("适合创建设计文件、FigJam 白板或 Figma Slides 文件，并为后续写入操作准备目标文件");
  } else if (name.includes("figma-generate-design")) {
    parts.push("把应用页面、弹窗、抽屉、侧边栏或多区块布局生成到 Figma");
    parts.push("适合从代码或文字描述搭建完整 UI 画面，并复用设计系统 tokens 和组件");
  } else if (name.includes("figma-generate-diagram")) {
    parts.push("在 FigJam 中生成结构化图表");
    parts.push("适合流程图、架构图、时序图、ERD、状态机、时间线和系统调用链可视化");
  } else if (name.includes("figma-generate-library")) {
    parts.push("创建或更新 Figma 设计系统和组件库");
    parts.push("适合 tokens、变量、主题、组件 variants、组件文档和代码/设计差异补齐");
  } else if (name.includes("figma-implement-motion")) {
    parts.push("把 Figma 里的动画和动效翻译成应用代码");
    parts.push("适合实现设计稿中的 motion、过渡、组件动画和交互节奏");
  } else if (name.includes("figma-swiftui")) {
    parts.push("处理 SwiftUI 与 Figma 之间的双向转换");
    parts.push("适合 iOS、iPhone、iPad、.swift、Xcode 项目和 Figma 页面互转");
  } else if (name.includes("figma-use-figjam")) {
    parts.push("为 FigJam 文件提供专用操作上下文");
    parts.push("适合白板、便利贴、流程图、FigJam 画布和协作图形编辑");
  } else if (name.includes("figma-use-motion")) {
    parts.push("在 Figma 文件内部创建、编辑或检查动效");
    parts.push("适合关键帧、动画样式、缓动曲线、时间线和 motion 节点配置");
  } else if (name.includes("figma-use-slides")) {
    parts.push("为 Figma Slides 文件提供专用操作上下文");
    parts.push("适合幻灯片页面、演示结构和 Slides 文件内编辑");
  } else if (name.includes("figma-use")) {
    parts.push("执行底层 Figma 文件读写操作");
    parts.push("适合创建/编辑节点、变量、组件、自动布局、填充、绑定变量和检查文件结构");
  } else if (text.includes("figma")) {
    parts.push("处理 Figma 文件、组件、变量、布局或设计稿自动化");
    parts.push("适合从代码生成页面、搭建设计系统、编辑节点和检查设计结构");
  } else if (name.includes("gh-address-comments")) {
    parts.push("处理 GitHub PR 审查意见");
    parts.push("适合读取未解决 review comments、定位代码行、逐条修复并回应反馈");
  } else if (name.includes("gh-fix-ci")) {
    parts.push("排查和修复 GitHub Actions 或 PR checks 失败");
    parts.push("适合查看失败日志、定位原因、实现修复并重新验证");
  } else if (name.includes("yeet")) {
    parts.push("把本地改动发布到 GitHub");
    parts.push("适合确认改动范围、提交、推送分支并创建 draft PR");
  } else if (name.includes("github") || /^gh[-:]/.test(name) || description.toLowerCase().includes("github") || description.toLowerCase().includes("pull request")) {
    parts.push("处理 GitHub 仓库、PR、Issue、评论或 CI 结果");
    parts.push("适合总结上下文、修复检查失败、回应审查意见和发布分支");
  } else if (text.includes("browser") || text.includes("chrome") || text.includes("playwright")) {
    parts.push("控制浏览器打开网页、点击填写、截图和验证页面状态");
    parts.push("适合本地网页测试、登录态网页检查和交互流程确认");
  } else if (text.includes("docx") || text.includes("word") || text.includes("document")) {
    parts.push("创建、编辑、渲染和检查 Word 文档");
    parts.push("适合 docx、批注、红线、格式保留和交付前版式 QA");
  } else if (text.includes("spreadsheet") || text.includes("excel") || text.includes("csv")) {
    parts.push("创建、修改和分析电子表格");
    parts.push("适合 Excel、CSV、公式、图表、数据清洗和汇总报表");
  } else if (text.includes("pdf")) {
    parts.push("读取、生成、渲染和检查 PDF 文件");
    parts.push("适合文本提取、页面处理、视觉比对和交付前检查");
  } else if (text.includes("presentation") || text.includes("powerpoint") || text.includes("slides")) {
    parts.push("创建、编辑和检查演示文稿");
    parts.push("适合 PowerPoint、Google Slides、页面排版和整套 deck 输出");
  } else if (text.includes("image")) {
    parts.push("生成、编辑或整理图片素材");
    parts.push("适合插画、海报、视觉草图、透明背景图和位图资产");
  } else if (text.includes("video") || text.includes("hyperframes") || text.includes("remotion")) {
    parts.push("创建或编辑视频、动画、字幕和社媒短片");
    parts.push("适合 HTML/React 视频、转场、配音、字幕和导出渲染");
  } else if (text.includes("obsidian") || text.includes("markdown")) {
    parts.push("处理 Obsidian 笔记、Markdown、Canvas 或 Bases");
    parts.push("适合知识库整理、双链、属性、画布和结构化视图");
  } else if (text.includes("skill") && text.includes("create")) {
    parts.push("创建或更新 Codex skill");
    parts.push("适合沉淀可复用流程、触发说明、脚本、参考资料和验证步骤");
  } else if (text.includes("plugin")) {
    parts.push("创建或维护 Codex 插件");
    parts.push("适合插件 manifest、marketplace、skills、hooks、assets 和安装更新流程");
  } else if (description) {
    parts.push(`处理 ${name} 对应的专项任务`);
    parts.push("适合该 skill 说明中列出的触发场景、工作流和交付格式");
  } else {
    parts.push(`处理 ${name} 相关任务`);
    parts.push("适合需要按该 skill 内置流程执行的重复性工作");
  }

  return parts.join("，") + "。";
}

function summaryFor(name, description, body, overrides) {
  if (overrides?.summaries?.[name]) return overrides.summaries[name];
  if (knownSummaries.has(name)) return knownSummaries.get(name);
  return detailFromEnglish(name, description, body);
}

function estimateTokens(name, description) {
  const text = `${name} ${description}`;
  const englishWords = text.match(/[A-Za-z0-9_-]+/g)?.length || 0;
  const cjkChars = text.match(/[\u4e00-\u9fff]/g)?.length || 0;
  return Math.max(8, Math.round(englishWords * 1.25 + cjkChars / 1.6));
}

function triggerWords(name, description, body = "") {
  const words = new Set(name.split(/[:\-\s]+/).filter(Boolean).slice(0, 4));
  const lower = `${description} ${body}`.toLowerCase();
  for (const token of ["docx", "word", "pdf", "figma", "canva", "chrome", "browser", "github", "skill", "plugin", "excel", "csv", "image", "video", "social media", "slides"]) {
    if (lower.includes(token)) words.add(token);
  }
  return Array.from(words).slice(0, 9);
}

function usageExampleFor(name, category, description) {
  const lower = `${name} ${description}`.toLowerCase();
  if (name.includes("figma-generate-diagram")) {
    return {
      examplePrompt: "把我这个系统登录流程画成 FigJam 时序图：用户输入账号密码 -> 后端校验 -> 发 JWT -> 前端保存并跳转首页。",
      withoutSkillEffect: "不用这个 skill 时，通常只能得到文字版 Mermaid/流程说明，或者需要手工处理 FigJam 的图形布局和约束。",
    };
  }
  if (name.includes("figma-generate-design")) {
    return {
      examplePrompt: "把当前这个 Skill Controller 页面做成一个 Figma 桌面端界面稿，保留左侧导航、中间列表和右侧详情结构。",
      withoutSkillEffect: "不用这个 skill 时，可能只能给你 HTML/CSS 或文字布局建议，不能系统地按 Figma 页面结构搭出设计稿。",
    };
  }
  if (name.includes("figma-generate-library")) {
    return {
      examplePrompt: "根据这个前端项目提取按钮、输入框、卡片和颜色 tokens，在 Figma 里创建一套基础组件库。",
      withoutSkillEffect: "不用这个 skill 时，组件库容易只是零散图层，缺少变量、variants、主题和可复用组件结构。",
    };
  }
  if (name.includes("figma-use")) {
    return {
      examplePrompt: "在当前 Figma 文件里新建一个按钮组件，包含默认、悬停、禁用三种 variant，并绑定颜色变量。",
      withoutSkillEffect: "不用这个 skill 时，容易只停留在说明层面，实际 Figma 节点、变量和组件结构不会被正确创建。",
    };
  }
  if (name.includes("canva-resize")) {
    return {
      examplePrompt: "把这个 Canva 海报链接同时改成 Instagram 帖子、Instagram Story、Facebook 帖子和 LinkedIn 帖子尺寸，并导出 PNG。",
      withoutSkillEffect: "不用这个 skill 时，通常只能告诉你各平台尺寸，需要你自己在 Canva 里复制、调整和导出每个版本。",
    };
  }
  if (name.includes("canva-branded-presentation")) {
    return {
      examplePrompt: "根据这份产品介绍和品牌色，做一个 8 页 Canva 品牌演示文稿，包含封面、问题、方案、案例和结束页。",
      withoutSkillEffect: "不用这个 skill 时，通常只能生成大纲或普通文字，不能按 Canva 品牌设计和页面结构生成可编辑演示稿。",
    };
  }
  if (name.includes("canva-translate")) {
    return {
      examplePrompt: "把这个 Canva 设计里的所有中文翻译成英文，同时尽量保持原来的排版和文字层级。",
      withoutSkillEffect: "不用这个 skill 时，可能只能给出翻译文本，不能围绕 Canva 设计文件逐层替换并保护布局。",
    };
  }
  if (name.includes("computer-use")) {
    return {
      examplePrompt: "帮我打开 Windows 上的这个应用，按界面里的按钮完成设置，并告诉我每一步结果。",
      withoutSkillEffect: "不用这个 skill 时，Codex 通常只能操作文件和命令行，不能直接控制 Windows 桌面应用界面。",
    };
  }
  if (name.includes("defuddle")) {
    return {
      examplePrompt: "把这个网页正文提取成干净 Markdown，去掉导航、广告、侧栏和无关按钮。",
      withoutSkillEffect: "不用这个 skill 时，网页内容容易混入导航、广告和脚本噪声，后续总结和整理会不稳定。",
    };
  }
  if (name.includes("markitdown")) {
    return {
      examplePrompt: "把这个 PDF/Word/PPT/Excel 文件转换成 Markdown，方便我继续整理和提问。",
      withoutSkillEffect: "不用这个 skill 时，只能按文件类型临时找办法读取，转换格式和保留结构会更不稳定。",
    };
  }
  if (name.includes("gh-fix-ci")) {
    return {
      examplePrompt: "帮我看这个 PR 为什么 GitHub Actions 失败，读取日志，定位原因并直接修复。",
      withoutSkillEffect: "不用这个 skill 时，可能只会泛泛建议检查 CI，缺少按 PR 检查项、日志和补丁上下文的完整流程。",
    };
  }
  if (name.includes("gh-address-comments")) {
    return {
      examplePrompt: "检查当前 PR 未解决的 review comments，逐条判断并修改代码回应。",
      withoutSkillEffect: "不用这个 skill 时，容易漏掉未解决线程，或者只处理扁平评论而没有线程状态和行内上下文。",
    };
  }
  if (name === "yeet") {
    return {
      examplePrompt: "把我当前改动整理成一次提交，推到 GitHub，并开一个 draft PR。",
      withoutSkillEffect: "不用这个 skill 时，也能手动 git commit/push，但可能少了范围确认、PR 创建和 Codex app handoff 的固定流程。",
    };
  }
  if (name.includes("documents")) {
    return {
      examplePrompt: "帮我把这份辅导计划整理成一个 Word 文档，带标题、表格、页眉，并检查排版。",
      withoutSkillEffect: "不用这个 skill 时，可能只能输出 Markdown 或普通文本，缺少 docx 生成、渲染检查和版式 QA。",
    };
  }
  if (name.includes("spreadsheets")) {
    return {
      examplePrompt: "把这个 CSV 清洗成 Excel，新增汇总表、公式和图表，并保存为 .xlsx。",
      withoutSkillEffect: "不用这个 skill 时，可能只能分析数据或给出公式建议，不能稳定生成带格式、公式和图表的表格文件。",
    };
  }
  if (name === "pdf") {
    return {
      examplePrompt: "读取这个 PDF，提取正文和表格，告诉我每页主要内容并检查是否有空白页。",
      withoutSkillEffect: "不用这个 skill 时，PDF 可能只能粗略读取文本，缺少渲染、分页检查和版式层面的验证。",
    };
  }
  if (name.includes("presentations")) {
    return {
      examplePrompt: "把这份项目复盘内容做成 8 页 PowerPoint，包含封面、时间线、问题、方案和总结页。",
      withoutSkillEffect: "不用这个 skill 时，通常只能给大纲或 Markdown，不能生成可直接打开的演示文稿文件。",
    };
  }
  if (name.includes("browser") || name.includes("playwright") || name.includes("chrome")) {
    return {
      examplePrompt: "打开本地网页，点击主要按钮，填写表单，截图并确认交互是否正常。",
      withoutSkillEffect: "不用这个 skill 时，只能凭代码推断页面行为，不能在真实浏览器里点击、截图和验证状态。",
    };
  }
  if (name.includes("obsidian")) {
    return {
      examplePrompt: "在我的 Obsidian 库里创建一组双链笔记，把资料按主题整理成索引页和属性。",
      withoutSkillEffect: "不用这个 skill 时，也能写 Markdown，但可能不符合 Obsidian 双链、属性、嵌入和库结构习惯。",
    };
  }
  if (name.includes("image")) {
    return {
      examplePrompt: "生成一张透明背景的产品图标，适合放进网页按钮里。",
      withoutSkillEffect: "不用这个 skill 时，只能描述图片需求或写 SVG/CSS，不能直接生成位图素材。",
    };
  }
  if (name.includes("hyperframes") || name.includes("remotion") || lower.includes("video")) {
    return {
      examplePrompt: "把这个网站做成一个 20 秒产品介绍短视频，包含标题、截图、转场和字幕。",
      withoutSkillEffect: "不用这个 skill 时，通常只能写视频脚本或网页代码，缺少视频合成、预览和渲染流程。",
    };
  }
  if (name.includes("skill-creator")) {
    return {
      examplePrompt: "把我经常做的合同审阅流程沉淀成一个 Codex skill，包含触发说明、步骤和示例。",
      withoutSkillEffect: "不用这个 skill 时，只能写一次性说明，不能形成可复用、可触发、可验证的 skill 结构。",
    };
  }
  if (name.includes("plugin-creator")) {
    return {
      examplePrompt: "创建一个本地 Codex 插件，名字叫 skill-controller，包含 manifest、skills 文件夹和 marketplace 入口。",
      withoutSkillEffect: "不用这个 skill 时，容易漏掉 plugin.json、marketplace 字段或安装更新流程。",
    };
  }
  if (name.includes("openai-docs")) {
    return {
      examplePrompt: "查一下 Codex skills 的官方配置方式，说明怎么禁用某个 skill。",
      withoutSkillEffect: "不用这个 skill 时，可能依赖记忆或过期信息，官方文档和当前产品机制不一定准确。",
    };
  }

  return {
    examplePrompt: `试着让 Codex 完成一个 ${name} 相关任务：给出输入文件或目标，让它按这个 skill 的流程产出结果。`,
    withoutSkillEffect: `不用这个 skill 时，Codex 仍可尝试通用处理，但可能缺少 ${category || "该领域"} 的专用步骤、工具约束和验证流程。`,
  };
}

function capabilityLimitsFor(skill) {
  const commonEditable = [
    "显示名称",
    "中文说明",
    "分类标签",
    "启用/关闭",
    "触发偏好说明",
    "默认输出要求",
    "使用前确认规则",
  ];
  if (skill.source === "personal") {
    return {
      editable: [...commonEditable, "个人 skill 文件内容"],
      blocked: [],
      reason: "个人 skill 位于你的本地 skills 目录，后续可以扩展为写回 SKILL.md；当前先保存到 Skill Controller 覆盖表。",
      writeMode: "可扩展为写回 SKILL.md",
    };
  }
  if (skill.source === "system") {
    return {
      editable: commonEditable,
      blocked: ["系统内置 skill 文件内容", "强制前置加载规则", "工具安全策略"],
      reason: "系统内置 skill 属于 Codex 内置能力，直接改文件会被更新覆盖，也可能破坏安全/工具调用约束，所以这里只保存外部覆盖设置。",
      writeMode: "仅外部覆盖",
    };
  }
  return {
    editable: commonEditable,
    blocked: ["插件缓存 skill 文件内容", "插件 manifest", "MCP/工具真实权限"],
    reason: "插件 skill 来自已安装插件缓存，直接改缓存会在插件更新或重装后丢失，也可能破坏插件校验；这里保存外部覆盖设置。",
    writeMode: "仅外部覆盖",
  };
}

function addFeature(items, id, title, description, options = {}) {
  if (items.some((item) => item.id === id)) return;
  items.push({
    id,
    title,
    description,
    enabled: options.enabled !== false,
    custom: false,
    locked: Boolean(options.lockedReason),
    lockedReason: options.lockedReason || "",
  });
}

function defaultFeatureItemsFor(name, category, description, body = "", source = "personal") {
  const lower = `${name} ${category} ${description} ${body}`.toLowerCase();
  const items = [];

  addFeature(items, "trigger-routing", "触发判断", "判断用户请求是否应该使用这个 skill，并结合你的触发偏好决定是否先确认。");

  if (lower.includes("docx") || lower.includes("word") || lower.includes("document")) {
    addFeature(items, "document-create-edit", "创建和编辑 Word 文档", "生成、改写或整理 docx / Word 文档内容，保留标题、段落、表格和样式结构。");
    addFeature(items, "document-review-markup", "批注、红线和格式 QA", "处理批注、修订痕迹、格式检查和交付前版式核对。");
    addFeature(items, "document-render-verify", "渲染检查", "把文档渲染成预览图或 PDF 后检查页面是否错位、重叠、空白或样式异常。");
  } else if (lower.includes("spreadsheet") || lower.includes("excel") || lower.includes("csv")) {
    addFeature(items, "sheet-clean-analyze", "清洗和分析表格", "读取 CSV / Excel，清洗字段、汇总数据、生成透视类结果或统计分析。");
    addFeature(items, "sheet-formulas-charts", "公式、图表和格式", "写入公式、表格样式、图表和报表格式，并尽量保持可打开、可编辑。");
  } else if (lower.includes("pdf")) {
    addFeature(items, "pdf-read-extract", "读取和提取 PDF", "提取 PDF 文本、表格和页面信息，适合阅读、整理和比对内容。");
    addFeature(items, "pdf-render-verify", "PDF 渲染核查", "渲染页面并检查空白页、错位、字体和视觉版式问题。");
  } else if (lower.includes("figma")) {
    addFeature(items, "figma-read-context", "读取 Figma 上下文", "读取当前 Figma 文件、节点、组件、变量或设计结构，作为后续操作依据。");
    addFeature(items, "figma-write-design", "创建或修改 Figma 内容", "创建页面、节点、组件、变量、布局或图表，并按 Figma 工具约束执行。");
    addFeature(items, "figma-system-reuse", "复用设计系统", "优先使用已有组件、tokens 和变量，减少硬编码设计。");
  } else if (lower.includes("canva")) {
    addFeature(items, "canva-duplicate-transform", "复制并改造 Canva 设计", "保留原始设计，通过副本进行翻译、尺寸适配或品牌演示稿生成。");
    addFeature(items, "canva-export-prepare", "导出前整理", "检查不同尺寸、语言或页面版本，并准备可导出的结果。");
  } else if (lower.includes("github") || lower.includes("pull request") || lower.includes("ci checks")) {
    addFeature(items, "github-read-context", "读取 GitHub 上下文", "读取仓库、PR、Issue、检查项、评论或 review 线程，定位需要处理的内容。");
    addFeature(items, "github-implement-fix", "实现修复或回应", "根据 CI 日志、PR 评论或发布流程修改代码、提交、推送或创建 PR。");
  } else if (lower.includes("browser") || lower.includes("chrome") || lower.includes("playwright")) {
    addFeature(items, "browser-navigate-inspect", "打开和检查网页", "打开本地或远程网页，读取页面状态、DOM、标题、URL 和可见内容。");
    addFeature(items, "browser-interact-verify", "点击、填写和截图验证", "在真实浏览器里点击、填写、滚动、截图，并验证交互结果。");
  } else if (lower.includes("image")) {
    addFeature(items, "image-generate-edit", "生成或编辑位图", "生成插画、素材、海报、透明背景图或参考图变体。");
    addFeature(items, "image-asset-delivery", "交付图片资产", "保存可用图片文件，并按用途检查尺寸、透明度和视觉效果。");
  } else if (lower.includes("video") || lower.includes("hyperframes") || lower.includes("remotion")) {
    addFeature(items, "video-compose", "创建视频构图", "组织 HTML / React 视频场景、字幕、转场、动画和视觉节奏。");
    addFeature(items, "video-preview-render", "预览和渲染视频", "运行预览、检查画面，再导出可交付的视频结果。");
  } else if (lower.includes("obsidian") || lower.includes("markdown")) {
    addFeature(items, "notes-structure", "整理知识库结构", "创建或整理 Markdown、双链、属性、Canvas、Bases 和笔记索引。");
    addFeature(items, "notes-write-format", "写入 Obsidian 格式", "按 Obsidian 习惯生成 callout、嵌入、属性和链接格式。");
  } else if (lower.includes("skill") || lower.includes("plugin") || lower.includes("codex")) {
    addFeature(items, "codex-capability-design", "设计 Codex 能力", "创建或维护 skill / plugin 的说明、结构、触发条件和本地配置。");
    addFeature(items, "codex-install-manage", "安装和管理", "安装、更新、启用、禁用或整理本地 Codex 能力。");
  } else {
    addFeature(items, "specialized-workflow", "专项工作流", "按这个 skill 内置说明执行特定领域任务，而不是只用通用回答。");
    addFeature(items, "result-verification", "结果检查", "根据该 skill 的交付要求检查输出是否满足格式、工具和质量约束。");
  }

  addFeature(items, "output-preferences", "输出约定", "使用你在个性化设置里保存的默认输出要求、备注和使用前确认规则。");
  if (source !== "personal") {
    addFeature(
      items,
      "source-boundary",
      source === "system" ? "系统边界" : "插件边界",
      source === "system"
        ? "系统内置 skill 的加载规则和工具约束不能直接改写，只能在外部做说明、偏好和禁用层覆盖。"
        : "插件 skill 来自已安装插件缓存，真正的文件内容和工具权限不能在这里直接改写，只能做外部覆盖。",
      {
        enabled: true,
        lockedReason: source === "system"
          ? "系统内置 skill 属于 Codex 的内置能力，不能在控制台里直接改写源码或加载规则。"
          : "插件 skill 由插件缓存提供，直接改缓存会在更新或重装后丢失，也可能破坏插件校验。",
      }
    );
  }
  return items.slice(0, 8);
}

function normalizeFeatureItem(item, fallbackId, custom = false) {
  const title = String(item?.title || "").trim().slice(0, 80);
  const description = String(item?.description || "").trim().slice(0, 800);
  if (!title && !description) return null;
  return {
    id: String(item?.id || fallbackId || `custom-${hashId(`${title}:${description}`)}`).slice(0, 80),
    title: title || "未命名功能",
    description,
    enabled: item?.enabled !== false,
    custom: Boolean(custom || item?.custom),
    locked: Boolean(item?.locked),
    lockedReason: String(item?.lockedReason || "").slice(0, 300),
  };
}

function mergeFeatureSettings(defaultItems, saved) {
  const byId = new Map(defaultItems.map((item) => [item.id, { ...item }]));
  const customItems = [];
  const savedItems = Array.isArray(saved?.items) ? saved.items : [];
  for (const item of savedItems) {
    if (item?.custom) {
      const normalized = normalizeFeatureItem(item, item.id, true);
      if (normalized) customItems.push(normalized);
      continue;
    }
    const existing = byId.get(item?.id);
    if (!existing) continue;
    byId.set(item.id, {
      ...existing,
      title: String(item.title || existing.title).trim().slice(0, 80),
      description: String(item.description || existing.description).trim().slice(0, 800),
      enabled: item.enabled !== false,
    });
  }
  return { items: [...byId.values(), ...customItems].slice(0, 24) };
}

async function readJsonFile(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJsonFile(filePath, value) {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

async function walkForSkills(dir, depth, out) {
  if (depth < 0) return;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isFile() && entry.name === "SKILL.md") {
      out.push(fullPath);
      continue;
    }
    if (!entry.isDirectory()) continue;
    if ([".git", "node_modules", "__pycache__", "assets"].includes(entry.name)) continue;
    await walkForSkills(fullPath, depth - 1, out);
  }
}

async function walkJsonl(dir, depth, out) {
  if (depth < 0) return;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      out.push(fullPath);
      continue;
    }
    if (entry.isDirectory()) await walkJsonl(fullPath, depth - 1, out);
  }
}

function extractSkillPathsFromArguments(argumentsText) {
  const paths = [];
  if (!argumentsText || !argumentsText.includes("SKILL.md")) return paths;
  const normalized = argumentsText.replace(/\\\\/g, "\\");
  const regex = /[A-Za-z]:\\[^"'`\r\n]*?SKILL\.md/gi;
  for (const match of normalized.matchAll(regex)) {
    paths.push(match[0]);
  }
  return paths;
}

function extractSkillNameFromPath(skillPath) {
  const parts = skillPath.split(/[\\/]/).filter(Boolean);
  const index = parts.findIndex((part) => part === "skills");
  if (index >= 0 && parts[index + 1]) return parts[index + 1];
  return parts.at(-2) || null;
}

function recordUsage(usage, skillPath, timestamp, filePath) {
  const name = extractSkillNameFromPath(skillPath);
  if (!name) return;
  const entry = usage.byName[name] || {
    name,
    count: 0,
    lastUsedAt: null,
    lastSourceFile: null,
    paths: {},
  };
  entry.count += 1;
  entry.paths[skillPath] = (entry.paths[skillPath] || 0) + 1;
  if (!entry.lastUsedAt || String(timestamp || "") > String(entry.lastUsedAt)) {
    entry.lastUsedAt = timestamp || null;
    entry.lastSourceFile = filePath;
  }
  usage.byName[name] = entry;
  usage.total += 1;
}

async function scanSkillUsage() {
  const now = Date.now();
  if (usageCache && now - usageCache.loadedAt < 60_000) return usageCache.value;

  const files = [];
  await walkJsonl(sessionsDir, 4, files);
  await walkJsonl(archivedSessionsDir, 1, files);

  const usage = { byName: {}, total: 0, scannedFiles: files.length, scannedAt: new Date().toISOString() };
  for (const filePath of files) {
    let content = "";
    try {
      content = await readFile(filePath, "utf8");
    } catch {
      continue;
    }
    for (const line of content.split(/\r?\n/)) {
      if (!line.includes("SKILL.md")) continue;
      let item;
      try {
        item = JSON.parse(line);
      } catch {
        continue;
      }
      const payload = item.payload || {};
      if (payload.type !== "function_call") continue;
      const toolName = payload.name || "";
      if (!["shell_command", "js"].includes(toolName)) continue;
      for (const skillPath of extractSkillPathsFromArguments(payload.arguments || "")) {
        recordUsage(usage, skillPath, item.timestamp, filePath);
      }
    }
  }

  usageCache = { loadedAt: now, value: usage };
  return usage;
}

async function readConfigDisabledPaths() {
  const disabled = new Set();
  let content = "";
  try {
    content = await readFile(configPath, "utf8");
  } catch {
    return disabled;
  }

  const blocks = content.split(/\n(?=\[\[skills\.config\]\])/g);
  for (const block of blocks) {
    if (!block.includes("[[skills.config]]")) continue;
    const pathMatch = block.match(/^\s*path\s*=\s*"([^"]+)"/m);
    const enabledMatch = block.match(/^\s*enabled\s*=\s*(true|false)/m);
    if (pathMatch && enabledMatch?.[1] === "false") {
      disabled.add(pathMatch[1].replace(/\\\\/g, "\\"));
    }
  }
  return disabled;
}

async function listSkills() {
  const overrides = await readJsonFile(overridesPath, { summaries: {}, titles: {}, disabled: {}, deleted: {}, personalization: {}, featureSettings: {} });
  const configDisabled = await readConfigDisabledPaths();
  const usage = await scanSkillUsage();
  const candidates = [];
  await walkForSkills(join(codexHome, "skills"), 4, candidates);
  await walkForSkills(join(codexHome, "plugins", "cache"), 9, candidates);

  const seen = new Set();
  const skills = [];
  for (const filePath of candidates) {
    if (seen.has(filePath)) continue;
    seen.add(filePath);
    let markdown = "";
    try {
      markdown = await readFile(filePath, "utf8");
    } catch {
      continue;
    }
    const meta = parseFrontmatter(markdown);
    const name = meta.name || filePath.split(/[\\/]/).at(-2) || "unknown-skill";
    const description = meta.description || "";
    const body = bodyText(markdown).slice(0, 8000);
    const source = sourceFromPath(filePath);
    const category = categoryFor(name, description, body);
    const rel = relative(codexHome, filePath);
    const shortName = name.split(":").at(-1) || name;
    const disabled = Boolean(overrides.disabled?.[name]) || configDisabled.has(filePath);
    const deleted = Boolean(overrides.deleted?.[name]);
    const usageEntry = usage.byName[name] || usage.byName[shortName] || { count: 0, lastUsedAt: null, paths: {} };
    const usageExample = usageExampleFor(name, category, description);
    const skillShape = { name, source, category };
    const limits = capabilityLimitsFor(skillShape);
    const featureSettings = mergeFeatureSettings(
      defaultFeatureItemsFor(name, category, description, body, source),
      overrides.featureSettings?.[name] || {}
    );
    skills.push({
      id: hashId(filePath),
      name,
      title: overrides.titles?.[name] || name.split(":").at(-1) || name,
      source,
      sourceLabel: sourceLabel(source),
      category,
      enabled: !disabled && !deleted,
      locked: source === "system",
      deletable: source === "personal",
      path: filePath,
      relativePath: rel,
      description,
      cnSummary: summaryFor(name, description, body, overrides),
      triggers: triggerWords(name, description, body),
      tokenEstimate: estimateTokens(name, description),
      modifiedAt: (await stat(filePath)).mtime.toISOString(),
      usageCount: usageEntry.count || 0,
      lastUsedAt: usageEntry.lastUsedAt || null,
      examplePrompt: usageExample.examplePrompt,
      withoutSkillEffect: usageExample.withoutSkillEffect,
      personalization: overrides.personalization?.[name] || {
        triggerPreference: "",
        defaultOutput: "",
        confirmBeforeUse: false,
        notes: "",
      },
      featureSettings,
      customizationLimits: limits,
      deleted,
    });
  }

  for (const [name, record] of Object.entries(overrides.deletedRecords || {})) {
    if (skills.some((skill) => skill.name === name)) continue;
    skills.push({
      id: hashId(record.originalSkillPath || name),
      name,
      title: overrides.titles?.[name] || record.title || name,
      source: record.source || "personal",
      sourceLabel: sourceLabel(record.source || "personal"),
      category: record.category || "其他",
      enabled: false,
      locked: false,
      deletable: true,
      path: record.originalSkillPath || "",
      relativePath: record.originalSkillPath ? relative(codexHome, record.originalSkillPath) : "",
      description: record.description || "",
      cnSummary: overrides.summaries?.[name] || record.cnSummary || `已移入备份的个人 skill：${name}。`,
      triggers: record.triggers || [name],
      tokenEstimate: record.tokenEstimate || 0,
      modifiedAt: record.deletedAt || "",
      usageCount: usage.byName[name]?.count || 0,
      lastUsedAt: usage.byName[name]?.lastUsedAt || null,
      examplePrompt: usageExampleFor(name, record.category || "其他", record.description || "").examplePrompt,
      withoutSkillEffect: usageExampleFor(name, record.category || "其他", record.description || "").withoutSkillEffect,
      personalization: overrides.personalization?.[name] || {
        triggerPreference: "",
        defaultOutput: "",
        confirmBeforeUse: false,
        notes: "",
      },
      featureSettings: mergeFeatureSettings(
        defaultFeatureItemsFor(name, record.category || "其他", record.description || "", "", record.source || "personal"),
        overrides.featureSettings?.[name] || {}
      ),
      customizationLimits: capabilityLimitsFor({ name, source: record.source || "personal", category: record.category || "其他" }),
      deleted: true,
      backupPath: record.backupPath || "",
    });
  }
  const latestByName = new Map();
  for (const skill of skills) {
    const existing = latestByName.get(skill.name);
    if (!existing || String(skill.modifiedAt || "") > String(existing.modifiedAt || "")) {
      latestByName.set(skill.name, skill);
    }
  }
  return Array.from(latestByName.values()).sort((a, b) => a.name.localeCompare(b.name));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

async function backupFile(filePath) {
  let content = "";
  try {
    content = await readFile(filePath, "utf8");
  } catch {
    return null;
  }
  const target = join(backupRoot, nowStamp(), relative(homedir(), filePath).replace(/[\\/]/g, "__"));
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
  return target;
}

async function saveOverrides(patch) {
  const overrides = await readJsonFile(overridesPath, { summaries: {}, titles: {}, disabled: {}, deleted: {}, personalization: {}, featureSettings: {} });
  overrides.summaries ||= {};
  overrides.titles ||= {};
  overrides.disabled ||= {};
  overrides.deleted ||= {};
  overrides.deletedRecords ||= {};
  overrides.personalization ||= {};
  overrides.featureSettings ||= {};

  if (patch.name) {
    if (typeof patch.cnSummary === "string") overrides.summaries[patch.name] = patch.cnSummary;
    if (typeof patch.title === "string") overrides.titles[patch.name] = patch.title;
    if (typeof patch.enabled === "boolean") {
      if (patch.enabled) delete overrides.disabled[patch.name];
      else overrides.disabled[patch.name] = true;
    }
    if (typeof patch.deleted === "boolean") {
      if (patch.deleted) overrides.deleted[patch.name] = true;
      else delete overrides.deleted[patch.name];
    }
    if (patch.personalization && typeof patch.personalization === "object") {
      overrides.personalization[patch.name] = {
        triggerPreference: String(patch.personalization.triggerPreference || ""),
        defaultOutput: String(patch.personalization.defaultOutput || ""),
        confirmBeforeUse: Boolean(patch.personalization.confirmBeforeUse),
        notes: String(patch.personalization.notes || ""),
      };
    }
    if (patch.featureSettings && typeof patch.featureSettings === "object") {
      const items = Array.isArray(patch.featureSettings.items) ? patch.featureSettings.items : [];
      overrides.featureSettings[patch.name] = {
        items: items
          .map((item, index) => normalizeFeatureItem(item, item?.id || `${patch.name}-${index}`, Boolean(item?.custom)))
          .filter(Boolean),
      };
    }
  }

  await writeJsonFile(overridesPath, overrides);
  return overrides;
}

function configBlockFor(skill) {
  const relativeSkillPath = skill.path.replace(/\\/g, "\\\\");
  return [
    "[[skills.config]]",
    `path = "${relativeSkillPath}"`,
    `enabled = ${skill.enabled ? "true" : "false"}`,
  ].join("\n");
}

async function applyConfig(skills) {
  const allSkills = await listSkills();
  const byName = new Map(allSkills.map((skill) => [skill.name, skill]));
  const selected = skills
    .map((item) => {
      const skill = byName.get(item.name);
      return skill ? { ...skill, enabled: Boolean(item.enabled) } : null;
    })
    .filter(Boolean)
    .filter((skill) => !skill.enabled);

  await backupFile(configPath);
  let existing = "";
  try {
    existing = await readFile(configPath, "utf8");
  } catch {
    existing = "";
  }

  const withoutController = existing
    .replace(/\n?# BEGIN skill-controller[\s\S]*?# END skill-controller\n?/g, "\n")
    .trimEnd();
  const blockLines = selected.length
    ? selected.map(configBlockFor)
    : ["# No skills disabled by skill-controller."];
  const block = ["# BEGIN skill-controller", ...blockLines, "# END skill-controller", ""].join("\n\n");
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, `${withoutController}${withoutController ? "\n\n" : ""}${block}`, "utf8");

  return { applied: selected.length, configPath };
}

async function deleteSkill(name) {
  const skills = await listSkills();
  const skill = skills.find((item) => item.name === name);
  if (!skill) return { ok: false, error: "Skill not found" };
  if (!skill.deletable) {
    await saveOverrides({ name, enabled: false });
    return { ok: true, action: "disabled", message: "Only personal skills can be physically deleted. This skill was disabled instead." };
  }

  const skillDir = dirname(skill.path);
  const targetDir = join(backupRoot, nowStamp(), `deleted-${name.replace(/[^a-zA-Z0-9_-]/g, "-")}`);
  await mkdir(dirname(targetDir), { recursive: true });
  await rename(skillDir, targetDir);
  const overrides = await readJsonFile(overridesPath, { summaries: {}, titles: {}, disabled: {}, deleted: {}, deletedRecords: {} });
  overrides.summaries ||= {};
  overrides.titles ||= {};
  overrides.disabled ||= {};
  overrides.deleted ||= {};
  overrides.deletedRecords ||= {};
  overrides.disabled[name] = true;
  overrides.deleted[name] = true;
  overrides.deletedRecords[name] = {
    name,
    title: skill.title,
    source: skill.source,
    category: skill.category,
    originalDir: skillDir,
    originalSkillPath: skill.path,
    backupPath: targetDir,
    description: skill.description,
    cnSummary: skill.cnSummary,
    triggers: skill.triggers,
    tokenEstimate: skill.tokenEstimate,
    deletedAt: new Date().toISOString(),
  };
  await writeJsonFile(overridesPath, overrides);
  return { ok: true, action: "moved", targetDir };
}

async function restoreSkill(name) {
  const overrides = await readJsonFile(overridesPath, { summaries: {}, titles: {}, disabled: {}, deleted: {}, deletedRecords: {} });
  const record = overrides.deletedRecords?.[name];
  if (record?.backupPath && record?.originalDir) {
    try {
      await mkdir(dirname(record.originalDir), { recursive: true });
      await rename(record.backupPath, record.originalDir);
    } catch {
      // Keep restore idempotent if the user already moved the folder manually.
    }
  }
  delete overrides.deleted?.[name];
  delete overrides.disabled?.[name];
  delete overrides.deletedRecords?.[name];
  await writeJsonFile(overridesPath, overrides);
  return { ok: true };
}

async function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body, null, 2));
}

function safeStaticPath(pathname) {
  const requested = pathname === "/" ? "/skill-controller-mockup.html" : pathname;
  const filePath = normalize(join(root, decodeURIComponent(requested)));
  if (!filePath.startsWith(root)) return null;
  return filePath;
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (req.method === "GET" && url.pathname === "/api/health") {
      await sendJson(res, 200, { ok: true, root, codexHome, configPath, overridesPath });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/skills") {
      await sendJson(res, 200, { skills: await listSkills() });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/usage") {
      await sendJson(res, 200, { ok: true, usage: await scanSkillUsage() });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/summary") {
      const body = await readBody(req);
      await saveOverrides(body);
      await sendJson(res, 200, { ok: true });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/personalization") {
      const body = await readBody(req);
      await saveOverrides(body);
      await sendJson(res, 200, { ok: true });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/feature-settings") {
      const body = await readBody(req);
      await saveOverrides(body);
      await sendJson(res, 200, { ok: true });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/apply") {
      const body = await readBody(req);
      const result = await applyConfig(Array.isArray(body.skills) ? body.skills : []);
      await sendJson(res, 200, { ok: true, ...result });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/delete") {
      const body = await readBody(req);
      await sendJson(res, 200, await deleteSkill(body.name));
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/restore") {
      const body = await readBody(req);
      await sendJson(res, 200, await restoreSkill(body.name));
      return;
    }

    const filePath = safeStaticPath(url.pathname);
    if (!filePath) {
      res.writeHead(403).end("Forbidden");
      return;
    }
    const body = await readFile(filePath);
    res.writeHead(200, {
      "content-type": types.get(extname(filePath)) || "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(body);
  } catch (error) {
    await sendJson(res, 500, { ok: false, error: error.message || "Server error" });
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`skill-controller listening on http://127.0.0.1:${port}/`);
});
