# 英语学习宝

雅思词汇真经练习工具。当前版本把 Obsidian 里的词汇、中文释义和例句整理成前端练习台，支持例句跟读和中文例句复写英文表达。

## 功能

- 22 个雅思词汇章节，1601 条词条
- 按章节、主题和关键词筛选
- 例句自然带读：先自然读一遍，再按意群慢速带读
- 预生成例句音频：优先播放高质量 AI 音频，没有音频时回退到浏览器朗读
- 跟读识别：显示浏览器识别内容并给出参考分
- 造句表达：显示中文例句，输入英文表达，结束后显示原例句
- 小章节进度统计和完成鼓励
- 写作训练：提交后保存 7 分示范范文，并可生成/缓存高品质朗读音频

## 启动

```bash
npm install
npm run dev
```

默认访问：

```text
http://localhost:5173/
```

## 构建

```bash
npm run build
```

## 生成例句音频

例句音频不会在浏览器里实时调用 API，而是提前生成到 `public/audio/examples/`，同时更新 `src/exampleAudioManifest.js`。

先设置 OpenAI API key：

```bash
export OPENAI_API_KEY="your_api_key"
```

也可以在本机新建不会提交到 Git 的 `.env.local`：

```text
OPENAI_API_KEY=your_api_key
```

试跑前 5 条：

```bash
npm run audio:examples:dry
npm run audio:examples -- --limit=5
```

生成全部例句：

```bash
npm run audio:examples
```

可选配置：

```bash
OPENAI_TTS_MODEL=gpt-4o-mini-tts OPENAI_TTS_VOICE=coral npm run audio:examples
```

线上写作 7 分范文和高品质朗读音频使用 Cloudflare Pages Functions。需要配置：

- `OPENAI_API_KEY`
- `WRITING_CACHE` KV binding
- 可选：`OPENAI_TTS_MODEL`、`OPENAI_TTS_VOICE`、`OPENAI_WRITING_TTS_VOICE`

语音识别依赖浏览器 Web Speech API，建议使用 Chrome 或支持麦克风权限的现代浏览器。
