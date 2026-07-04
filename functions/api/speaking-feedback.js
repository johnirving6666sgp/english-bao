const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8'
    }
  });

const fallbackFeedback = (reason) => ({
  score: '暂不可用',
  summary: reason,
  naturalVersion: 'AI 口语教练可用后，这里会显示更自然、更适合口头表达的英文版本。',
  abilityScores: {
    fluency: '--',
    grammar: '--',
    vocabulary: '--',
    structure: '--'
  },
  encouragement: '先把声音录下来就是进步。口语熟悉感来自一次次开口，而不是一次说完美。',
  retryMission: '再录一次：只改进一个地方，把答案多说出一句具体例子。',
  oneSentenceUpgrade: 'AI 口语教练可用后，这里会显示一句最值得升级的表达。',
  pronunciationHint: '先保持清楚、慢一点、有停顿。发音会在重复中变稳。',
  shadowingLines: ['AI 口语教练可用后，这里会把修改版拆成适合跟读的短句。'],
  progressBadge: '今日开口',
  errors: ['请先在 Cloudflare Pages 环境变量中配置 OPENAI_API_KEY，然后重新部署。'],
  memorableExpressions: ['speak more naturally - 说得更自然'],
  nextPractice: ['完成 API key 配置后，再提交同一段口语文本进行正式点评。']
});

const buildPrompt = ({ topic, transcript, wordCount, previousAttempt }) => `
You are an English speaking coach for a Chinese native speaker. The learner wants to improve spoken English for work, investing, management, and daily communication.

Speaking topic:
Day ${topic?.day || ''} - ${topic?.title || ''}
Prompt: ${topic?.prompt || ''}
Category: ${topic?.category || 'General'}
Word count: ${wordCount}

Learner transcript from speech recognition:
${transcript}

Previous attempt, if this is a retry:
${previousAttempt?.transcript || 'None'}

Return ONLY valid JSON with this exact shape:
{
  "score": "72/100",
  "summary": "A concise Chinese summary of the learner's speaking level and main focus.",
  "abilityScores": {
    "fluency": "70",
    "grammar": "68",
    "vocabulary": "72",
    "structure": "75"
  },
  "encouragement": "One specific, warm Chinese sentence that makes the learner want to record again.",
  "retryMission": "One concrete Chinese challenge for the next recording attempt.",
  "oneSentenceUpgrade": "Original idea -> more natural spoken English sentence.",
  "pronunciationHint": "A practical Chinese pronunciation or rhythm tip inferred from the transcript.",
  "naturalVersion": "A more natural spoken English version. Keep the learner's original meaning. Use clear, practical spoken English, not a formal essay.",
  "shadowingLines": ["Short spoken English sentence for shadowing"],
  "progressBadge": "A short Chinese badge name for this attempt, such as 更敢开口 or 句子变长",
  "errors": ["Chinese explanation with original problem and correction"],
  "memorableExpressions": ["English expression - Chinese meaning"],
  "nextPractice": ["Chinese actionable task"]
}

Rules:
- Use Chinese for feedback.
- Keep naturalVersion in English.
- abilityScores must be 0-100 strings. Be generous for effort but honest about clarity.
- encouragement must avoid shame. Reward recording, retrying, and clearer expression.
- retryMission must be small enough to do immediately in one more recording.
- shadowingLines should split naturalVersion into 3-6 short spoken lines.
- Return exactly 3 items in errors.
- Return exactly 5 items in memorableExpressions.
- Keep nextPractice to 2-3 practical actions.
- Focus on spoken English: clarity, grammar, word choice, sentence structure, and natural phrasing.
- If there is a previous attempt, compare gently and mention one improvement or one next delta.
- If the transcript is very short, still give useful feedback. Treat it as a starting attempt and suggest how to extend it into the next sentence or paragraph.
- For short answers under 20 words, do not punish length heavily. Focus on helping the learner say one clearer, more natural version and one practical expansion.
- Do not overpraise. Be supportive and specific.
`;

export async function onRequestPost({ request, env }) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: '请求格式不正确。' }, 400);
  }

  const transcript = typeof payload.transcript === 'string' ? payload.transcript.trim() : '';
  const wordCount = transcript.split(/\s+/).filter(Boolean).length;
  if (!transcript) {
    return jsonResponse({ error: '请先说一点英文，再提交给口语教练。' }, 400);
  }

  if (!env.OPENAI_API_KEY) {
    return jsonResponse(fallbackFeedback('AI 口语教练还没有配置 OPENAI_API_KEY。'), 200);
  }

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: env.OPENAI_SPEAKING_MODEL || env.OPENAI_WRITING_MODEL || 'gpt-4.1-mini',
        messages: [
          {
            role: 'system',
            content:
              'You are a practical English speaking coach for a Chinese native speaker. Return only valid JSON.'
          },
          {
            role: 'user',
            content: buildPrompt({ ...payload, wordCount })
          }
        ],
        temperature: 0.2,
        response_format: { type: 'json_object' }
      })
    });

    const data = await response.json();
    if (!response.ok) {
      return jsonResponse(
        fallbackFeedback(data.error?.message || 'OpenAI 口语点评服务暂时不可用。'),
        200
      );
    }

    const text = data.choices?.[0]?.message?.content || '';
    const parsed = JSON.parse(text);
    return jsonResponse(parsed);
  } catch (error) {
    return jsonResponse(fallbackFeedback(error.message || 'AI 口语点评服务暂时不可用。'), 200);
  }
}
