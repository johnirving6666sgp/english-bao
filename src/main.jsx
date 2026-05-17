import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  BarChart3,
  Bot,
  CalendarDays,
  ChevronDown,
  FileText,
  Inbox,
  Search,
  Sparkles
} from 'lucide-react';
import { agentReports, reportAgents } from './reportsData';
import './styles.css';

const agentDescriptions = {
  企业AI大师: '企业 AI、Agentic Enterprise 与兆精 summit',
  港股大师: '港股价值洼地、华领模式与观察清单',
  日股大师: '日股机会与日本市场观察',
  美股大师: '美股科技长线、热点公司与复盘',
  A股大师: 'A股龙头预测与热点轮动',
  总管AIJamie: '跨市场统筹、综合结论与杂项输出'
};

function App() {
  const [activeAgent, setActiveAgent] = useState(reportAgents[0]);
  const [activeReportId, setActiveReportId] = useState('');
  const [query, setQuery] = useState('');

  const groupedReports = useMemo(
    () =>
      Object.fromEntries(
        reportAgents.map((agent) => [
          agent,
          agentReports.filter((report) => report.agent === agent)
        ])
      ),
    []
  );

  const visibleReports = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return (groupedReports[activeAgent] || []).filter((report) => {
      if (!keyword) return true;
      return [report.title, report.summary, report.date, report.source, report.raw]
        .join(' ')
        .toLowerCase()
        .includes(keyword);
    });
  }, [activeAgent, groupedReports, query]);

  const latestDate = agentReports[0]?.date || '--';
  const activeCount = groupedReports[activeAgent]?.length || 0;

  return (
    <main className="app-shell">
      <section className="reader">
        <header className="hero">
          <div className="brand">
            <div className="brand-mark">
              <Inbox size={23} />
            </div>
            <div>
              <strong>OpenClaw 输出看板</strong>
              <span>Obsidian reports 阅读页</span>
            </div>
          </div>

          <div className="hero-copy">
            <p className="eyebrow">Agent Reports</p>
            <h1>六个大师板块</h1>
            <p>从 Obsidian vault 的 agents/reports 读取报告，按 Agent 汇总成手机优先阅读流。</p>
          </div>
        </header>

        <section className="metric-row" aria-label="报告概览">
          <Metric icon={Bot} label="板块" value={reportAgents.length} />
          <Metric icon={FileText} label="报告" value={agentReports.length} />
          <Metric icon={CalendarDays} label="最新" value={latestDate.slice(5)} />
        </section>

        <label className="search-box" htmlFor="search">
          <Search size={17} />
          <input
            id="search"
            value={query}
            placeholder="搜索标题、摘要、原文"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>

        <section className="agent-tabs" aria-label="Agent 板块">
          {reportAgents.map((agent) => (
            <button
              key={agent}
              className={activeAgent === agent ? 'active' : ''}
              onClick={() => {
                setActiveAgent(agent);
                setActiveReportId('');
              }}
            >
              <span>{agent}</span>
              <strong>{groupedReports[agent]?.length || 0}</strong>
            </button>
          ))}
        </section>

        <section className="board-head">
          <div>
            <p className="eyebrow">{activeAgent}</p>
            <h2>{agentDescriptions[activeAgent]}</h2>
          </div>
          <div className="status-pill">
            <Sparkles size={17} />
            {activeCount} 条
          </div>
        </section>

        <section className="report-stack" aria-label={`${activeAgent} 报告列表`}>
          {visibleReports.map((report) => (
            <ReportCard
              key={report.id}
              report={report}
              expanded={activeReportId === report.id}
              onToggle={() => setActiveReportId(activeReportId === report.id ? '' : report.id)}
            />
          ))}
          {!visibleReports.length && (
            <article className="empty-state">
              <BarChart3 size={22} />
              <strong>这个板块暂时没有匹配报告</strong>
              <span>如果 vault 里新增了对应 Agent 输出，重新生成数据后会出现在这里。</span>
            </article>
          )}
        </section>
      </section>
    </main>
  );
}

function Metric({ icon: Icon, label, value }) {
  return (
    <div className="metric">
      <Icon size={18} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ReportCard({ report, expanded, onToggle }) {
  return (
    <article className="report-card">
      <button className="report-summary" onClick={onToggle}>
        <div className="report-meta">
          <span>
            <CalendarDays size={14} />
            {report.date}
          </span>
          <span>{report.source}</span>
        </div>
        <h3>{report.title}</h3>
        <p>{report.summary}</p>
        <div className="expand-line">
          <span>{expanded ? '收起原文' : '展开原文'}</span>
          <ChevronDown className={expanded ? 'rotated' : ''} size={17} />
        </div>
      </button>

      {expanded && (
        <div className="report-detail">
          <section>
            <h4>要点</h4>
            <ul>
              {report.bullets.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
          <section>
            <h4>原文</h4>
            <pre>{report.raw}</pre>
          </section>
        </div>
      )}
    </article>
  );
}

createRoot(document.getElementById('root')).render(<App />);
