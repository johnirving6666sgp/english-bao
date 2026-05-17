import fs from 'node:fs/promises';
import path from 'node:path';

const reportsDir = '/Users/aijamie4bc/Documents/AIJamie/agents/reports';
const outFile = path.resolve('src/reportsData.js');
const agents = ['企业AI大师', '港股大师', '日股大师', '美股大师', 'A股大师', '总管AIJamie'];

function inferAgent(title, fallbackContent) {
  const text = `${title}\n${fallbackContent.slice(0, 600)}`;
  if (/企业AI|企业 AI|企业级AI|企业级 AI|兆精summit|兆精|Agentic Enterprise|企业.*Agent/.test(text)) {
    return '企业AI大师';
  }
  if (/港股|华领|HK|\.HK|恒生|港交所/.test(text)) return '港股大师';
  if (/日股|日本|东京|Nikkei|TOPIX|日经/.test(text)) return '日股大师';
  if (/A股|沪深|上证|深证|创业板|龙头预测|热点轮动/.test(text)) return 'A股大师';
  if (/总管|AIJamie|总览|总监|统筹/.test(text)) return '总管AIJamie';
  if (/美股|科技长线|王者归来|NASDAQ|Nasdaq|S&P|NVIDIA|Microsoft|Tesla|\.US/.test(text)) {
    return '美股大师';
  }
  return '总管AIJamie';
}

function stripMarkdown(value) {
  return value
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/[_#>*-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function summaryFor(raw) {
  const lines = raw
    .split('\n')
    .map((line) => stripMarkdown(line))
    .filter((line) => line && !/^生成时间/.test(line));
  return (lines.find((line) => line.length > 24) || lines[0] || '暂无摘要').slice(0, 150);
}

function bulletsFor(raw) {
  const bullets = raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line))
    .map((line) => stripMarkdown(line.replace(/^[-*]\s+/, '')))
    .filter(Boolean)
    .slice(0, 4);
  return bullets.length ? bullets : [summaryFor(raw)];
}

function splitSections(content, date) {
  const matches = [...content.matchAll(/^(#{1,2})\s+(.+)$/gm)];
  if (!matches.length) {
    const title = `${date} 报告`;
    return [{ title, raw: content.trim(), agent: inferAgent(title, content) }];
  }

  const sections = [];
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const title = match[2].trim();
    const start = match.index;
    const end = matches[index + 1]?.index ?? content.length;
    const raw = content.slice(start, end).trim();
    const agent = inferAgent(title, raw);
    const isSubsection = !agents.some((name) => title.includes(name)) && index > 0;
    if (isSubsection && sections.length && sections.at(-1).agent === agent) {
      sections.at(-1).raw = `${sections.at(-1).raw}\n\n${raw}`;
    } else {
      sections.push({ title, raw, agent });
    }
  }
  return sections.filter((section) => section.raw.length > 40);
}

async function main() {
  const files = (await fs.readdir(reportsDir)).filter((name) => name.endsWith('.md')).sort();
  const reports = [];

  for (const fileName of files) {
    const date = fileName.replace(/\.md$/, '');
    const content = await fs.readFile(path.join(reportsDir, fileName), 'utf8');
    splitSections(content, date).forEach((section, index) => {
      reports.push({
        id: `${date}-${index}`,
        agent: section.agent,
        date,
        title: stripMarkdown(section.title.replace(/^#+\s*/, '')).slice(0, 80),
        summary: summaryFor(section.raw),
        bullets: bulletsFor(section.raw),
        raw: section.raw,
        source: fileName
      });
    });
  }

  reports.sort((a, b) => b.date.localeCompare(a.date));
  const source = `export const reportAgents = ${JSON.stringify(agents, null, 2)};\n\nexport const agentReports = ${JSON.stringify(reports, null, 2)};\n`;
  await fs.writeFile(outFile, source);
  console.log(`Synced ${reports.length} report sections from ${reportsDir}`);
  for (const agent of agents) {
    console.log(`${agent}: ${reports.filter((report) => report.agent === agent).length}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
