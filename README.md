# OpenClaw 输出看板

OpenClaw 输出看板用于把 Obsidian vault 中 `agents/reports` 下的 Agent 报告整理成一个手机优先的阅读页面。当前按六个板块组织：企业AI大师、港股大师、日股大师、美股大师、A股大师、总管AIJamie。

## 功能

- 从 `/Users/aijamie4bc/Documents/AIJamie/agents/reports` 生成报告快照
- 按六个 Agent 板块浏览报告
- 搜索标题、摘要和原文
- 默认显示摘要，点开后阅读要点和原始 Markdown
- 保留空板块，方便后续接入日股大师等新增输出

## 当前接入方式

当前版本生成了一个前端数据快照：`src/reportsData.js`。如果 Obsidian 里的报告更新，运行：

```bash
npm run sync:reports
```

然后刷新页面即可。

## 启动

```bash
npm install
npm run dev
```
