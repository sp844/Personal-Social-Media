const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs').promises;
const path = require('path');

const client = new Anthropic();

async function run(files, context, socket) {
  socket.emit('agent:update', { agentIndex: 2, status: 'running', message: 'Analyzing media with Claude Vision...' });

  // Gather all images to analyze
  const allImages = [];

  for (const file of files) {
    if (file.type === 'photo') {
      const imgPath = file.beautyPath || file.compressedPath || file.localPath;
      allImages.push({
        id: file.id,
        path: imgPath,
        source: 'photo',
        name: file.name
      });
    }
    if (file.frames) {
      for (const frame of file.frames) {
        const imgPath = frame.beautyPath || frame.compressedPath || frame.path;
        allImages.push({
          id: frame.id,
          path: imgPath,
          source: 'video_frame',
          videoSource: file.name,
          frameTimestamp: frame.timestamp,
          name: frame.name
        });
      }
    }
  }

  // Smart sample to max 25
  let sampled = allImages;
  if (allImages.length > 25) {
    const step = allImages.length / 25;
    sampled = [];
    for (let i = 0; i < 25; i++) {
      sampled.push(allImages[Math.floor(i * step)]);
    }
    socket.emit('log', { message: `Smart-sampled ${allImages.length} images down to 25`, type: 'info' });
  }

  socket.emit('log', { message: `Analyzing ${sampled.length} images with Claude Vision...`, type: 'info' });

  // Process in batches of 5
  const analyses = [];
  const batchSize = 5;

  for (let i = 0; i < sampled.length; i += batchSize) {
    const batch = sampled.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(sampled.length / batchSize);

    socket.emit('log', { message: `Vision batch ${batchNum}/${totalBatches} (${batch.length} images)...`, type: 'info' });

    try {
      const batchResults = await analyzeBatch(batch, context);
      analyses.push(...batchResults);
      socket.emit('log', { message: `Batch ${batchNum} complete: ${batchResults.length} analyzed`, type: 'success' });
    } catch (err) {
      socket.emit('log', { message: `Batch ${batchNum} failed, retrying individually: ${err.message}`, type: 'warning' });

      // Retry individually
      for (const img of batch) {
        try {
          const result = await analyzeBatch([img], context);
          analyses.push(...result);
        } catch (err2) {
          socket.emit('log', { message: `Skipped ${img.id}: ${err2.message}`, type: 'warning' });
          analyses.push(createFallbackAnalysis(img));
        }
      }
    }
  }

  // Build video manifest
  const videoManifest = [];
  for (const file of files) {
    if (file.type === 'video') {
      videoManifest.push({
        id: file.id,
        name: file.name,
        sizeMB: file.size ? (file.size / (1024 * 1024)).toFixed(2) : 'unknown',
        description: file.description || '',
        option: file.videoOption || 'clip',
        hasClip: !!file.clipPath,
        frameCount: file.frames ? file.frames.length : 0
      });
    }
  }

  socket.emit('agent:update', {
    agentIndex: 2,
    status: 'done',
    message: `Analyzed ${analyses.length} images, ${videoManifest.length} video clips`,
    data: { analyses, videoManifest }
  });
  socket.emit('log', { message: `Agent 2 complete: ${analyses.length} images analyzed`, type: 'success' });

  return { analyses, videoManifest };
}

async function analyzeBatch(images, context) {
  const content = [];

  for (const img of images) {
    try {
      const imageData = await fs.readFile(img.path);
      const base64 = imageData.toString('base64');
      const ext = path.extname(img.path).toLowerCase();
      const mediaType = ext === '.png' ? 'image/png' : 'image/jpeg';

      content.push({
        type: 'image',
        source: { type: 'base64', media_type: mediaType, data: base64 }
      });
      content.push({
        type: 'text',
        text: `Image ID: ${img.id} | Source: ${img.source}${img.videoSource ? ` | Video: ${img.videoSource}` : ''}${img.frameTimestamp ? ` | Timestamp: ${img.frameTimestamp}` : ''}`
      });
    } catch (err) {
      // Skip unreadable images
    }
  }

  if (content.length === 0) return [];

  content.push({
    type: 'text',
    text: `Context: ${context || 'Social media content'}\n\nAnalyze each image above. For EACH image, return a JSON object with these exact fields:\n- id: the Image ID provided\n- source: "photo" or "video_frame"\n- video_source: original video filename (if frame, else null)\n- frame_timestamp: timestamp string (if frame, else null)\n- subject: brief description of the scene\n- category: one of "people", "food", "scenery", "architecture", "activity", "group", "mixed"\n- emotion: one of "energetic", "calm", "joyful", "dramatic", "intimate", "exciting", "luxurious"\n- quality_score: 1-10\n- lighting: one of "excellent", "good", "fair", "poor"\n- sharpness: one of "sharp", "soft", "blurry"\n- faces_present: boolean\n- face_count: number\n- role: one of "hero", "supporting", "filler", "rapid-sequence-candidate"\n- recommended_use: one of "opening hook", "middle story", "climax", "closing", "rapid burst", "B-roll"\n- notes: specific creative usage note\n\nReturn ONLY a JSON array of objects. No markdown, no explanation.`
  });

  let retries = 0;
  while (retries < 3) {
    try {
      const response = await client.messages.create({
        model: 'claude-sonnet-4-5-20250514',
        max_tokens: 4096,
        messages: [{ role: 'user', content }]
      });

      const text = response.content[0].text;
      // Extract JSON from response
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      // Try parsing entire response as JSON
      return JSON.parse(text);
    } catch (err) {
      if (err.status === 413) {
        // Split batch in half
        if (images.length > 1) {
          const mid = Math.ceil(images.length / 2);
          const first = await analyzeBatch(images.slice(0, mid), context);
          const second = await analyzeBatch(images.slice(mid), context);
          return [...first, ...second];
        }
      }
      if (err.status === 429) {
        retries++;
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }
      throw err;
    }
  }
  throw new Error('Max retries exceeded for Vision API');
}

function createFallbackAnalysis(img) {
  return {
    id: img.id,
    source: img.source,
    video_source: img.videoSource || null,
    frame_timestamp: img.frameTimestamp || null,
    subject: 'Unable to analyze',
    category: 'mixed',
    emotion: 'calm',
    quality_score: 5,
    lighting: 'good',
    sharpness: 'soft',
    faces_present: false,
    face_count: 0,
    role: 'supporting',
    recommended_use: 'B-roll',
    notes: 'Analysis failed, manual review recommended'
  };
}

module.exports = { run };
