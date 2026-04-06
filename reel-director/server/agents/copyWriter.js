const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic();

async function run(concepts, platformSpecs, context, options, socket) {
  socket.emit('agent:update', { agentIndex: 6, status: 'running', message: 'Writing captions, hooks, and hashtags...' });

  const { vibe = 'Cinematic', audience = 'General', platform = 'instagram' } = options;
  const captions = [];

  for (let i = 0; i < concepts.length; i++) {
    const concept = concepts[i];
    const spec = platformSpecs[i] || {};

    socket.emit('log', { message: `Writing copy for Concept ${i + 1}: ${concept.name}...`, type: 'info' });

    try {
      const caption = await generateCopy(concept, spec, context, { vibe, audience, platform }, i + 1);
      captions.push(caption);
      socket.emit('log', { message: `Caption written for Concept ${i + 1}`, type: 'success' });
    } catch (err) {
      socket.emit('log', { message: `Copy generation failed for Concept ${i + 1}, using fallback: ${err.message}`, type: 'warning' });
      captions.push(createFallbackCopy(concept, platform, i + 1));
    }
  }

  socket.emit('agent:update', {
    agentIndex: 6,
    status: 'done',
    message: `${captions.length} caption packages created`,
    data: captions
  });
  socket.emit('log', { message: `Agent 6 complete: ${captions.length} caption packages ready`, type: 'success' });

  return captions;
}

async function generateCopy(concept, spec, context, options, conceptNum) {
  const { vibe, audience, platform } = options;

  const prompt = `You are an expert social media copywriter. Write a complete caption package for this ${platform === 'tiktok' ? 'TikTok' : 'Instagram Reels'} concept.

CONCEPT ${conceptNum}: "${concept.name}"
Format: ${concept.format}
Narrative: ${concept.narrativeArc}
Music Vibe: ${concept.musicVibe || 'not specified'}
Content Context: ${context || 'Social media content'}
Vibe: ${vibe}
Target Audience: ${audience}
Posting Recommendation: ${spec.postingRecommendation ? spec.postingRecommendation.recommended : 'Peak hours'}
Sound Category: ${spec.soundCategory ? spec.soundCategory.genre : 'Trending'}

Return a JSON object with:
{
  "hookLine": "scroll-stopping first line, max 8 words, NO period at end",
  "captionBody": "3-5 sentences, conversational tone, 2-3 emojis naturally placed within text (not at start/end), tells a mini-story or adds context",
  "cta": "specific platform-appropriate call to action",
  "hashtags": ["exactly 15 hashtags — mix of 5 large (>1M posts), 5 medium (100K-1M), 5 niche (<100K)"],
  "postingTime": "specific day and hour recommendation (e.g. 'Tuesday 7-9 PM')",
  "soundSuggestion": "specific genre/energy matching the concept pacing and mood",
  "altText": "accessibility description of the video content for screen readers, 125 characters max"
}

Return ONLY valid JSON, no markdown.`;

  let retries = 0;
  while (retries < 3) {
    try {
      const response = await client.messages.create({
        model: 'claude-sonnet-4-5-20250514',
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }]
      });

      const text = response.content[0].text;
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      let result;
      if (jsonMatch) {
        result = JSON.parse(jsonMatch[0]);
      } else {
        result = JSON.parse(text);
      }

      result.conceptNumber = conceptNum;
      result.conceptName = concept.name;
      return result;
    } catch (err) {
      if (err.status === 429) {
        retries++;
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }
      throw err;
    }
  }
  throw new Error('Max retries for copywriting');
}

function createFallbackCopy(concept, platform, conceptNum) {
  return {
    conceptNumber: conceptNum,
    conceptName: concept.name,
    hookLine: 'You need to see this',
    captionBody: `Something special happened and we caught every moment of it ✨ This ${concept.format || 'reel'} captures the energy perfectly — from the first frame to the last 🎬 Sometimes the best stories tell themselves 💫`,
    cta: platform === 'tiktok' ? 'Follow for more moments like this' : 'Save this for inspiration & follow for more',
    hashtags: [
      '#reels', '#trending', '#viral', '#explore', '#fyp',
      '#contentcreator', '#aesthetic', '#vibes', '#inspo', '#creative',
      '#dailyvlog', '#moodboard', '#storytelling', '#cinematic', '#reelstrending'
    ],
    postingTime: platform === 'tiktok' ? 'Thursday 7-9 PM' : 'Wednesday 7-9 PM',
    soundSuggestion: 'Trending audio with moderate energy that matches the visual pacing',
    altText: `A ${concept.format || 'creative'} reel featuring ${concept.narrativeArc || 'curated moments'}`
  };
}

module.exports = { run };
