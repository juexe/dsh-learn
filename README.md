# dsh-learn

### **在线使用 → <https://juexe.github.io/dsh-learn/>**（无需安装，打开即用）

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的包依赖图与「模型可见注册面」静态分析。342 个包、52 个分组、973 条 `peerDependencies` 边，以及全部工具、提示词 section 与运行时上下文的注册点，都装在**一个可下钻的单文件页面**里——零依赖、无外部请求，也能下载下来离线打开。

[![Live demo](https://img.shields.io/badge/live-juexe.github.io%2Fdsh--learn-3b5bdb)](https://juexe.github.io/dsh-learn/)
[![Node.js](https://img.shields.io/badge/node-%E2%89%A522.19-informational)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

![分组总览：52 个分组折叠为节点，边按条数聚合](docs/screenshots/overview.png)

## 能回答什么

- 谁依赖了 `session`？哪些包才是真正的枢纽？
- 有多少跨组依赖？依赖图里有环吗？最深的链有几层？
- 哪些包注册了模型可调用的工具？名字是写死的还是运行期算出来的？

点击节点下钻或查看详情，滚轮缩放、拖拽平移，`/` 聚焦搜索，`Esc` 返回上一层；当前分组写在 URL hash（`#group/core`）里，可直接分享。

<table>
<tr>
<td width="50%"><img src="docs/screenshots/package-details.png" alt="包详情：依赖高亮与依赖/被依赖清单"></td>
<td width="50%"><img src="docs/screenshots/registry.png" alt="注册清单：工具、section 与运行时上下文"></td>
</tr>
<tr>
<td align="center">点选节点高亮它的直接依赖与被依赖</td>
<td align="center">注册清单可按包名、工具名或 section 名过滤</td>
</tr>
</table>

## 当前数据

对 `dsh` `0.2.1-rc.2` 检出的结果：

| 指标 | 值 |
| --- | --- |
| 包 / 分组 / peer 边 | 342 / 52 / 973（其中可选边 40） |
| 跨组边 / 组内边 | 833 / 140 |
| 依赖环 | 0；最长依赖链 12 层 |
| 扇入最高 | `session` 100、`llm` 93、`agent` 80 |
| 工具 / section / 运行时上下文 | 67 / 33 / 8，来自 45 个包；另有 6 处动态注册（按「包 + 名称」去重） |

## 本地重建

页面已随仓库发布，一般不需要重建。要对自己的 harness 检出重新生成：

```sh
git clone https://github.com/juexe/dsh-learn.git && cd dsh-learn

export DSH_REPO_ROOT=/path/to/deepseek-harness   # 也可用 --root <path> 或 repo-root.local.json
pnpm build && pnpm check
pnpm serve
```

需要 Node.js `>= 22.19`；零依赖，`pnpm install` 可以跳过。根路径按 `--root` → `DSH_REPO_ROOT` → `repo-root.local.json` → `repo-root.json` 解析，指向无效目录会直接报错。

## 原理

```text
extract    packages/*/*/package.json   → data/packages.json
analyze    扇入扇出、分组聚合、Tarjan   → data/analysis.json
scan       packages/*/*/src/**/*.ts    → data/registrations.json
page       以上数据 + 页面模板          → deliverables/index.html
check      数据不变量 + 工具目录交叉验证
```

脚本都在 `scripts/`（`extract` / `analyze` / `scan-registrations` / `build-page` / `verify-page` / `crosscheck-tools` / `serve`），页面模板是 `src/page.template.html`。`data/` 是 Git 忽略的中间产物，`deliverables/index.html` 作为可审阅的构建产物入库。

两条刻意的约束：

- **不臆造数据**。注册名只在能从字面量、同文件常量、跨包导出、工厂函数、配置默认值或模板插值中确定时给出；确定不了的标为「动态」，并保留源码位置。
- **交叉验证**。`crosscheck-tools.mjs` 把静态扫描与检出中运行期生成的 `docs/tool-catalog.md` 逐项对比，差异必须命中已知且可解释的规则，否则失败——用来暴露提取器的盲区。

## 已知限制

- 只分析 `packages/<group>/<pkg>`，不含 `apps/`、`native/`、`vendor/`。
- 只扫 `.ts`（跳过 `.spec.ts`、`.d.ts`、`node_modules`），正则解析、不构建语法树。
- `verify-page.mjs` 固定了当前检出的总量，跟进上游版本时需同步更新期望值。

## License

[MIT](LICENSE)
