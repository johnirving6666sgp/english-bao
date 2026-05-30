const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8'
    }
  });

const hashText = async (text) => {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32);
};

const saveBandSevenEssay = async ({ env, payload, essay, wordCount, feedback }) => {
  if (!env.WRITING_CACHE || !feedback?.bandSevenVersion) return feedback;

  try {
    const cacheId = await hashText(
      [
        payload.topic?.id || payload.topic?.question || 'writing-topic',
        essay,
        feedback.bandSevenVersion
      ].join('\n---\n')
    );
    const essayKey = `writing:band7:${cacheId}`;
    const audioKey = `writing:band7-audio:${cacheId}`;

    await env.WRITING_CACHE.put(
      essayKey,
      JSON.stringify({
        createdAt: new Date().toISOString(),
        topic: payload.topic || null,
        sourceEssay: essay,
        sourceWordCount: wordCount,
        bandSevenVersion: feedback.bandSevenVersion,
        conservativeRewrite: feedback.conservativeRewrite || '',
        audioKey
      }),
      {
        metadata: {
          type: 'writing-band-seven',
          topicId: payload.topic?.id || '',
          audioKey
        }
      }
    );

    return {
      ...feedback,
      bandSevenCacheKey: essayKey,
      bandSevenAudioKey: audioKey
    };
  } catch {
    return feedback;
  }
};

const fallbackFeedback = (reason) => ({
  overallBand: '暂不可用',
  scores: {
    taskResponse: '--',
    coherenceCohesion: '--',
    lexicalResource: '--',
    grammar: '--'
  },
  summary: reason,
  strengths: ['你的作文已经提交成功，但线上 AI 批改服务还没有完成配置。'],
  keyIssues: ['请先在 Cloudflare Pages 环境变量中配置 OPENAI_API_KEY，然后重新部署。'],
  conservativeRewrite: 'AI 批改服务可用后，这里会显示尽量保留你原意和结构的保守改写版本。',
  bandSevenVersion: 'AI 批改服务可用后，这里会显示更接近 IELTS 7 分表达的示范版本。',
  usefulExpressions: ['configure OPENAI_API_KEY', 'redeploy the Pages project'],
  nextPractice: ['完成 API key 配置后，再提交同一篇作文进行正式批改。']
});

const buildPrompt = ({ topic, essay, wordCount }) => `
You are an IELTS Writing Task 2 coach. Evaluate the learner's essay according to IELTS criteria.

Topic:
${topic?.question || ''}

Topic category: ${topic?.category || 'General'}
Question type: ${topic?.type || 'Task 2'}
Word count: ${wordCount}

Learner essay:
${essay}

Return ONLY valid JSON with this exact shape:
{
  "overallBand": "6.0",
  "scores": {
    "taskResponse": "6.0",
    "coherenceCohesion": "6.0",
    "lexicalResource": "6.0",
    "grammar": "6.0"
  },
  "summary": "A concise Chinese summary of the essay's current level.",
  "strengths": ["Chinese bullet"],
  "keyIssues": ["Chinese bullet"],
  "conservativeRewrite": "A polished version close to the learner's original ideas.",
  "bandSevenVersion": "A stronger Band 7 style version.",
  "usefulExpressions": ["English expression - Chinese meaning"],
  "nextPractice": ["Chinese actionable task"]
}

Rules:
- Use Chinese for feedback, but keep rewritten essays in English.
- Be specific and practical.
- Do not overpraise.
- Keep each array to 3-5 items.
- If the essay is short, still provide useful feedback. Treat it as a growth draft and give concrete expansion advice.
- For short drafts under 100 words, focus on clarity, sentence building, idea expansion, and one practical next paragraph.
`;

export async function onRequestPost({ request, env }) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: '请求格式不正确。' }, 400);
  }

  const essay = typeof payload.essay === 'string' ? payload.essay.trim() : '';
  if (!essay) {
    return jsonResponse({ error: '请先写几句英文，再提交给写作教练。' }, 400);
  }

  if (!env.OPENAI_API_KEY) {
    return jsonResponse(fallbackFeedback('AI 批改服务还没有配置 OPENAI_API_KEY。'), 200);
  }

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: env.OPENAI_WRITING_MODEL || 'gpt-4.1-mini',
        messages: [
          {
            role: 'system',
            content:
              'You are a strict but supportive IELTS Writing Task 2 coach. Return only valid JSON.'
          },
          {
            role: 'user',
            content: buildPrompt(payload)
          }
        ],
        temperature: 0.2,
        response_format: { type: 'json_object' }
      })
    });

    const data = await response.json();
    if (!response.ok) {
      return jsonResponse(
        fallbackFeedback(data.error?.message || 'OpenAI 批改服务暂时不可用。'),
        200
      );
    }

    const text = data.choices?.[0]?.message?.content || '';
    const parsed = JSON.parse(text);
    const saved = await saveBandSevenEssay({
      env,
      payload,
      essay,
      wordCount: payload.wordCount,
      feedback: parsed
    });
    return jsonResponse(saved);
  } catch (error) {
    return jsonResponse(fallbackFeedback(error.message || 'AI 批改服务暂时不可用。'), 200);
  }
}
