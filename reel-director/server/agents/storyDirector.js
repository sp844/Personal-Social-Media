const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic();

async function run(analyses, videoManifest, context, options, socket) {
  socket.emit('agent:update', { agentIndex: 3, status: 'running', message: 'Building 3 narrative concepts...' });

  const { vibe = 'Cinematic', audience = 'General', brief = '', platform = 'instagram' } = options;

  const mediaInventory = analyses.map(a => {
    let line = `- ${a.id} [${a.source}]: ${a.subject} | Category: ${a.category} | Emotion: ${a.emotion} | Quality: ${a.quality_score}/10 | Role: ${a.role} | Recommended: ${a.recommended_use}`;
    if (a.video_source) line += ` | From video: ${a.video_source}`;
    if (a.frame_timestamp) line += ` | At: ${a.frame_timestamp}`;
    return line;
  }).join('\n');

  const videoInventory = videoManifest.map(v => {
    return `- ${v.id}: ${v.name} | ${v.sizeMB} MB | Has clip: ${v.hasClip} | Frames: ${v.frameCount} | Description: ${v.description || 'none'}`;
  }).join('\n');

  const prompt = `You are the Story Director for a social media content studio. You have been given analyzed media assets and must create 3 COMPLETELY DIFFERENT narrative concepts for ${platform === 'tiktok' ? 'TikTok' : 'Instagram Reels'}.

MEDIA INVENTORY:
${mediaInventory || 'No individual image analyses available.'}

VIDEO CLIPS AVAILABLE:
${videoInventory || 'No video clips available.'}

CONTEXT: ${context || 'Social media content'}
VIBE: ${vibe}
TARGET AUDIENCE: ${audience}
DIRECTOR'S BRIEF: ${brief || 'No specific brief provided.'}
PLATFORM: ${platform}

Create 3 concepts following these rules:
1. Each concept must use DIFFERENT media selections (some overlap is OK but the core hero shots must differ)
2. Each shot must specify: media ID, type (photo/video_frame/video_clip/rapid_burst), duration in seconds, transition type
3. For video clips, specify exact start and end timecodes
4. For rapid bursts, provide an array of IDs each shown 0.3-0.6 seconds

THE 3 CONCEPTS MUST BE:
  Concept 1: "FAST-CUT ENERGY" — lots of rapid cuts, burst sequences, high tempo (15-20s optimal)
  Concept 2: "CINEMATIC STORY" — slower pacing, emotional, video clips heavy, narrative arc (25-35s optimal)
  Concept 3: "CREATIVE WILDCARD" — most unexpected combination, the agent's creative choice

For at least one concept, follow the Director's Brief closely.
Do NOT use all media — pick only the strongest assets for each concept.

Return ONLY a JSON array of 3 concept objects with this structure:
[
  {
    "conceptNumber": 1,
    "name": "concept name",
    "format": "Fast-Cut Energy",
    "pacing": "rapid/medium/slow",
    "estimatedDuration": "18s",
    "narrativeArc": "description of the story flow",
    "hookStrategy": "how the first 1-2 seconds grab attention",
    "uniqueAngle": "what makes this concept stand out",
    "musicVibe": "tempo/genre description for music selection",
    "shots": [
      {
        "shotNumber": 1,
        "mediaId": "P1",
        "mediaType": "photo",
        "duration": 1.5,
        "transition": "cut/dissolve/zoom/whip/slide",
        "notes": "usage notes"
      },
      {
        "shotNumber": 2,
        "mediaId": "V1",
        "mediaType": "video_clip",
        "startTime": "0:05",
        "endTime": "0:12",
        "duration": 7,
        "transition": "cut",
        "notes": "main action sequence"
      },
      {
        "shotNumber": 3,
        "mediaIds": ["P2", "P5", "V1_frame_003", "P8"],
        "mediaType": "rapid_burst",
        "burstDuration": 0.4,
        "totalDuration": 1.6,
        "transition": "cut",
        "notes": "energy burst montage"
      }
    ],
    "selectedMedia": ["P1", "V1", "P2", "P5", "V1_frame_003", "P8"]
  }
]

Return ONLY valid JSON, no markdown fences, no explanation.`;

  let retries = 0;
  while (retries < 3) {
    try {
      socket.emit('log', { message: 'Sending media analysis to Story Director AI...', type: 'info' });

      const response = await client.messages.create({
        model: 'claude-sonnet-4-5-20250514',
        max_tokens: 8192,
        messages: [{ role: 'user', content: prompt }]
      });

      const text = response.content[0].text;
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      let concepts;

      if (jsonMatch) {
        concepts = JSON.parse(jsonMatch[0]);
      } else {
        concepts = JSON.parse(text);
      }

      // Validate we got 3 concepts
      if (!Array.isArray(concepts) || concepts.length < 3) {
        throw new Error('Expected 3 concepts, got ' + (concepts ? concepts.length : 0));
      }

      socket.emit('agent:update', {
        agentIndex: 3,
        status: 'done',
        message: `Created 3 concepts: ${concepts.map(c => c.name).join(', ')}`,
        data: concepts
      });
      socket.emit('log', { message: 'Agent 3 complete: 3 narrative concepts created', type: 'success' });

      return concepts;
    } catch (err) {
      if (err.status === 429) {
        retries++;
        socket.emit('log', { message: `Rate limited, waiting 5s (attempt ${retries}/3)...`, type: 'warning' });
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }
      if (retries < 2) {
        retries++;
        socket.emit('log', { message: `Story Director error, retrying: ${err.message}`, type: 'warning' });
        continue;
      }
      throw err;
    }
  }
  throw new Error('Max retries exceeded for Story Director');
}

module.exports = { run };
