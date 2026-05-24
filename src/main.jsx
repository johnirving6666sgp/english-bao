import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Languages,
  Mic,
  MicOff,
  Play,
  RotateCcw,
  Search,
  Shuffle,
  Sparkles,
  Volume2
} from 'lucide-react';
import { exampleAudioManifest } from './exampleAudioManifest';
import { generatedExampleTranslations } from './exampleTranslations';
import { vocabChapters } from './vocabData';
import './styles.css';

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition || null;
const REVIEW_STORAGE_KEY = 'english-bao-recent-study-v1';
const PROGRESS_STORAGE_KEY = 'english-bao-last-progress-v1';
const VOICE_STORAGE_KEY = 'english-bao-voice-v1';
const DAILY_STUDY_STORAGE_KEY = 'english-bao-daily-study-v1';
const LAST_SESSION_REVIEW_STORAGE_KEY = 'english-bao-last-session-review-v1';
const MAX_REVIEW_ITEMS = 80;

const todayKey = () => {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

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

const getCoachTone = (score) => {
  if (score === null) return 'ready';
  if (score >= 90) return 'strong';
  if (score >= 75) return 'steady';
  return 'focus';
};

const getRepeatCoach = (score, entry) => {
  if (score === null) {
    return {
      title: '陪练提示',
      message: '先听一遍自然带读，再跟读。重点不是快，是把每个语块读清楚。',
      tip: `今天这张卡的核心词是 ${entry.term}。`
    };
  }
  if (score >= 90) {
    return {
      title: '这一句很稳',
      message: '识别结果已经很接近原句。下一遍可以试着更自然地连起来，不要一个词一个词断开。',
      tip: `保留这个节奏，${entry.term} 已经进入可输出状态。`
    };
  }
  if (score >= 75) {
    return {
      title: '已经接近了',
      message: '整体方向对了。再跟读一遍时，把重音放在句子的关键词上，尾音收清楚。',
      tip: `可以特别留意 ${entry.term} 在句子里的位置。`
    };
  }
  return {
    title: '这句值得慢练',
    message: '先不用追求完整复现。把例句拆成两三段，每段跟读清楚后再连起来。',
    tip: '点击自然带读例句，听完一个语块就暂停在脑子里复述。'
  };
};

const getRecallCoach = (score, entry, expression) => {
  const usesTerm = normalize(expression).includes(normalize(entry.term));
  if (score >= 90 && usesTerm) {
    return {
      title: '表达很到位',
      message: '你已经把中文意思转成了完整英文表达，而且用上了目标词。',
      tip: '下一次可以尝试换一个主语或场景，让这个词真正变成自己的表达。'
    };
  }
  if (score >= 75) {
    return {
      title: '句子骨架成立',
      message: usesTerm ? '目标词已经用上了，下一步可以让句子更自然。' : '句子基本成形了，下一步要主动把目标词放进去。',
      tip: `参考原句时，留意 ${entry.term} 前后搭配了哪些词。`
    };
  }
  return {
    title: '先抓核心意思',
    message: '这一步的目标是把中文意思说出来，不必一开始就追求漂亮。',
    tip: `先写一个包含 ${entry.term} 的简单句，再对照原例句升级。`
  };
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

const loadReviewIds = () => {
  try {
    const saved = localStorage.getItem(REVIEW_STORAGE_KEY);
    const parsed = saved ? JSON.parse(saved) : [];
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : [];
  } catch {
    return [];
  }
};

const saveReviewIds = (ids) => {
  localStorage.setItem(REVIEW_STORAGE_KEY, JSON.stringify(ids.slice(0, MAX_REVIEW_ITEMS)));
};

const loadProgress = () => {
  try {
    return JSON.parse(localStorage.getItem(PROGRESS_STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
};

const loadDailyStudy = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(DAILY_STUDY_STORAGE_KEY) || '{}');
    if (saved?.date === todayKey() && Array.isArray(saved.ids)) {
      return { date: saved.date, ids: saved.ids.filter((id) => typeof id === 'string') };
    }
  } catch {
    // Ignore malformed local data and start a clean daily record.
  }
  return { date: todayKey(), ids: [] };
};

const saveDailyStudy = (dailyStudy) => {
  localStorage.setItem(DAILY_STUDY_STORAGE_KEY, JSON.stringify(dailyStudy));
};

const cleanIdList = (ids) => (Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : []);

const loadLastSessionReview = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(LAST_SESSION_REVIEW_STORAGE_KEY) || '{}');
    return {
      date: typeof saved.date === 'string' ? saved.date : '',
      ids: cleanIdList(saved.ids),
      reviewedIds: cleanIdList(saved.reviewedIds)
    };
  } catch {
    return { date: '', ids: [], reviewedIds: [] };
  }
};

const saveLastSessionReview = (sessionReview) => {
  localStorage.setItem(LAST_SESSION_REVIEW_STORAGE_KEY, JSON.stringify(sessionReview));
};

const loadVoiceName = () => {
  try {
    return localStorage.getItem(VOICE_STORAGE_KEY) || '';
  } catch {
    return '';
  }
};

function App() {
  const allEntries = useMemo(() => flattenEntries(vocabChapters), []);
  const savedProgress = useMemo(() => loadProgress(), []);
  const [chapterId, setChapterId] = useState(savedProgress.chapterId || 'all');
  const [sectionTitle, setSectionTitle] = useState(savedProgress.sectionTitle || 'all');
  const [query, setQuery] = useState(savedProgress.query || '');
  const [mode, setMode] = useState(savedProgress.mode || 'repeat');
  const [reviewIds, setReviewIds] = useState(loadReviewIds);
  const [reviewActive, setReviewActive] = useState(false);
  const [reviewCardActive, setReviewCardActive] = useState(false);
  const [index, setIndex] = useState(savedProgress.index || 0);
  const [englishExpression, setEnglishExpression] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [spokenText, setSpokenText] = useState('');
  const [speechScore, setSpeechScore] = useState(null);
  const [speechStatus, setSpeechStatus] = useState('');
  const [listening, setListening] = useState(false);
  const [voiceReady, setVoiceReady] = useState(false);
  const [voices, setVoices] = useState([]);
  const [selectedVoiceName, setSelectedVoiceName] = useState(loadVoiceName);
  const [scores, setScores] = useState({});
  const [sectionResult, setSectionResult] = useState(null);
  const [dailyStudy, setDailyStudy] = useState(loadDailyStudy);
  const [lastSessionReview, setLastSessionReview] = useState(loadLastSessionReview);
  const [reviewSourceIds, setReviewSourceIds] = useState([]);
  const [sessionSummary, setSessionSummary] = useState(null);
  const restoredProgressRef = useRef(false);
  const libraryProgressRef = useRef(null);
  const recognitionRef = useRef(null);
  const stoppingRecognitionRef = useRef(false);
  const speechRunRef = useRef(0);
  const speechTimersRef = useRef([]);
  const audioRef = useRef(null);

  const selectedChapter = vocabChapters.find((chapter) => chapter.id === chapterId);
  const sections = selectedChapter?.sections ?? [];

  const filteredEntries = useMemo(() => {
    if (reviewActive) {
      const entryMap = new Map(allEntries.map((entry) => [entry.id, entry]));
      const reviewEntries = reviewSourceIds.map((id) => entryMap.get(id)).filter(Boolean);
      return reviewEntries.length ? reviewEntries : allEntries;
    }

    const keyword = normalize(query);
    const list = allEntries.filter((entry) => {
      const inChapter = chapterId === 'all' || entry.chapterId === chapterId;
      const inSection = sectionTitle === 'all' || entry.sectionTitle === sectionTitle;
      const inSearch =
        !keyword || normalize(`${entry.term} ${entry.meaning} ${entry.example}`).includes(keyword);
      return inChapter && inSection && inSearch;
    });
    return list.length ? list : allEntries;
  }, [allEntries, chapterId, query, reviewActive, reviewSourceIds, sectionTitle]);

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
    setIndex((value) => Math.min(value, Math.max(filteredEntries.length - 1, 0)));
  }, [filteredEntries.length]);

  useEffect(() => {
    if (restoredProgressRef.current || !savedProgress.currentId) return;
    const savedIndex = filteredEntries.findIndex((entry) => entry.id === savedProgress.currentId);
    if (savedIndex >= 0) setIndex(savedIndex);
    restoredProgressRef.current = true;
  }, [filteredEntries, savedProgress.currentId]);

  useEffect(() => {
    resetCardState();
    setSectionResult(null);
  }, [chapterId, sectionTitle, query, mode, reviewActive, reviewCardActive]);

  useEffect(() => {
    const syncVoices = () => {
      const nextVoices = window.speechSynthesis.getVoices().filter((voice) => voice.lang.startsWith('en'));
      setVoices(nextVoices);
      setVoiceReady(nextVoices.length > 0);
      if (!selectedVoiceName && nextVoices.length) {
        setSelectedVoiceName(pickEnglishVoice(nextVoices)?.name || nextVoices[0].name);
      }
    };
    syncVoices();
    window.speechSynthesis.addEventListener('voiceschanged', syncVoices);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', syncVoices);
  }, [selectedVoiceName]);

  useEffect(() => {
    if (!selectedVoiceName) return;
    localStorage.setItem(VOICE_STORAGE_KEY, selectedVoiceName);
  }, [selectedVoiceName]);

  useEffect(() => {
    if (reviewActive) return;
    saveCurrentProgress();
  }, [chapterId, index, mode, query, reviewActive, sectionTitle]);

  function makeCurrentProgress() {
    return {
      chapterId,
      sectionTitle,
      query,
      mode,
      index,
      currentId: current.id
    };
  }

  function saveProgress(progress) {
    localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(progress));
  }

  function saveCurrentProgress() {
    saveProgress(makeCurrentProgress());
  }

  function resetCardState() {
    setEnglishExpression('');
    setSubmitted(false);
    setSpokenText('');
    setSpeechScore(null);
    setSpeechStatus('');
  }

  const rememberDailyStudy = (entry) => {
    setDailyStudy((previous) => {
      const date = todayKey();
      const baseIds = previous.date === date ? previous.ids : [];
      const next = {
        date,
        ids: [entry.id, ...baseIds.filter((id) => id !== entry.id)]
      };
      saveDailyStudy(next);
      return next;
    });
  };

  const markReviewDone = (entry) => {
    if (!reviewActive || !lastSessionReview.ids.includes(entry.id)) return;
    setLastSessionReview((previous) => {
      if (previous.reviewedIds.includes(entry.id)) return previous;
      const next = {
        ...previous,
        reviewedIds: [...previous.reviewedIds, entry.id]
      };
      saveLastSessionReview(next);
      return next;
    });
  };

  const rememberStudy = (entry) => {
    rememberDailyStudy(entry);
    markReviewDone(entry);
    setReviewIds((previous) => {
      if (reviewActive && previous.includes(entry.id)) return previous;
      const next = [entry.id, ...previous.filter((id) => id !== entry.id)].slice(0, MAX_REVIEW_ITEMS);
      saveReviewIds(next);
      return next;
    });
  };

  const pickEnglishVoice = (voices) =>
    voices.find((voice) => voice.lang === 'en-US' && /Ava|Samantha|Nicky|Allison|Susan|Zoe|Alex/i.test(voice.name)) ||
    voices.find((voice) => voice.lang.startsWith('en') && /Ava|Samantha|Nicky|Allison|Susan|Zoe|Alex|Serena|Daniel|Karen/i.test(voice.name)) ||
    voices.find((voice) => voice.lang.startsWith('en') && /Google US English|Microsoft (Aria|Jenny|Guy)/i.test(voice.name)) ||
    voices.find((voice) => voice.lang === 'en-US' && voice.localService) ||
    voices.find((voice) => voice.lang.startsWith('en')) ||
    null;

  const activeVoice = () => {
    const browserVoices = voices.length ? voices : window.speechSynthesis.getVoices();
    return browserVoices.find((voice) => voice.name === selectedVoiceName) || pickEnglishVoice(browserVoices);
  };

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

  const stopSpeaking = () => {
    speechRunRef.current += 1;
    speechTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    speechTimersRef.current = [];
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
    window.speechSynthesis.cancel();
  };

  const speak = (text, options = {}) => {
    const config = typeof options === 'number' ? { rate: options } : options;
    const modeName = config.mode ?? 'guided';
    stopSpeaking();
    const runId = speechRunRef.current;
    const voice = activeVoice();
    const chunks =
      modeName === 'human'
        ? [{ text, rate: config.rate ?? 0.82, pitch: 1, pause: 0 }]
        : modeName === 'guided'
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
      if (runId !== speechRunRef.current) return;
      if (chunkIndex >= chunks.length) return;
      const item = chunks[chunkIndex];
      const utterance = makeUtterance(item.text, voice, item);
      const scheduleNext = () => {
        if (runId !== speechRunRef.current) return;
        const timer = window.setTimeout(() => speakChunk(chunkIndex + 1), item.pause);
        speechTimersRef.current.push(timer);
      };
      utterance.onend = scheduleNext;
      utterance.onerror = scheduleNext;
      window.speechSynthesis.speak(utterance);
    };

    speakChunk(0);
  };

  const playExample = (text, options = {}) => {
    const audioUrl = exampleAudioManifest[text];
    if (!audioUrl) {
      speak(text, options);
      return;
    }

    stopSpeaking();
    const audio = new Audio(audioUrl);
    audioRef.current = audio;
    audio.onended = () => {
      if (audioRef.current === audio) audioRef.current = null;
    };
    audio.onerror = () => {
      if (audioRef.current === audio) audioRef.current = null;
      speak(text, options);
    };
    audio.play().catch(() => speak(text, options));
  };

  const canPlayExample = (text) => Boolean(exampleAudioManifest[text]) || voiceReady;

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
    rememberStudy(current);
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
    stopSpeaking();
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

  const endTodayStudy = () => {
    stopSpeaking();
    if (listening) stopListening();
    saveCurrentProgress();

    const date = todayKey();
    const baseIds = dailyStudy.date === date ? dailyStudy.ids : [];
    const ids = [current.id, ...baseIds.filter((id) => id !== current.id)];
    const nextDailyStudy = { date, ids };
    const nextLastSessionReview = { date, ids, reviewedIds: [] };
    saveDailyStudy(nextDailyStudy);
    saveLastSessionReview(nextLastSessionReview);
    setDailyStudy(nextDailyStudy);
    setLastSessionReview(nextLastSessionReview);
    setSessionSummary({
      date,
      studiedCount: ids.length,
      reviewCount: ids.length,
      chapterTitle: current.chapterTitle,
      sectionTitle: current.sectionTitle,
      term: current.term,
      mode,
      sectionDone,
      sectionTotal: sectionEntries.length
    });
  };

  const submitExpression = (event) => {
    event.preventDefault();
    setSubmitted(true);
    recordScore(expressionScore);
  };

  const pendingSessionReviewIds = lastSessionReview.ids.filter((id) => !lastSessionReview.reviewedIds.includes(id));

  const startSessionReview = (asCards = false) => {
    if (!pendingSessionReviewIds.length) return;
    const progress = makeCurrentProgress();
    libraryProgressRef.current = progress;
    saveProgress(progress);
    setReviewSourceIds(pendingSessionReviewIds);
    setReviewActive(true);
    setReviewCardActive(asCards);
    setQuery('');
    if (asCards) setMode('repeat');
    setIndex(0);
    resetCardState();
    setSectionResult(null);
  };

  const startReview = () => {
    startSessionReview(false);
  };

  const stopReview = () => {
    const progress = libraryProgressRef.current || loadProgress();
    setReviewActive(false);
    setReviewCardActive(false);
    setReviewSourceIds([]);
    setChapterId(progress.chapterId || 'all');
    setSectionTitle(progress.sectionTitle || 'all');
    setQuery(progress.query || '');
    setMode(progress.mode || 'repeat');
    setIndex(progress.index || 0);
    resetCardState();
    setSectionResult(null);
  };

  const startReviewCards = () => {
    startSessionReview(true);
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
            disabled={reviewActive}
            onChange={(event) => {
              setChapterId(event.target.value);
              setSectionTitle('all');
              setIndex(0);
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
            onChange={(event) => {
              setSectionTitle(event.target.value);
              setIndex(0);
            }}
            disabled={!selectedChapter || reviewActive}
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
              disabled={reviewActive}
              onChange={(event) => {
                setQuery(event.target.value);
                setIndex(0);
              }}
            />
          </div>
        </div>

        <section className="review-box">
          <div>
            <span>上次学习待复习</span>
            <strong>{pendingSessionReviewIds.length}</strong>
            <small>
              {lastSessionReview.ids.length
                ? `来自 ${lastSessionReview.date}，已复习 ${lastSessionReview.reviewedIds.length} / ${lastSessionReview.ids.length}`
                : '点击“结束今天学习”后生成'}
            </small>
          </div>
          {reviewActive ? (
            <button className="review-button" onClick={stopReview}>
              <ChevronLeft size={17} />
              返回词库
            </button>
          ) : (
            <div className="review-actions">
              <button className="review-button" onClick={startReview} disabled={!pendingSessionReviewIds.length}>
                <RotateCcw size={17} />
                复习上次学习
              </button>
              <button className="review-button quiet" onClick={startReviewCards} disabled={!pendingSessionReviewIds.length}>
                <Play size={17} />
                复习卡速览
              </button>
            </div>
          )}
        </section>

        <section className="finish-box">
          <div>
            <span>今日学习</span>
            <strong>{dailyStudy.date === todayKey() ? dailyStudy.ids.length : 0}</strong>
          </div>
          <button className="finish-button" onClick={endTodayStudy}>
            <CheckCircle2 size={17} />
            结束今天学习
          </button>
        </section>

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
            <p className="eyebrow">
              {reviewCardActive ? 'Review Cards' : reviewActive ? 'Review Mode' : 'IELTS Vocabulary Trainer'}
            </p>
            <h1>
              {reviewCardActive ? '复习卡速览' : mode === 'repeat' ? '慢速例句跟读' : '看中文例句，复写英文表达'}
            </h1>
          </div>
          <div className="mode-tabs" role="tablist" aria-label="练习模式">
            <button
              className={mode === 'repeat' ? 'active' : ''}
              onClick={() => {
                setReviewCardActive(false);
                setMode('repeat');
              }}
            >
              <Volume2 size={18} />
              跟读
            </button>
            <button
              className={mode === 'recall' ? 'active' : ''}
              onClick={() => {
                setReviewCardActive(false);
                setMode('recall');
              }}
            >
              <Sparkles size={18} />
              造句表达
            </button>
          </div>
        </header>

        <section className="voice-panel">
          <label htmlFor="voice">发音声音</label>
          <select id="voice" value={selectedVoiceName} onChange={(event) => setSelectedVoiceName(event.target.value)}>
            {voices.map((voice) => (
              <option key={`${voice.name}-${voice.lang}`} value={voice.name}>
                {voice.name} · {voice.lang}
              </option>
            ))}
          </select>
          <span>优先播放预生成 AI 例句音频；没有音频时使用当前设备语音备用。iPhone/Mac 上备用语音建议选 Samantha、Ava、Nicky、Alex 或 Google US English。</span>
        </section>

        <section className="practice-card">
          {sectionResult && <SectionResult result={sectionResult} onClose={() => setSectionResult(null)} />}
          {sessionSummary && <SessionSummary summary={sessionSummary} onClose={() => setSessionSummary(null)} />}
          <div className="card-meta">
            {reviewActive && <span>复习上次结束清单</span>}
            <span>{current.chapterTitle}</span>
            <span>{current.sectionTitle}</span>
            <span>
              {index + 1} / {filteredEntries.length}
            </span>
            <span>
              小章节进度 {sectionDone} / {sectionEntries.length}
            </span>
          </div>

          {reviewCardActive ? (
            <ReviewFlashcard
              current={current}
              index={index}
              total={filteredEntries.length}
              moveTo={moveTo}
              rememberStudy={rememberStudy}
              playExample={playExample}
            />
          ) : mode === 'repeat' ? (
            <RepeatPractice
              current={current}
              listening={listening}
              speechScore={speechScore}
              speechStatus={speechStatus}
              spokenText={spokenText}
              startListening={startListening}
              stopListening={stopListening}
              playExample={playExample}
              canPlayExample={canPlayExample(current.example)}
            />
          ) : (
            <RecallPractice
              current={current}
              englishExpression={englishExpression}
              expressionScore={expressionScore}
              setEnglishExpression={setEnglishExpression}
              playExample={playExample}
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
  playExample,
  canPlayExample
}) {
  const scoreLabel =
    speechScore === null ? '等待跟读' : speechScore >= 85 ? '很接近' : speechScore >= 60 ? '可以再读慢一点' : '建议重读';
  const coach = getRepeatCoach(speechScore, current);
  const coachTone = getCoachTone(speechScore);

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
        <button className="listen-button selected" onClick={() => playExample(current.example, { mode: 'guided' })} disabled={!canPlayExample}>
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

      <CoachNote tone={coachTone} coach={coach} />
    </div>
  );
}

function SessionSummary({ summary, onClose }) {
  const modeLabel = summary.mode === 'repeat' ? '例句跟读' : '造句表达';
  const progressText = summary.sectionTotal
    ? `这个小章节目前完成 ${summary.sectionDone} / ${summary.sectionTotal}。`
    : '';

  return (
    <section className="session-summary">
      <div>
        <span>今日小结 · {summary.date}</span>
        <strong>今天完成 {summary.studiedCount} 个词的学习记录</strong>
        <p>
          已保存到 {summary.chapterTitle} / {summary.sectionTitle}，下次进入会从“{summary.term}”附近继续。
          上次学习清单里有 {summary.reviewCount} 个词，适合明天先快速过一遍。{progressText}
        </p>
        <em>{modeLabel}这一轮先收住。今天这组词已经在脑子里留了痕，明天从复习清单热身就很好。</em>
      </div>
      <button className="summary-close" onClick={onClose}>
        知道了
      </button>
    </section>
  );
}

function CoachNote({ tone, coach }) {
  return (
    <section className={`coach-note ${tone}`}>
      <span>{coach.title}</span>
      <strong>{coach.message}</strong>
      <p>{coach.tip}</p>
    </section>
  );
}

function ReviewFlashcard({ current, index, total, moveTo, rememberStudy, playExample }) {
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    setRevealed(false);
  }, [current.id]);

  const next = () => {
    rememberStudy(current);
    moveTo(index + 1);
  };

  return (
    <div className="review-card">
      <div className="review-card-head">
        <span>
          {index + 1} / {total}
        </span>
        <strong>{current.term}</strong>
        <p>{current.meaning}</p>
      </div>

      <div className="review-card-body">
        <span>中文例句</span>
        <p>{getChineseExample(current)}</p>
      </div>

      {revealed && (
        <div className="review-card-answer">
          <span>原例句</span>
          <p>{current.example}</p>
          <button className="secondary-button" onClick={() => playExample(current.example, { mode: 'guided' })}>
            <Volume2 size={18} />
            朗读原例句
          </button>
        </div>
      )}

      <div className="review-card-actions">
        <button className="secondary-button" onClick={() => setRevealed((value) => !value)}>
          {revealed ? '隐藏原例句' : '显示原例句'}
        </button>
        <button className="primary-button" onClick={next}>
          下一个
          <ChevronRight size={18} />
        </button>
      </div>
    </div>
  );
}

function RecallPractice({
  current,
  englishExpression,
  expressionScore,
  setEnglishExpression,
  playExample,
  submitted,
  submitExpression
}) {
  const coach = getRecallCoach(expressionScore, current, englishExpression);
  const coachTone = getCoachTone(submitted ? expressionScore : null);

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
          <button className="secondary-button" onClick={() => playExample(current.example, { mode: 'guided' })}>
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

      {submitted && <CoachNote tone={coachTone} coach={coach} />}
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
