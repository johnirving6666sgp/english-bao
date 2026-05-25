import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Headphones,
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
import { listeningVocabEntries } from './listeningVocabData';
import { vocabChapters } from './vocabData';
import './styles.css';

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition || null;
const SpeechSynthesis = window.speechSynthesis || null;
const isAppleMobileBrowser =
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
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
      title: '陪你练这一句',
      message: '先听一遍自然带读，再轻轻跟一遍。能开口完成这一轮，就已经在积累语感了。',
      tip: `今天这张卡的核心词是 ${entry.term}，慢慢把它读熟。`
    };
  }
  if (score >= 90) {
    return {
      title: '这一遍很漂亮',
      message: '读得很顺，已经有进入句子节奏的感觉了。保持这个状态，继续往下一张走就好。',
      tip: `${entry.term} 这张卡已经很熟了，明天复习时会更轻松。`
    };
  }
  if (score >= 75) {
    return {
      title: '这一遍已经不错',
      message: '你已经把句子读出来了，这就是有效练习。再来一遍时，只要比刚才更放松一点就好。',
      tip: `${entry.term} 已经被你碰到一次了，再重复一次会更稳。`
    };
  }
  return {
    title: '先完成就很好',
    message: '这一句有点挑战，但你已经开始练了。先跟着声音走一遍，不急着读完美。',
    tip: `把 ${entry.term} 先读顺，句子会一点点跟上来。`
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

const getListeningDefinition = (entry) =>
  entry.englishDefinition || entry.example || `IELTS listening scene word: ${entry.term}`;

const getListeningExample = (entry) =>
  entry.example || `Please write down the word ${entry.term}.`;

const blankListeningExample = (entry) => {
  const escaped = entry.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`\\b${escaped}\\b`, 'i');
  const example = getListeningExample(entry);
  return pattern.test(example) ? example.replace(pattern, '______') : `______ · ${example}`;
};

const normalizeSpelling = (value) => normalize(value).replace(/\s+/g, ' ');

const spellingMatches = (answer, term) => {
  const normalizedAnswer = normalizeSpelling(answer);
  const accepted = [term, ...term.split(/[\/,;]/), term.replace(/\(.*?\)/g, '')]
    .map((value) => normalizeSpelling(value))
    .filter(Boolean);
  return accepted.includes(normalizedAnswer);
};

const listeningExerciseLabels = {
  choice: '听音选义',
  spelling: '听写拼写',
  sentence: '例句填空'
};

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
  const [listeningScene, setListeningScene] = useState(savedProgress.listeningScene || 'all');
  const [query, setQuery] = useState(savedProgress.query || '');
  const [mode, setMode] = useState(savedProgress.mode || 'repeat');
  const [reviewIds, setReviewIds] = useState(loadReviewIds);
  const [reviewActive, setReviewActive] = useState(false);
  const [reviewCardActive, setReviewCardActive] = useState(false);
  const [index, setIndex] = useState(savedProgress.index || 0);
  const [listeningIndex, setListeningIndex] = useState(savedProgress.listeningIndex || 0);
  const [listeningExercise, setListeningExercise] = useState(savedProgress.listeningExercise || 'choice');
  const [listeningAnswer, setListeningAnswer] = useState('');
  const [listeningSubmitted, setListeningSubmitted] = useState(false);
  const [listeningCorrect, setListeningCorrect] = useState(null);
  const [englishExpression, setEnglishExpression] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [spokenText, setSpokenText] = useState('');
  const [speechScore, setSpeechScore] = useState(null);
  const [speechStatus, setSpeechStatus] = useState('');
  const [readStatus, setReadStatus] = useState('');
  const [readPlaying, setReadPlaying] = useState(false);
  const [listening, setListening] = useState(false);
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
  const recognitionTimersRef = useRef([]);
  const audioRef = useRef(null);
  const utteranceRef = useRef(null);

  const selectedChapter = vocabChapters.find((chapter) => chapter.id === chapterId);
  const sections = selectedChapter?.sections ?? [];
  const listeningScenes = useMemo(
    () => [...new Set(listeningVocabEntries.map((entry) => entry.scene).filter(Boolean))],
    []
  );

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

  const filteredListeningEntries = useMemo(() => {
    const keyword = normalize(query);
    const list = listeningVocabEntries.filter((entry) => {
      const inScene = listeningScene === 'all' || entry.scene === listeningScene;
      const inSearch =
        !keyword ||
        normalize(`${entry.term} ${entry.englishDefinition} ${entry.example} ${entry.scene}`).includes(keyword);
      return inScene && inSearch;
    });
    return list.length ? list : listeningVocabEntries;
  }, [listeningScene, query]);

  const current = filteredEntries[index % filteredEntries.length];
  const currentListening = filteredListeningEntries[listeningIndex % filteredListeningEntries.length];
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
    setListeningIndex((value) => Math.min(value, Math.max(filteredListeningEntries.length - 1, 0)));
  }, [filteredListeningEntries.length]);

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
    resetListeningState();
  }, [listeningScene, listeningExercise, query, listeningIndex]);

  useEffect(() => {
    const syncVoices = () => {
      if (!SpeechSynthesis) return;
      const nextVoices = SpeechSynthesis.getVoices().filter((voice) => voice.lang.startsWith('en'));
      setVoices(nextVoices);
      const selectedVoiceStillExists = nextVoices.some((voice) => voice.name === selectedVoiceName);
      if (nextVoices.length && (!selectedVoiceName || !selectedVoiceStillExists)) {
        setSelectedVoiceName(pickEnglishVoice(nextVoices)?.name || nextVoices[0].name);
      }
    };
    syncVoices();
    SpeechSynthesis?.addEventListener('voiceschanged', syncVoices);
    return () => SpeechSynthesis?.removeEventListener('voiceschanged', syncVoices);
  }, [selectedVoiceName]);

  useEffect(() => {
    if (!selectedVoiceName) return;
    localStorage.setItem(VOICE_STORAGE_KEY, selectedVoiceName);
  }, [selectedVoiceName]);

  useEffect(() => {
    if (reviewActive) return;
    saveCurrentProgress();
  }, [chapterId, index, listeningExercise, listeningIndex, listeningScene, mode, query, reviewActive, sectionTitle]);

  function makeCurrentProgress() {
    return {
      chapterId,
      sectionTitle,
      listeningScene,
      query,
      mode,
      index,
      listeningIndex,
      listeningExercise,
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
    stopSpeaking();
    clearRecognitionTimers();
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {
        // Ignore stale browser recognition handles.
      }
      recognitionRef.current = null;
    }
    setListening(false);
    setEnglishExpression('');
    setSubmitted(false);
    setSpokenText('');
    setSpeechScore(null);
    setSpeechStatus('');
    setReadStatus('');
    setReadPlaying(false);
  }

  function resetListeningState() {
    setListeningAnswer('');
    setListeningSubmitted(false);
    setListeningCorrect(null);
    setReadStatus('');
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
    const browserVoices = voices.length ? voices : SpeechSynthesis?.getVoices().filter((voice) => voice.lang.startsWith('en')) ?? [];
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
    if (voice) utterance.voice = voice;
    utterance.rate = rate;
    utterance.pitch = pitch;
    utterance.volume = 1;
    return utterance;
  };

  const clearRecognitionTimers = () => {
    recognitionTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    recognitionTimersRef.current = [];
  };

  const stopSpeaking = () => {
    speechRunRef.current += 1;
    speechTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    speechTimersRef.current = [];
    utteranceRef.current = null;
    setReadPlaying(false);
    let stoppedAudio = false;
    if (audioRef.current) {
      const audio = audioRef.current;
      stoppedAudio = true;
      audioRef.current = null;
      audio.onended = null;
      audio.onerror = null;
      try {
        audio.pause();
        audio.currentTime = 0;
        audio.removeAttribute('src');
        audio.load();
      } catch {
        // Mobile browsers can throw while tearing down an active media session.
      }
    }
    SpeechSynthesis?.cancel();
    return stoppedAudio;
  };

  const speak = (text, options = {}) => {
    if (!SpeechSynthesis) {
      setReadStatus('当前浏览器没有可用的系统朗读能力。');
      return;
    }
    const config = typeof options === 'number' ? { rate: options } : options;
    const modeName = config.mode ?? 'guided';
    stopSpeaking();
    const runId = speechRunRef.current;
    const voice = activeVoice();
    const chunks = isAppleMobileBrowser
      ? [{ text, rate: config.rate ?? 0.72, pitch: 1, pause: 0 }]
      : modeName === 'human'
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
      if (chunkIndex >= chunks.length) {
        setReadPlaying(false);
        setReadStatus('例句朗读完成。');
        return;
      }
      const item = chunks[chunkIndex];
      const utterance = makeUtterance(item.text, voice, item);
      utteranceRef.current = utterance;
      const scheduleNext = () => {
        if (runId !== speechRunRef.current) return;
        utteranceRef.current = null;
        const timer = window.setTimeout(() => speakChunk(chunkIndex + 1), item.pause);
        speechTimersRef.current.push(timer);
      };
      utterance.onstart = () => {
        setReadPlaying(true);
        setReadStatus('正在播放例句朗读。');
      };
      utterance.onend = scheduleNext;
      utterance.onerror = () => {
        if (chunkIndex >= chunks.length - 1) setReadPlaying(false);
        setReadStatus('系统朗读被浏览器中断，请再点一次朗读按钮。');
        scheduleNext();
      };
      SpeechSynthesis.resume?.();
      SpeechSynthesis.speak(utterance);
    };

    setReadStatus('正在启动例句朗读。');
    if (isAppleMobileBrowser) {
      SpeechSynthesis.resume?.();
      speakChunk(0);
      return;
    }

    const starter = window.setTimeout(() => {
      SpeechSynthesis.resume?.();
      speakChunk(0);
    }, 120);
    speechTimersRef.current.push(starter);
  };

  const playExample = (text, options = {}) => {
    const audioUrl = exampleAudioManifest[text];
    if (!audioUrl) {
      setReadStatus('使用系统备用朗读。');
      speak(text, options);
      return;
    }

    stopSpeaking();
    const audio = new Audio(audioUrl);
    audioRef.current = audio;
    setReadPlaying(true);
    setReadStatus('正在播放预生成例句音频。');
    audio.onended = () => {
      if (audioRef.current === audio) audioRef.current = null;
      setReadPlaying(false);
      setReadStatus('例句朗读完成。');
    };
    audio.onerror = () => {
      if (audioRef.current === audio) audioRef.current = null;
      setReadPlaying(false);
      setReadStatus('预生成音频不可用，改用系统备用朗读。');
      speak(text, options);
    };
    audio.play().catch(() => {
      if (audioRef.current === audio) audioRef.current = null;
      setReadPlaying(false);
      setReadStatus('预生成音频未能播放，改用系统备用朗读。');
      speak(text, options);
    });
  };

  const playListeningWord = () => {
    speak(currentListening.term, { rate: 0.62, pause: 260 });
  };

  const playListeningExample = () => {
    speak(getListeningExample(currentListening), { mode: 'guided', rate: 0.62, pause: 420 });
  };

  const moveTo = (nextIndex) => {
    setIndex((nextIndex + filteredEntries.length) % filteredEntries.length);
    resetCardState();
  };

  const moveListeningTo = (nextIndex) => {
    setListeningIndex((nextIndex + filteredListeningEntries.length) % filteredListeningEntries.length);
    resetListeningState();
    stopSpeaking();
  };

  const randomCard = () => {
    if (filteredEntries.length < 2) return;
    let next = Math.floor(Math.random() * filteredEntries.length);
    if (next === index) next = (next + 1) % filteredEntries.length;
    moveTo(next);
  };

  const randomListeningCard = () => {
    if (filteredListeningEntries.length < 2) return;
    let next = Math.floor(Math.random() * filteredListeningEntries.length);
    if (next === listeningIndex) next = (next + 1) % filteredListeningEntries.length;
    moveListeningTo(next);
  };

  const getListeningChoices = () => {
    const sameScene = listeningVocabEntries.filter((entry) => entry.scene === currentListening.scene && entry.id !== currentListening.id);
    const pool = (sameScene.length >= 3 ? sameScene : listeningVocabEntries.filter((entry) => entry.id !== currentListening.id))
      .filter((entry) => getListeningDefinition(entry).length > 12);
    const distractors = pool
      .sort((a, b) => normalize(`${currentListening.id}-${a.id}`).localeCompare(normalize(`${currentListening.id}-${b.id}`)))
      .slice(0, 3);
    return [currentListening, ...distractors]
      .sort((a, b) => normalize(`${a.id}-${currentListening.term}`).localeCompare(normalize(`${b.id}-${currentListening.term}`)));
  };

  const submitListening = (event) => {
    event.preventDefault();
    let correct = false;
    if (listeningExercise === 'choice') {
      correct = listeningAnswer === currentListening.id;
    } else if (listeningExercise === 'spelling') {
      correct = spellingMatches(listeningAnswer, currentListening.term);
    } else {
      correct = normalize(listeningAnswer).includes(normalize(currentListening.term));
    }
    setListeningSubmitted(true);
    setListeningCorrect(correct);
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

  const startListening = () => {
    if (!SpeechRecognition || listening) return;
    if (readPlaying) {
      setSpeechStatus('带读还在播放，等它结束后再开始跟读。');
      return;
    }
    stoppingRecognitionRef.current = false;
    clearRecognitionTimers();
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {
        // Ignore stale browser recognition handles.
      }
      recognitionRef.current = null;
    }
    stopSpeaking();
    setSpokenText('');
    setSpeechScore(null);
    setSpeechStatus('正在启动跟读识别。');

    const recognition = new SpeechRecognition();
    let latestScore = null;
    let recorded = false;
    recognition.lang = 'en-US';
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => {
      if (recognitionRef.current !== recognition) return;
      setListening(true);
      setSpeechStatus('正在听，请跟读例句。');
      const noResultTimer = window.setTimeout(() => {
        if (recognitionRef.current === recognition && latestScore === null) {
          setSpeechStatus('还没有识别到内容，本次跟读已结束。再点开始跟读即可。');
          setListening(false);
          recognitionRef.current = null;
          clearRecognitionTimers();
          try {
            recognition.abort();
          } catch {
            // Mobile browsers can throw when aborting a stale recognition session.
          }
        }
      }, 9000);
      recognitionTimersRef.current.push(noResultTimer);
    };
    recognition.onresult = (event) => {
      if (recognitionRef.current !== recognition) return;
      clearRecognitionTimers();
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
      if (recognitionRef.current !== recognition) return;
      clearRecognitionTimers();
      recognitionRef.current = null;
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
      if (recognitionRef.current !== recognition) return;
      clearRecognitionTimers();
      setListening(false);
      recognitionRef.current = null;
      if (!recorded && latestScore !== null) recordScore(latestScore);
      if (latestScore === null) setSpeechStatus((status) => status || '识别已结束，但没有收到文本。');
    };
    recognitionRef.current = recognition;
    try {
      recognition.start();
      setListening(true);
      setSpeechStatus('正在听，请跟读例句。');
    } catch (error) {
      recognitionRef.current = null;
      setListening(false);
      setSpeechStatus(`语音识别启动失败：${error.message || '请刷新页面后再试。'}`);
    }
  };

  const stopListening = () => {
    stoppingRecognitionRef.current = true;
    clearRecognitionTimers();
    recognitionRef.current?.stop();
    setListening(false);
  };

  const endTodayStudy = () => {
    stopSpeaking();
    if (listening) stopListening();
    saveCurrentProgress();

    const date = todayKey();
    if (mode === 'listening') {
      setSessionSummary({
        date,
        studiedCount: listeningIndex + 1,
        reviewCount: 0,
        chapterTitle: '雅思听力场景词汇',
        sectionTitle: currentListening.scene,
        term: currentListening.term,
        mode,
        sectionDone: listeningIndex + 1,
        sectionTotal: filteredListeningEntries.length
      });
      return;
    }

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

        {mode === 'listening' ? (
          <>
            <div className="field chapter-field">
              <label htmlFor="listeningScene">听力场景</label>
              <select
                id="listeningScene"
                value={listeningScene}
                onChange={(event) => {
                  setListeningScene(event.target.value);
                  setListeningIndex(0);
                }}
              >
                <option value="all">全部场景</option>
                {listeningScenes.map((scene) => (
                  <option key={scene} value={scene}>
                    {scene}
                  </option>
                ))}
              </select>
            </div>
            <div className="field section-field">
              <label htmlFor="listeningExercise">训练方式</label>
              <select
                id="listeningExercise"
                value={listeningExercise}
                onChange={(event) => setListeningExercise(event.target.value)}
              >
                <option value="choice">听音选义</option>
                <option value="spelling">听写拼写</option>
                <option value="sentence">例句填空</option>
              </select>
            </div>
          </>
        ) : (
          <>
            <div className="field chapter-field">
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

            <div className="field section-field">
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
          </>
        )}

        <div className="field search-field">
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
            <strong>{mode === 'listening' ? filteredListeningEntries.length : filteredEntries.length}</strong>
          </div>
          <div>
            <span>总词条</span>
            <strong>{mode === 'listening' ? listeningVocabEntries.length : allEntries.length}</strong>
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
              {reviewCardActive
                ? '复习卡速览'
                : mode === 'repeat'
                ? '慢速例句跟读'
                : mode === 'listening'
                ? '雅思听力场景词汇'
                : '看中文例句，复写英文表达'}
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
            <button
              className={mode === 'listening' ? 'active' : ''}
              onClick={() => {
                setReviewCardActive(false);
                setMode('listening');
              }}
            >
              <Headphones size={18} />
              听力词汇
            </button>
          </div>
        </header>

        <section className="voice-panel">
          <label htmlFor="voice">发音声音</label>
          <select id="voice" value={selectedVoiceName} onChange={(event) => setSelectedVoiceName(event.target.value)}>
            {!voices.length && <option value="">自动选择英语语音</option>}
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
            {mode === 'listening' ? (
              <>
                <span>{currentListening.scene}</span>
                <span>{listeningExerciseLabels[listeningExercise]}</span>
                <span>
                  {listeningIndex + 1} / {filteredListeningEntries.length}
                </span>
                <span>来自 PDF 第 {currentListening.page} 页</span>
              </>
            ) : (
              <>
                {reviewActive && <span>复习上次结束清单</span>}
                <span>{current.chapterTitle}</span>
                <span>{current.sectionTitle}</span>
                <span>
                  {index + 1} / {filteredEntries.length}
                </span>
                <span>
                  小章节进度 {sectionDone} / {sectionEntries.length}
                </span>
              </>
            )}
          </div>

          {mode === 'listening' ? (
            <ListeningPractice
              current={currentListening}
              exercise={listeningExercise}
              answer={listeningAnswer}
              submitted={listeningSubmitted}
              correct={listeningCorrect}
              choices={getListeningChoices()}
              setAnswer={setListeningAnswer}
              submitListening={submitListening}
              playWord={playListeningWord}
              playExample={playListeningExample}
            />
          ) : reviewCardActive ? (
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
              readStatus={readStatus}
              readPlaying={readPlaying}
              spokenText={spokenText}
              startListening={startListening}
              stopListening={stopListening}
              playExample={playExample}
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
            <button className="secondary-button" onClick={() => (mode === 'listening' ? moveListeningTo(listeningIndex - 1) : moveTo(index - 1))}>
              <ChevronLeft size={18} />
              上一个
            </button>
            <button className="secondary-button icon-only" aria-label="随机抽词" onClick={mode === 'listening' ? randomListeningCard : randomCard}>
              <Shuffle size={18} />
            </button>
            <button className="primary-button" onClick={() => (mode === 'listening' ? moveListeningTo(listeningIndex + 1) : moveTo(index + 1))}>
              下一个
              <ChevronRight size={18} />
            </button>
          </div>
        </section>
      </section>
    </main>
  );
}

function ListeningPractice({
  current,
  exercise,
  answer,
  submitted,
  correct,
  choices,
  setAnswer,
  submitListening,
  playWord,
  playExample
}) {
  const definition = getListeningDefinition(current);
  const example = getListeningExample(current);

  return (
    <div className="listening-layout">
      <div className="listening-hero">
        <span>先听，不看单词</span>
        <strong>{listeningExerciseLabels[exercise]}</strong>
        <p>
          {exercise === 'choice'
            ? '听单词后选择最接近的英文释义。'
            : exercise === 'spelling'
            ? '听单词后写出英文拼写。'
            : '听例句后补出空缺的核心词。'}
        </p>
      </div>

      <div className="repeat-controls">
        <button className="listen-button selected" onClick={playWord}>
          <Volume2 size={22} />
          播放单词
        </button>
        <button className="secondary-button" onClick={playExample}>
          <Volume2 size={18} />
          播放例句
        </button>
      </div>

      <form className="listening-form" onSubmit={submitListening}>
        {exercise === 'choice' && (
          <div className="choice-grid">
            {choices.map((choice) => (
              <label key={choice.id} className={`choice-option ${answer === choice.id ? 'selected' : ''}`}>
                <input
                  type="radio"
                  name="listeningChoice"
                  value={choice.id}
                  checked={answer === choice.id}
                  onChange={(event) => setAnswer(event.target.value)}
                  required
                />
                <span>{getListeningDefinition(choice)}</span>
              </label>
            ))}
          </div>
        )}

        {exercise === 'spelling' && (
          <label className="listening-input">
            <span>写出你听到的英文词汇</span>
            <input
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
              placeholder="Type the word or phrase you heard"
              autoCapitalize="none"
              required
            />
          </label>
        )}

        {exercise === 'sentence' && (
          <>
            <div className="sentence-blank">
              <span>例句填空</span>
              <strong>{blankListeningExample(current)}</strong>
            </div>
            <label className="listening-input">
              <span>填写空缺词汇</span>
              <input
                value={answer}
                onChange={(event) => setAnswer(event.target.value)}
                placeholder="Fill in the missing word"
                autoCapitalize="none"
                required
              />
            </label>
          </>
        )}

        <button className="primary-button" type="submit">
          提交答案
        </button>
      </form>

      {submitted && (
        <div className={`feedback ${correct ? 'correct' : 'focus'}`}>
          <div>
            <span>{correct ? '答对了' : '再听一遍就会更稳'}</span>
            <strong>{current.term}</strong>
          </div>
          <button className="secondary-button" onClick={playWord}>
            <Volume2 size={18} />
            重听单词
          </button>
          <p>
            <b>英文释义：</b>
            {definition}
          </p>
          <p>
            <b>例句：</b>
            {example}
          </p>
          <p>
            <b>来源：</b>
            {current.scene} · PDF 第 {current.page} 页
          </p>
        </div>
      )}
    </div>
  );
}

function RepeatPractice({
  current,
  listening,
  speechScore,
  speechStatus,
  readStatus,
  readPlaying,
  spokenText,
  startListening,
  stopListening,
  playExample
}) {
  const scoreLabel =
    listening ? '正在跟读' : speechScore === null ? '等待跟读' : speechScore >= 85 ? '很接近' : speechScore >= 60 ? '可以再读慢一点' : '建议重读';
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
        <button className="listen-button selected" onClick={() => playExample(current.example, { mode: 'guided' })} disabled={listening}>
          <Volume2 size={22} />
          {listening ? '跟读中' : '自然带读例句'}
        </button>
        <button
          className={`record-button ${listening ? 'recording' : ''}`}
          onClick={listening ? stopListening : startListening}
          disabled={!SpeechRecognition || readPlaying}
        >
          {listening ? <MicOff size={22} /> : <Mic size={22} />}
          {listening ? '停止识别' : readPlaying ? '等待带读结束' : '开始跟读'}
        </button>
        {!SpeechRecognition && <p className="hint">当前浏览器不支持语音识别，建议用 Chrome 打开。</p>}
        {readStatus && <p className="hint neutral">{readStatus}</p>}
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
  const modeLabel = summary.mode === 'repeat' ? '例句跟读' : summary.mode === 'listening' ? '听力词汇' : '造句表达';
  const unitLabel = summary.mode === 'listening' ? '张听力卡' : '个词';
  const progressText = summary.sectionTotal
    ? `这个小章节目前完成 ${summary.sectionDone} / ${summary.sectionTotal}。`
    : '';

  return (
    <section className="session-summary">
      <div>
        <span>今日小结 · {summary.date}</span>
        <strong>今天完成 {summary.studiedCount} {unitLabel}的学习记录</strong>
        <p>
          已保存到 {summary.chapterTitle} / {summary.sectionTitle}，下次进入会从“{summary.term}”附近继续。
          {summary.reviewCount > 0 ? `上次学习清单里有 ${summary.reviewCount} 个词，适合明天先快速过一遍。` : ''}
          {progressText}
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
