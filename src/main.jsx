import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ChevronLeft,
  ChevronRight,
  Languages,
  Mic,
  MicOff,
  Search,
  Shuffle,
  Sparkles,
  Volume2
} from 'lucide-react';
import { generatedExampleTranslations } from './exampleTranslations';
import { vocabChapters } from './vocabData';
import './styles.css';

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition || null;

const normalize = (value) =>
  value
    .toLowerCase()
    .replace(/[“”"'.?,!/;:()[\]{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const flattenEntries = (chapters) =>
  chapters.flatMap((chapter) =>
    chapter.sections.flatMap((section) =>
      section.entries.map((entry, index) => ({
        ...entry,
        id: `${chapter.id}-${section.title}-${index}-${entry.term}`,
        chapterId: chapter.id,
        chapterTitle: chapter.title,
        sectionTitle: section.title
      }))
    )
  );

const scoreSpeech = (expected, spoken) => {
  const expectedWords = normalize(expected).split(' ').filter(Boolean);
  const spokenWords = normalize(spoken).split(' ').filter(Boolean);
  if (!spokenWords.length) return 0;
  const matched = expectedWords.filter((word) => spokenWords.includes(word)).length;
  return Math.round((matched / Math.max(expectedWords.length, 1)) * 100);
};

const scoreExpression = (expression, term) => {
  const text = normalize(expression);
  if (!text) return 0;
  const words = text.split(' ').filter(Boolean);
  const usesTerm = text.includes(normalize(term));
  const lengthScore = Math.min(words.length * 5, 35);
  const completeScore = /[.!?。！？]$/.test(expression.trim()) ? 10 : 0;
  return Math.min(100, 45 + lengthScore + completeScore + (usesTerm ? 10 : 0));
};

const encouragementFor = (score) => {
  if (score >= 90) return '非常稳，发音和表达都已经接近可直接输出的状态。';
  if (score >= 80) return '完成质量不错，继续保持这个节奏，下一轮可以更关注连读和语块。';
  if (score >= 70) return '基础已经过关，再把例句多读两遍，熟悉度会明显上来。';
  return '这一轮已经完成，先把卡住的词标出来，下一次从这些词开始会更有效。';
};

const polishedExampleTranslations = {
  'The terrain in this region is extremely rugged, making it difficult to build roads.':
    '这个地区的地形非常崎岖，所以很难修建道路。',
  'The landscape of Scotland is characterised by rolling hills and deep lochs.':
    '苏格兰的景观以起伏的丘陵和幽深的湖泊为特征。',
  'The Tibetan Plateau is often referred to as the "Roof of the World."':
    '青藏高原常被称为“世界屋脊”。'
};

const getChineseExample = (entry) =>
  polishedExampleTranslations[entry.example] ||
  generatedExampleTranslations[entry.example] ||
  `请用英文表达一个包含“${entry.meaning}”含义的句子，并尽量使用核心表达“${entry.term}”。`;

function App() {
  const allEntries = useMemo(() => flattenEntries(vocabChapters), []);
  const [chapterId, setChapterId] = useState('all');
  const [sectionTitle, setSectionTitle] = useState('all');
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState('repeat');
  const [index, setIndex] = useState(0);
  const [englishExpression, setEnglishExpression] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [spokenText, setSpokenText] = useState('');
  const [speechScore, setSpeechScore] = useState(null);
  const [speechStatus, setSpeechStatus] = useState('');
  const [listening, setListening] = useState(false);
  const [voiceReady, setVoiceReady] = useState(false);
  const [scores, setScores] = useState({});
  const [sectionResult, setSectionResult] = useState(null);
  const recognitionRef = useRef(null);
  const stoppingRecognitionRef = useRef(false);

  const selectedChapter = vocabChapters.find((chapter) => chapter.id === chapterId);
  const sections = selectedChapter?.sections ?? [];

  const filteredEntries = useMemo(() => {
    const keyword = normalize(query);
    const list = allEntries.filter((entry) => {
      const inChapter = chapterId === 'all' || entry.chapterId === chapterId;
      const inSection = sectionTitle === 'all' || entry.sectionTitle === sectionTitle;
      const inSearch =
        !keyword || normalize(`${entry.term} ${entry.meaning} ${entry.example}`).includes(keyword);
      return inChapter && inSection && inSearch;
    });
    return list.length ? list : allEntries;
  }, [allEntries, chapterId, query, sectionTitle]);

  const current = filteredEntries[index % filteredEntries.length];
  const sectionEntries = useMemo(
    () =>
      allEntries.filter(
        (entry) => entry.chapterId === current.chapterId && entry.sectionTitle === current.sectionTitle
      ),
    [allEntries, current.chapterId, current.sectionTitle]
  );
  const sectionKey = `${mode}:${current.chapterId}:${current.sectionTitle}`;
  const sectionRecords = scores[sectionKey] ?? {};
  const sectionDone = Object.keys(sectionRecords).length;
  const expressionScore = scoreExpression(englishExpression, current.term);

  useEffect(() => {
    setIndex(0);
    resetCardState();
    setSectionResult(null);
  }, [chapterId, sectionTitle, query, mode]);

  useEffect(() => {
    const syncVoices = () => setVoiceReady(window.speechSynthesis.getVoices().length > 0);
    syncVoices();
    window.speechSynthesis.addEventListener('voiceschanged', syncVoices);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', syncVoices);
  }, []);

  function resetCardState() {
    setEnglishExpression('');
    setSubmitted(false);
    setSpokenText('');
    setSpeechScore(null);
    setSpeechStatus('');
  }

  const pickEnglishVoice = (voices) =>
    voices.find((voice) => voice.lang === 'en-US' && /Ava|Samantha|Nicky|Allison|Susan|Zoe|Alex/i.test(voice.name)) ||
    voices.find((voice) => voice.lang.startsWith('en') && /Ava|Samantha|Nicky|Allison|Susan|Zoe|Alex|Serena|Daniel|Karen/i.test(voice.name)) ||
    voices.find((voice) => voice.lang.startsWith('en') && /Google US English|Microsoft (Aria|Jenny|Guy)/i.test(voice.name)) ||
    voices.find((voice) => voice.lang === 'en-US' && voice.localService) ||
    voices.find((voice) => voice.lang.startsWith('en')) ||
    null;

  const splitForClearSpeech = (text) => {
    const chunks = text
      .replace(/\s+/g, ' ')
      .match(/[^,;:.!?]+[,;:.!?"]*/g)
      ?.map((chunk) => chunk.trim())
      .filter(Boolean);
    return chunks?.length ? chunks : [text];
  };

  const makeUtterance = (text, voice, { rate, pitch }) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = voice?.lang || 'en-US';
    utterance.voice = voice;
    utterance.rate = rate;
    utterance.pitch = pitch;
    utterance.volume = 1;
    return utterance;
  };

  const speak = (text, options = {}) => {
    const config = typeof options === 'number' ? { rate: options } : options;
    const modeName = config.mode ?? 'guided';
    window.speechSynthesis.cancel();
    const voices = window.speechSynthesis.getVoices();
    const voice = pickEnglishVoice(voices);
    const chunks =
      modeName === 'guided'
        ? [
            { text, rate: 0.72, pitch: 1, pause: 760 },
            ...splitForClearSpeech(text).map((chunk, chunkIndex) => ({
              text: chunk,
              rate: 0.56 + (chunkIndex % 2) * 0.03,
              pitch: 0.99 + (chunkIndex % 3) * 0.015,
              pause: /[,;]/.test(chunk) ? 360 : 560
            }))
          ]
        : splitForClearSpeech(text).map((chunk) => ({
            text: chunk,
            rate: config.rate ?? 0.58,
            pitch: 1,
            pause: config.pause ?? 420
          }));

    const speakChunk = (chunkIndex) => {
      if (chunkIndex >= chunks.length) return;
      const item = chunks[chunkIndex];
      const utterance = makeUtterance(item.text, voice, item);
      utterance.onend = () => window.setTimeout(() => speakChunk(chunkIndex + 1), item.pause);
      utterance.onerror = () => window.setTimeout(() => speakChunk(chunkIndex + 1), item.pause);
      window.speechSynthesis.speak(utterance);
    };

    speakChunk(0);
  };

  const moveTo = (nextIndex) => {
    setIndex((nextIndex + filteredEntries.length) % filteredEntries.length);
    resetCardState();
  };

  const randomCard = () => {
    if (filteredEntries.length < 2) return;
    let next = Math.floor(Math.random() * filteredEntries.length);
    if (next === index) next = (next + 1) % filteredEntries.length;
    moveTo(next);
  };

  const recordScore = (entryScore) => {
    const currentSectionScores = scores[sectionKey] ?? {};
    const nextSectionScores = { ...currentSectionScores, [current.id]: entryScore };
    setScores((previous) => ({
      ...previous,
      [sectionKey]: {
        ...(previous[sectionKey] ?? {}),
        [current.id]: entryScore
      }
    }));

    const finished = sectionEntries.every((entry) => nextSectionScores[entry.id] !== undefined);
    if (finished && Object.keys(currentSectionScores).length < sectionEntries.length) {
      const values = sectionEntries.map((entry) => nextSectionScores[entry.id]);
      const average = Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
      setSectionResult({ average, count: sectionEntries.length, title: current.sectionTitle });
    }
  };

  const startListening = async () => {
    if (!SpeechRecognition || listening) return;
    stoppingRecognitionRef.current = false;
    window.speechSynthesis.cancel();
    setSpokenText('');
    setSpeechScore(null);
    setSpeechStatus('正在准备麦克风。');

    try {
      if (navigator.mediaDevices?.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((track) => track.stop());
      }
    } catch {
      setSpeechStatus('麦克风权限不可用，请在浏览器地址栏允许 localhost 使用麦克风。');
      return;
    }

    await new Promise((resolve) => window.setTimeout(resolve, 180));
    const recognition = new SpeechRecognition();
    let latestScore = null;
    let recorded = false;
    recognition.lang = 'en-US';
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => {
      setListening(true);
      setSpeechStatus('正在听，请跟读例句。');
    };
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((result) => result[0]?.transcript ?? '')
        .join(' ')
        .trim();
      const hasFinal = Array.from(event.results).some((result) => result.isFinal);
      const score = scoreSpeech(current.example, transcript);
      latestScore = score;
      setSpokenText(transcript);
      setSpeechScore(score);
      setSpeechStatus(hasFinal ? '已识别到最终结果。' : '正在实时识别。');
      if (hasFinal) {
        recorded = true;
        recordScore(score);
      }
    };
    recognition.onnomatch = () => setSpeechStatus('没有匹配到清晰语音，请离麦克风近一点再试。');
    recognition.onerror = (event) => {
      if (event.error === 'aborted' && stoppingRecognitionRef.current) {
        setSpeechStatus('已停止跟读识别。');
        setListening(false);
        return;
      }
      const messages = {
        'not-allowed': '麦克风权限被拒绝，请在浏览器地址栏允许麦克风。',
        'no-speech': '没有检测到语音，请点击开始后马上跟读。',
        'audio-capture': '没有检测到可用麦克风。',
        aborted: '识别被浏览器中断。请等例句播放完，再点击开始跟读。',
        network: '浏览器语音识别服务暂时不可用。'
      };
      setSpeechStatus(messages[event.error] || `语音识别失败：${event.error}`);
      setListening(false);
    };
    recognition.onend = () => {
      setListening(false);
      if (!recorded && latestScore !== null) recordScore(latestScore);
      if (latestScore === null) setSpeechStatus((status) => status || '识别已结束，但没有收到文本。');
    };
    recognitionRef.current = recognition;
    recognition.start();
  };

  const stopListening = () => {
    stoppingRecognitionRef.current = true;
    recognitionRef.current?.stop();
    setListening(false);
  };

  const submitExpression = (event) => {
    event.preventDefault();
    setSubmitted(true);
    recordScore(expressionScore);
  };

  return (
    <main className="app-shell">
      <aside className="study-panel">
        <div className="brand">
          <div className="brand-mark">
            <Languages size={24} />
          </div>
          <div>
            <strong>英语学习宝</strong>
            <span>雅思词汇真经练习台</span>
          </div>
        </div>

        <div className="field">
          <label htmlFor="chapter">章节</label>
          <select
            id="chapter"
            value={chapterId}
            onChange={(event) => {
              setChapterId(event.target.value);
              setSectionTitle('all');
            }}
          >
            <option value="all">全部章节</option>
            {vocabChapters.map((chapter) => (
              <option key={chapter.id} value={chapter.id}>
                {chapter.title}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="section">主题</label>
          <select
            id="section"
            value={sectionTitle}
            onChange={(event) => setSectionTitle(event.target.value)}
            disabled={!selectedChapter}
          >
            <option value="all">全部主题</option>
            {sections.map((section) => (
              <option key={section.title} value={section.title}>
                {section.title}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="search">搜索</label>
          <div className="search-box">
            <Search size={17} />
            <input
              id="search"
              value={query}
              placeholder="单词、释义、例句"
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        </div>

        <div className="stats">
          <div>
            <span>当前词库</span>
            <strong>{filteredEntries.length}</strong>
          </div>
          <div>
            <span>总词条</span>
            <strong>{allEntries.length}</strong>
          </div>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">IELTS Vocabulary Trainer</p>
            <h1>{mode === 'repeat' ? '慢速例句跟读' : '看中文例句，复写英文表达'}</h1>
          </div>
          <div className="mode-tabs" role="tablist" aria-label="练习模式">
            <button className={mode === 'repeat' ? 'active' : ''} onClick={() => setMode('repeat')}>
              <Volume2 size={18} />
              跟读
            </button>
            <button className={mode === 'recall' ? 'active' : ''} onClick={() => setMode('recall')}>
              <Sparkles size={18} />
              造句表达
            </button>
          </div>
        </header>

        <section className="practice-card">
          {sectionResult && <SectionResult result={sectionResult} onClose={() => setSectionResult(null)} />}
          <div className="card-meta">
            <span>{current.chapterTitle}</span>
            <span>{current.sectionTitle}</span>
            <span>
              {index + 1} / {filteredEntries.length}
            </span>
            <span>
              小章节进度 {sectionDone} / {sectionEntries.length}
            </span>
          </div>

          {mode === 'repeat' ? (
            <RepeatPractice
              current={current}
              listening={listening}
              speechScore={speechScore}
              speechStatus={speechStatus}
              spokenText={spokenText}
              startListening={startListening}
              stopListening={stopListening}
              speak={speak}
              voiceReady={voiceReady}
            />
          ) : (
            <RecallPractice
              current={current}
              englishExpression={englishExpression}
              expressionScore={expressionScore}
              setEnglishExpression={setEnglishExpression}
              speak={speak}
              submitted={submitted}
              submitExpression={submitExpression}
            />
          )}

          <div className="card-actions">
            <button className="secondary-button" onClick={() => moveTo(index - 1)}>
              <ChevronLeft size={18} />
              上一个
            </button>
            <button className="secondary-button icon-only" aria-label="随机抽词" onClick={randomCard}>
              <Shuffle size={18} />
            </button>
            <button className="primary-button" onClick={() => moveTo(index + 1)}>
              下一个
              <ChevronRight size={18} />
            </button>
          </div>
        </section>
      </section>
    </main>
  );
}

function RepeatPractice({
  current,
  listening,
  speechScore,
  speechStatus,
  spokenText,
  startListening,
  stopListening,
  speak,
  voiceReady
}) {
  const scoreLabel =
    speechScore === null ? '等待跟读' : speechScore >= 85 ? '很接近' : speechScore >= 60 ? '可以再读慢一点' : '建议重读';

  return (
    <div className="repeat-layout">
      <div className="word-block">
        <p className="meaning">{current.meaning}</p>
        <h2>{current.term}</h2>
        <div className="example">
          <span>跟读例句</span>
          <p>{current.example}</p>
        </div>
      </div>

      <div className="repeat-controls">
        <button className="listen-button selected" onClick={() => speak(current.example, { mode: 'guided' })} disabled={!voiceReady}>
          <Volume2 size={22} />
          自然带读例句
        </button>
        <button className={`record-button ${listening ? 'recording' : ''}`} onClick={listening ? stopListening : startListening} disabled={!SpeechRecognition}>
          {listening ? <MicOff size={22} /> : <Mic size={22} />}
          {listening ? '停止识别' : '开始跟读'}
        </button>
        {!SpeechRecognition && <p className="hint">当前浏览器不支持语音识别，建议用 Chrome 打开。</p>}
      </div>

      <div className="result-panel">
        <div>
          <span>例句跟读识别内容</span>
          <strong>{spokenText || '读完后这里会显示浏览器识别出的内容'}</strong>
          {speechStatus && <p className="speech-status">{speechStatus}</p>}
        </div>
        <div className="score-meter">
          <span>{scoreLabel}</span>
          <strong>{speechScore === null ? '--' : `${speechScore}%`}</strong>
        </div>
      </div>
    </div>
  );
}

function RecallPractice({
  current,
  englishExpression,
  expressionScore,
  setEnglishExpression,
  speak,
  submitted,
  submitExpression
}) {
  return (
    <div className="recall-layout">
      <div className="prompt-panel">
        <span>目标词汇</span>
        <h2>{current.meaning}</h2>
        <p>
          {current.term} · {current.sectionTitle}
        </p>
      </div>

      <form className="sentence-form" onSubmit={submitExpression}>
        <label htmlFor="chineseIdea">中文意思</label>
        <textarea id="chineseIdea" value={getChineseExample(current)} readOnly rows={3} />

        <label htmlFor="englishExpression">输入你的英文表达</label>
        <textarea
          id="englishExpression"
          value={englishExpression}
          placeholder="Write your English sentence here."
          onChange={(event) => setEnglishExpression(event.target.value)}
          rows={4}
          required
        />

        <div className="form-actions">
          <button className="primary-button" type="submit">
            结束并查看原例句
          </button>
        </div>
      </form>

      {submitted && (
        <div className="feedback correct">
          <div>
            <span>参考分</span>
            <strong>{expressionScore}%</strong>
          </div>
          <button className="secondary-button" onClick={() => speak(current.example, { mode: 'guided' })}>
            <Volume2 size={18} />
            听原例句
          </button>
          <p>
            <b>原例句：</b>
            {current.example}
          </p>
          <p>
            <b>核心表达：</b>
            {current.term} = {current.meaning}
          </p>
        </div>
      )}
    </div>
  );
}

function SectionResult({ result, onClose }) {
  return (
    <section className="section-result">
      <div>
        <span>小章节完成</span>
        <strong>
          {result.title} · {result.average} 分
        </strong>
        <p>
          已完成 {result.count} 个词条。{encouragementFor(result.average)}
        </p>
      </div>
      <button className="secondary-button" onClick={onClose}>
        知道了
      </button>
    </section>
  );
}

createRoot(document.getElementById('root')).render(<App />);
