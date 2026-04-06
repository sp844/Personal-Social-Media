const Anthropic = require('@anthropic-ai/sdk');
const { trimVideo } = require('../utils/videoProcessor');
const path = require('path');
const fs = require('fs').promises;

const client = new Anthropic();

async function run(concepts, files, videoManifest, dirs, socket) {
  socket.emit('agent:update', { agentIndex: 4, status: 'running', message: 'Building edit plans and executing video cuts...' });

  const outputClipsDir = path.join(dirs.output, 'clips');
  const conceptsDir = path.join(dirs.output, 'concepts');
  await fs.mkdir(outputClipsDir, { recursive: true });
  await fs.mkdir(conceptsDir, { recursive: true });

  const editPlans = [];

  for (let i = 0; i < concepts.length; i++) {
    const concept = concepts[i];
    socket.emit('log', { message: `Building edit plan for Concept ${i + 1}: ${concept.name}...`, type: 'info' });

    // Execute video trims if any shots use video clips
    const videoCuts = [];
    for (const shot of (concept.shots || [])) {
      if (shot.mediaType === 'video_clip' && shot.startTime && shot.endTime) {
        const videoFile = files.find(f => f.id === shot.mediaId && f.type === 'video');
        if (videoFile && videoFile.clipPath) {
          try {
            const startSeconds = parseTimecode(shot.startTime);
            const endSeconds = parseTimecode(shot.endTime);
            const outputName = `concept${i + 1}_${shot.mediaId}_${startSeconds}s-${endSeconds}s.mp4`;
            const outputPath = path.join(outputClipsDir, outputName);

            socket.emit('log', { message: `Trimming ${shot.mediaId}: ${shot.startTime} → ${shot.endTime}`, type: 'info' });
            const result = await trimVideo(videoFile.clipPath, outputPath, startSeconds, endSeconds);

            videoCuts.push({
              file: videoFile.name,
              mediaId: shot.mediaId,
              segment: `${shot.startTime} → ${shot.endTime}`,
              reason: shot.notes || 'Selected by Story Director',
              outputPath: outputName,
              ffmpegTrim: `ffmpeg -i "${videoFile.name}" -ss ${startSeconds} -to ${endSeconds} -c:v libx264 -preset fast -crf 26 -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1" -c:a aac -b:a 128k "${outputName}"`,
              success: result.success,
              duration: result.duration
            });
            socket.emit('log', { message: `Cut saved: ${outputName} (${result.duration}s)`, type: 'success' });
          } catch (err) {
            socket.emit('log', { message: `FFmpeg trim failed for ${shot.mediaId}: ${err.message}`, type: 'warning' });
            videoCuts.push({
              file: videoFile.name,
              mediaId: shot.mediaId,
              segment: `${shot.startTime} → ${shot.endTime}`,
              reason: shot.notes || '',
              ffmpegTrim: `ffmpeg -i "${videoFile.name}" -ss ${shot.startTime} -to ${shot.endTime} -c:v libx264 -preset fast -crf 26 -c:a aac -b:a 128k "output.mp4"`,
              success: false,
              error: err.message
            });
          }
        }
      }
    }

    // Generate detailed edit plan via Claude
    let editPlan;
    try {
      editPlan = await generateEditPlan(concept, videoCuts, i + 1);
    } catch (err) {
      socket.emit('log', { message: `AI edit plan generation failed, using fallback: ${err.message}`, type: 'warning' });
      editPlan = createFallbackEditPlan(concept, videoCuts, i + 1);
    }

    editPlan.videoCuts = videoCuts;
    editPlans.push(editPlan);

    // Write edit plan to file
    const planText = formatEditPlanText(editPlan, concept, i + 1);
    await fs.writeFile(path.join(conceptsDir, `concept_${i + 1}_edit_plan.txt`), planText);
    socket.emit('log', { message: `Edit plan written for Concept ${i + 1}`, type: 'success' });
  }

  socket.emit('agent:update', {
    agentIndex: 4,
    status: 'done',
    message: `${editPlans.length} edit plans created, ${editPlans.reduce((sum, p) => sum + p.videoCuts.length, 0)} video cuts executed`,
    data: editPlans
  });
  socket.emit('log', { message: `Agent 4 complete: ${editPlans.length} edit plans ready`, type: 'success' });

  return editPlans;
}

async function generateEditPlan(concept, videoCuts, conceptNum) {
  const prompt = `You are a professional video editor. Generate a detailed edit plan for this social media reel concept.

CONCEPT ${conceptNum}: "${concept.name}"
Format: ${concept.format}
Pacing: ${concept.pacing}
Duration: ${concept.estimatedDuration}
Narrative: ${concept.narrativeArc}
Shots: ${JSON.stringify(concept.shots, null, 2)}
Video Cuts Executed: ${JSON.stringify(videoCuts, null, 2)}

Return a JSON object with:
{
  "editingApp": "recommended editing app (CapCut, DaVinci Resolve, Premiere Pro)",
  "colorGrade": "specific LUT or color grade suggestion",
  "keyTransitions": ["list of transition techniques to use"],
  "rapidBurstSetup": "step-by-step instructions for setting up rapid burst sequences if applicable, or null",
  "textOverlays": [
    { "timing": "0:00-0:02", "text": "overlay text", "style": "bold/subtitle/handwritten", "position": "center/bottom/top" }
  ],
  "exportCmd": "full FFmpeg export command for final reel: ffmpeg -i input.mp4 -vf \\"scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1\\" -c:v libx264 -preset slow -crf 22 -c:a aac -b:a 128k output_concept${conceptNum}_reel.mp4",
  "tips": ["3 specific editor tips for this concept"],
  "stepByStep": ["numbered step-by-step editing instructions"]
}

Return ONLY valid JSON.`;

  let retries = 0;
  while (retries < 3) {
    try {
      const response = await client.messages.create({
        model: 'claude-sonnet-4-5-20250514',
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }]
      });

      const text = response.content[0].text;
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) return JSON.parse(jsonMatch[0]);
      return JSON.parse(text);
    } catch (err) {
      if (err.status === 429) {
        retries++;
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }
      throw err;
    }
  }
  throw new Error('Max retries for edit plan generation');
}

function createFallbackEditPlan(concept, videoCuts, conceptNum) {
  return {
    editingApp: 'CapCut (free) or DaVinci Resolve (pro)',
    colorGrade: 'Warm cinematic — lift shadows slightly, desaturate greens, warm highlights',
    keyTransitions: ['Cut on beat', 'Cross dissolve for emotional moments', 'Whip pan for energy'],
    rapidBurstSetup: concept.shots?.some(s => s.mediaType === 'rapid_burst')
      ? '1. Import all burst images. 2. Place each on timeline at 0.4s duration. 3. Add slight zoom keyframes to each. 4. Sync first frame to music beat drop.'
      : null,
    textOverlays: [
      { timing: '0:00-0:02', text: 'Hook text here', style: 'bold', position: 'center' }
    ],
    exportCmd: `ffmpeg -i input.mp4 -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1" -c:v libx264 -preset slow -crf 22 -c:a aac -b:a 128k output_concept${conceptNum}_reel.mp4`,
    tips: [
      'Match cuts to music beats for professional feel',
      'Use 0.5s ease-in/out on all text overlays',
      'Export at 30fps for maximum platform compatibility'
    ],
    stepByStep: [
      '1. Import all media assets into your editor',
      '2. Create a new 1080x1920 (9:16) project at 30fps',
      '3. Arrange shots on timeline following the shot sequence',
      '4. Apply transitions between shots',
      '5. Add text overlays with suggested timing',
      '6. Apply color grade across all clips',
      '7. Add music track and sync cuts to beats',
      '8. Export using the provided FFmpeg command or editor export settings'
    ]
  };
}

function formatEditPlanText(editPlan, concept, conceptNum) {
  let text = `════════════════════════════════════════\n`;
  text += `CONCEPT ${conceptNum}: ${concept.name}\n`;
  text += `════════════════════════════════════════\n\n`;
  text += `Format: ${concept.format}\n`;
  text += `Pacing: ${concept.pacing}\n`;
  text += `Duration: ${concept.estimatedDuration}\n`;
  text += `Narrative: ${concept.narrativeArc}\n\n`;
  text += `─── EDITING APP ───\n${editPlan.editingApp}\n\n`;
  text += `─── COLOR GRADE ───\n${editPlan.colorGrade}\n\n`;
  text += `─── KEY TRANSITIONS ───\n${(editPlan.keyTransitions || []).map(t => `• ${t}`).join('\n')}\n\n`;

  if (editPlan.rapidBurstSetup) {
    text += `─── RAPID BURST SETUP ───\n${editPlan.rapidBurstSetup}\n\n`;
  }

  text += `─── TEXT OVERLAYS ───\n`;
  for (const overlay of (editPlan.textOverlays || [])) {
    text += `[${overlay.timing}] "${overlay.text}" — ${overlay.style}, ${overlay.position}\n`;
  }

  text += `\n─── SHOT SEQUENCE ───\n`;
  for (const shot of (concept.shots || [])) {
    if (shot.mediaType === 'rapid_burst') {
      text += `Shot ${shot.shotNumber}: BURST [${(shot.mediaIds || []).join(', ')}] — ${shot.totalDuration}s — ${shot.transition}\n`;
    } else {
      text += `Shot ${shot.shotNumber}: ${shot.mediaId} (${shot.mediaType}) — ${shot.duration}s — ${shot.transition}${shot.notes ? ' — ' + shot.notes : ''}\n`;
    }
  }

  if (editPlan.videoCuts && editPlan.videoCuts.length > 0) {
    text += `\n─── VIDEO CUT SHEET ───\n`;
    for (const cut of editPlan.videoCuts) {
      text += `${cut.file} → ${cut.segment} | ${cut.reason}\n`;
      text += `  FFmpeg: ${cut.ffmpegTrim}\n`;
      text += `  Status: ${cut.success ? 'EXECUTED' : 'FAILED — run manually'}\n\n`;
    }
  }

  text += `\n─── EXPORT COMMAND ───\n${editPlan.exportCmd}\n\n`;

  text += `─── TIPS ───\n${(editPlan.tips || []).map(t => `• ${t}`).join('\n')}\n\n`;

  text += `─── STEP-BY-STEP ───\n${(editPlan.stepByStep || []).join('\n')}\n`;

  return text;
}

function parseTimecode(tc) {
  if (typeof tc === 'number') return tc;
  const str = String(tc);
  const parts = str.split(':').map(Number);
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return parseFloat(str) || 0;
}

module.exports = { run };
