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
  errors: ['请先在 Cloudflare Pages 环境变量中配置 OPENAI_API_KEY，然后重新部署。'],
  memorableExpressions: ['speak more naturally - 说得更自然'],
  nextPractice: ['完成 API key 配置后，再提交同一段口语文本进行正式点评。']
});

const buildPrompt = ({ topic, transcript, wordCount }) => `
You are an English speaking coach for a Chinese native speaker. The learner wants to improve spoken English for work, investing, management, and daily communication.

Speaking topic:
Day ${topic?.day || ''} - ${topic?.title || ''}
Prompt: ${topic?.prompt || ''}
Category: ${topic?.category || 'General'}
Word count: ${wordCount}

Learner transcript from speech recognition:
${transcript}

Return ONLY valid JSON with this exact shape:
{
  "score": "72/100",
  "summary": "A concise Chinese summary of the learner's speaking level and main focus.",
  "naturalVersion": "A more natural spoken English version. Keep the learner's original meaning. Use clear, practical spoken English, not a formal essay.",
  "errors": ["Chinese explanation with original problem and correction"],
  "memorableExpressions": ["English expression - Chinese meaning"],
  "nextPractice": ["Chinese actionable task"]
}

Rules:
- Use Chinese for feedback.
- Keep naturalVersion in English.
- Return exactly 3 items in errors.
- Return exactly 5 items in memorableExpressions.
- Keep nextPractice to 2-3 practical actions.
- Focus on spoken English: clarity, grammar, word choice, sentence structure, and natural phrasing.
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
