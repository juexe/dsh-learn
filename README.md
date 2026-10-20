# dsh-learn

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 工作区的包依赖图与「模型可见注册面」静态分析工具。

读取一份 harness 检出，提取 `packages/<group>/<pkg>` 之间的 `peerDependencies` 依赖边，扫描源码中三类面向模型的注册调用点，最后生成**一个自包含的 HTML 文件**——直接打开就能交互式浏览 342 个包、973 条 peer 边与全部注册面，无需服务器、无外部请求。

[![Node.js](https://img.shields.io/badge/node-%E2%89%A522.19-informational)](https://nodejs.org/)
[![Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)](#设计取舍)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

![分组总览：52 个分组折叠为节点，边按条数聚合](docs/screenshots/overview.png)

## 为什么需要

DeepSeek Harness 是「一切皆插件」的 agent harness：`packages/` 下划分 52 个分组、数百个 npm 包，包与包之间通过 `peerDependencies` 共享实例。想回答下面这些问题，翻 manifest 和源码都不直观：

- 谁依赖了 `session`？`core` 组向外拉了多少依赖？
- 依赖图里有没有环？最深的依赖链有多长？
- 哪些包注册了模型可调用的工具？名字是写死的还是运行期算出来的？

dsh-learn 把这两类信息抽成结构化数据，再渲染成可下钻的图：

- **依赖面**：包级 peer 边、分组聚合、扇入/扇出、可选依赖、Tarjan 强连通分量（环检测）、依赖深度。
- **注册面**：静态扫描 `ctx.tools.register()`、`ctx.systemPrompt.section()`、`ctx.systemPrompt.context()` 三类调用点，给出工具名、section 名、运行时上下文名，并标注源码位置。

对 `dsh` `0.2.1-rc.2` 检出的结果：**342 个包 / 52 个分组 / 973 条 peer 边 / 67 个工具 / 33 个 section / 8 个运行时上下文 / 6 处动态注册**（注册数按「包 + 名称」去重）。

## 页面功能

| 视图 | 内容 |
| --- | --- |
| 分组总览 | 每个分组折叠成一个节点，跨组 peer 边按条数聚合，线越粗边越多；边阈值下拉可只看主干依赖 |
| 分组下钻 | 组内包级节点 + 组外折叠节点；区分对外依赖、被依赖、可选依赖（虚线）三类边 |
| 包详情 | 路径、版本、扇入/扇出、依赖与被依赖清单，可沿 chip 跳转到相关包 |
| 注册清单 | 一行一个注册包，列出工具/section/上下文名称；点行跳回该包所在的依赖图位置 |

交互：点节点看详情或下钻、滚轮缩放、拖拽平移、`适应窗口` 复位；搜索框按名称筛选（分组视图内同时匹配包名与描述），`/` 聚焦搜索，`Esc` 退回上一层。当前分组写在 URL hash（`#group/core`）里，可直接分享。

<table>
<tr>
<td width="50%"><img src="docs/screenshots/package-details.png" alt="包详情：依赖高亮与依赖/被依赖清单"></td>
<td width="50%"><img src="docs/screenshots/registry.png" alt="注册清单：工具、section 与运行时上下文"></td>
</tr>
<tr>
<td align="center">悬停或点选节点会高亮它的直接依赖与被依赖</td>
<td align="center">注册清单可按包名、工具名或 section 名过滤</td>
</tr>
</table>

## 快速开始

需要 [Node.js](https://nodejs.org/) `>= 22.19`，以及一份 DeepSeek Harness 源码检出。项目零依赖，`pnpm install` 可以跳过；脚本只调用 `node`，用 npm/yarn 或直接 `node scripts/*.mjs` 都可以。

```sh
git clone https://github.com/Juexe/dsh-learn.git
cd dsh-learn

# 指向你的 harness 检出，三选一（优先级从高到低）
# 1) 命令行参数：node scripts/extract.mjs --root /path/to/deepseek-harness
# 2) 环境变量
export DSH_REPO_ROOT=/path/to/deepseek-harness     # PowerShell: $env:DSH_REPO_ROOT = 'D:\path\to\deepseek-harness'
# 3) 机器本地配置（已 Git 忽略，适合多人/多机协作）
echo '{ "root": "/path/to/deepseek-harness" }' > repo-root.local.json
# 都不配则用仓库内已提交的 repo-root.json，默认值 ../deepseek-harness

pnpm build    # extract → analyze → scan → page，生成 data/*.json 与 deliverables/index.html
pnpm check    # 校验页面数据不变量，并与检出里的 docs/tool-catalog.md 交叉对比
pnpm serve    # 起本地静态服务，输出 http://127.0.0.1:<端口>/
```

也可以直接打开 `deliverables/index.html`（已在 Git 中）：它是单文件、无外部资源，`file://` 协议下同样可用。

## 工作原理

```text
① extract    packages/*/*/package.json        → data/packages.json
② analyze    data/packages.json               → data/analysis.json
③ scan       packages/*/*/src/**/*.ts         → data/registrations.json
④ page       data/*.json + page.template.html → deliverables/index.html
⑤ check      deliverables/index.html           → 数据不变量 + 工具目录交叉验证
```

| 脚本 | 职责 |
| --- | --- |
| [`scripts/paths.mjs`](scripts/paths.mjs) | 统一解析外部检出根路径与项目内路径 |
| [`scripts/extract.mjs`](scripts/extract.mjs) | 读取 manifest 与 `README` 摘要，产出包清单与 `problems` |
| [`scripts/analyze.mjs`](scripts/analyze.mjs) | 扇入/扇出、分组聚合、Tarjan 环检测、依赖深度 |
| [`scripts/scan-registrations.mjs`](scripts/scan-registrations.mjs) | 静态扫描三类注册调用点并解析注册名 |
| [`scripts/build-page.mjs`](scripts/build-page.mjs) | 把 JSON 注入模板，生成单文件页面 |
| [`scripts/verify-page.mjs`](scripts/verify-page.mjs) | 校验页面内嵌数据的总量与图结构不变量 |
| [`scripts/crosscheck-tools.mjs`](scripts/crosscheck-tools.mjs) | 与检出中由启动插件生成的 `docs/tool-catalog.md` 对比 |
| [`scripts/serve.mjs`](scripts/serve.mjs) | 在 `127.0.0.1` 临时端口托管 `deliverables/` |
| [`scripts/check-*.js`](scripts/check-layout.js) | 在浏览器页面上下文里求值的布局/交互/注册清单检查脚本 |
| [`src/page.template.html`](src/page.template.html) | 带 `__DATA__` 占位符的页面模板（原生 HTML/SVG/JS） |

`data/` 是中间产物并被 Git 忽略，`deliverables/index.html` 作为可审阅的构建产物入库——数据变化会在 diff 中体现。

## 命令

| 命令 | 作用 |
| --- | --- |
| `pnpm build` | 依次执行 extract → analyze → scan → page |
| `pnpm extract` / `analyze` / `scan` / `page` | 单独执行某个阶段 |
| `pnpm verify` | 校验页面内嵌数据不变量，通过时输出 `OK: no inconsistencies` |
| `pnpm crosscheck` | 静态扫描 vs. 工具目录；非预期差异以非零码退出 |
| `pnpm check` | `verify` + `crosscheck` |
| `pnpm serve` | 在 `127.0.0.1` 临时端口托管 `deliverables/` |

读取外部检出的脚本都接受 `--root <path>`，优先级为 `--root` → `DSH_REPO_ROOT` → `repo-root.local.json` → `repo-root.json`。候选按优先级依次校验，第一个指向没有 `packages/` 或 `package.json` 的目录就立即报错，不会静默跳到下一个。

## 部署

[`.github/workflows/pages.yml`](.github/workflows/pages.yml) 在推送 `main` 或手动触发时，先跑 `verify-page.mjs` 校验已提交页面的数据不变量，再把 `deliverables/` 发布到 GitHub Pages。CI 不重新构建，因为构建依赖外部 harness 检出；页面版本由本地 `pnpm build` 决定。

启用方式：仓库 Settings → Pages → Source 选择 **GitHub Actions**，之后访问 `https://juexe.github.io/dsh-learn/`。

## 开发

改动 `scripts/` 或 `src/page.template.html` 后：

```sh
pnpm build && pnpm check
git status --porcelain    # 只应出现 deliverables/index.html；数据没变则无改动
```

`data/` 与 `deliverables/index.html` 都是生成物，不要手改；要变更展示逻辑就改脚本或模板后重建。

页面交互改动还需要在真实浏览器里验证：`pnpm serve` 打开页面，在页面上下文里执行 [`scripts/check-layout.js`](scripts/check-layout.js)（逐组检查节点重叠与标签裁切）、[`scripts/check-interactions.js`](scripts/check-interactions.js)（筛选、搜索、视图切换）、[`scripts/check-registry.js`](scripts/check-registry.js)（注册清单搜索与点击跳转）。画布节点点击要用真实鼠标输入验证，合成 `click()` 会绕过指针捕获逻辑。

## 设计取舍

- **零依赖**：只用 Node 标准库；页面是原生 HTML/SVG/JS，无框架、无 CDN、无网络请求，克隆下来就能跑。
- **不臆造数据**：注册名只在能从字面量、同文件常量、跨包导出常量、工厂函数、配置默认值或模板插值中确定时给出；确定不了的归入 `unresolved`，页面显示为 `动态`，并保留源码位置。
- **交叉验证优先**：`crosscheck-tools.mjs` 要求静态扫描与运行期生成的 `docs/tool-catalog.md` 之间每处差异都属于已知且可解释的规则（如 MCP 工具由运行期生成、某个工具名由 load-time 配置决定），出现新差异即失败——用来暴露提取器的盲区或上游结构变更。
- **产物入库**：单文件 HTML 便于 review、存档与直接分享，不需要每次都重建。

## 已知限制

- 分析对象是**外部检出**，与版本紧耦合：`verify-page.mjs` 固定了当前检出的总量（342 包 / 52 组 / 973 边），换版本需要同步更新这些期望值。
- 只统计 `packages/<group>/<pkg>`。落在 `apps/`、`native/`、`vendor/` 的包不在范围内，指向它们的运行期依赖会记入 `problems`。
- 只扫描 `.ts` 源码，跳过 `.spec.ts`、`.d.ts` 与 `node_modules`；`.tsx`/`.js` 中的注册点不会被收集。
- 注册名解析是正则启发式，不构建语法树；跨文件工厂或动态拼接的字符串会被判为 `动态`。

## 环境

Node.js `>= 22.19`（纯 ESM）。页面面向现代常青浏览器，宽度依赖 Canvas `measureText` 做标签度量。

## License

[MIT](LICENSE)
