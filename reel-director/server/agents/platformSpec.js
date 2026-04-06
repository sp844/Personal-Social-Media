async function run(concepts, editPlans, platform, socket) {
  socket.emit('agent:update', { agentIndex: 5, status: 'running', message: 'Applying platform specifications...' });

  const specs = getPlatformSpecs(platform);
  const results = [];

  for (let i = 0; i < concepts.length; i++) {
    const concept = concepts[i];
    const editPlan = editPlans[i] || {};

    const duration = parseFloat(concept.estimatedDuration) || 20;
    const optimalLength = getOptimalLength(platform, concept.format);

    const platformResult = {
      conceptNumber: i + 1,
      conceptName: concept.name,
      platform: platform,
      specs: specs,
      exportCommand: generateExportCommand(concept, i + 1, platform),
      postingRecommendation: getPostingRecommendation(platform, concept),
      soundCategory: getSoundCategory(concept),
      contentType: getContentType(platform, duration),
      optimalLength: optimalLength,
      durationFit: duration <= optimalLength.max ? 'optimal' : 'long — consider trimming',
      tips: getPlatformTips(platform)
    };

    results.push(platformResult);
    socket.emit('log', { message: `Platform spec applied to Concept ${i + 1}: ${platform} ${platformResult.contentType}`, type: 'info' });
  }

  socket.emit('agent:update', {
    agentIndex: 5,
    status: 'done',
    message: `Platform specs applied for ${platform} across ${results.length} concepts`,
    data: results
  });
  socket.emit('log', { message: `Agent 5 complete: ${results.length} concepts spec'd for ${platform}`, type: 'success' });

  return results;
}

function getPlatformSpecs(platform) {
  if (platform === 'tiktok') {
    return {
      name: 'TikTok',
      resolution: '1080 × 1920px',
      aspectRatio: '9:16',
      format: 'MP4 or MOV',
      codec: 'H.264',
      maxFileSize: '287.6 MB',
      maxDuration: '10 minutes',
      optimalDuration: '15-60 seconds',
      frameRate: '23-60 FPS',
      audio: 'AAC',
      coverImage: 'Auto-selected from video'
    };
  }

  return {
    name: 'Instagram Reels',
    resolution: '1080 × 1920px',
    aspectRatio: '9:16',
    format: 'MP4',
    codec: 'H.264',
    maxFileSize: '4 GB',
    maxDuration: '90 seconds',
    optimalDuration: '15-30 seconds',
    frameRate: '23-60 FPS',
    audio: 'AAC 128kbps minimum',
    coverImage: '1080 × 1350px'
  };
}

function getOptimalLength(platform, format) {
  if (platform === 'tiktok') {
    return { min: 15, max: 60, sweet: 30, unit: 'seconds', note: 'TikTok FYP favors 15-60s' };
  }
  if (format && format.toLowerCase().includes('fast')) {
    return { min: 7, max: 20, sweet: 15, unit: 'seconds', note: 'Fast-cut reels perform best at 7-20s' };
  }
  return { min: 15, max: 30, sweet: 22, unit: 'seconds', note: 'Instagram Reels sweet spot is 15-30s for reach' };
}

function generateExportCommand(concept, conceptNum, platform) {
  const preset = platform === 'tiktok' ? 'fast' : 'slow';
  const crf = platform === 'tiktok' ? '23' : '22';
  return `ffmpeg -i input.mp4 -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1" -c:v libx264 -preset ${preset} -crf ${crf} -c:a aac -b:a 128k -r 30 output_concept${conceptNum}_${platform}_reel.mp4`;
}

function getPostingRecommendation(platform, concept) {
  const emotion = concept.shots?.[0]?.notes || concept.narrativeArc || '';

  if (platform === 'tiktok') {
    return {
      bestDays: ['Tuesday', 'Thursday', 'Saturday'],
      bestTimes: ['7-9 AM', '12-1 PM', '7-10 PM'],
      recommended: 'Thursday 7-9 PM',
      note: 'TikTok peaks during commute and evening scroll times'
    };
  }

  return {
    bestDays: ['Tuesday', 'Wednesday', 'Friday'],
    bestTimes: ['6-9 AM', '12 PM', '7-9 PM'],
    recommended: 'Wednesday 7-9 PM',
    note: 'Instagram engagement peaks mid-week evenings'
  };
}

function getSoundCategory(concept) {
  const pacing = (concept.pacing || '').toLowerCase();
  const format = (concept.format || '').toLowerCase();
  const vibe = (concept.musicVibe || '').toLowerCase();

  if (pacing === 'rapid' || format.includes('fast')) {
    return { genre: 'Upbeat Electronic / Hip-Hop', bpm: '120-140', energy: 'High', suggestion: 'Trending audio with drop at 3-second mark' };
  }
  if (pacing === 'slow' || format.includes('cinematic')) {
    return { genre: 'Ambient / Indie / Acoustic', bpm: '70-90', energy: 'Low-Medium', suggestion: 'Emotional piano or ambient synth with vocal sample' };
  }
  return { genre: 'Pop / Indie Pop', bpm: '100-120', energy: 'Medium', suggestion: 'Catchy trending sound with good hook for transition sync' };
}

function getContentType(platform, duration) {
  if (platform === 'instagram') {
    if (duration <= 15) return 'Reel (Story-length)';
    if (duration <= 30) return 'Reel (Optimal reach)';
    if (duration <= 60) return 'Reel (Standard)';
    return 'Reel (Long-form)';
  }
  if (duration <= 15) return 'TikTok (Quick clip)';
  if (duration <= 60) return 'TikTok (FYP optimal)';
  return 'TikTok (Extended)';
}

function getPlatformTips(platform) {
  if (platform === 'tiktok') {
    return [
      'Use trending sounds for 2-3x more reach on FYP',
      'Hook viewers in first 1 second — text overlay helps',
      'Add captions/subtitles — 80% watch without sound',
      'Post 1-3 times daily for algorithm favor',
      'Use 3-5 hashtags max, mix trending + niche'
    ];
  }
  return [
    'First frame must be eye-catching — it becomes the cover',
    'Use Instagram\'s native music for better reach',
    'Add closed captions for accessibility bonus',
    'Reels under 30s get 2x more replays and shares',
    'Post during your audience\'s peak hours (check Insights)'
  ];
}

module.exports = { run };
