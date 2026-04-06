const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');

const compressor = require('./agents/compressor');
const beautyProcessor = require('./agents/beautyProcessor');
const visionScout = require('./agents/visionScout');
const storyDirector = require('./agents/storyDirector');
const editSupervisor = require('./agents/editSupervisor');
const platformSpec = require('./agents/platformSpec');
const copyWriter = require('./agents/copyWriter');

const BASE_DIR = process.env.NODE_ENV === 'production'
  ? '/tmp/reel-director'
  : path.join(__dirname, '..');

function getDirs(runId) {
  const uploadsBase = path.join(BASE_DIR, 'uploads');
  const outputBase = path.join(BASE_DIR, 'output', `run_${runId}`);
  return {
    uploads: uploadsBase,
    compressed: path.join(uploadsBase, 'compressed'),
    beauty: path.join(uploadsBase, 'beauty'),
    frames: path.join(uploadsBase, 'frames'),
    clips: path.join(uploadsBase, 'clips'),
    output: outputBase,
    outputClips: path.join(outputBase, 'clips'),
    outputConcepts: path.join(outputBase, 'concepts')
  };
}

async function ensureDirs(dirs) {
  for (const dir of Object.values(dirs)) {
    await fs.mkdir(dir, { recursive: true });
  }
}

async function cleanUploads(dirs) {
  try {
    const uploadsDir = dirs.uploads;
    const subdirs = ['compressed', 'beauty', 'frames', 'clips'];
    for (const sub of subdirs) {
      const subPath = path.join(uploadsDir, sub);
      try {
        const files = await fs.readdir(subPath);
        for (const file of files) {
          const filePath = path.join(subPath, file);
          const stat = await fs.stat(filePath);
          if (stat.isDirectory()) {
            await fs.rm(filePath, { recursive: true, force: true });
          } else {
            await fs.unlink(filePath);
          }
        }
      } catch (e) {
        // Directory may not exist
      }
    }
  } catch (e) {
    // Non-critical cleanup failure
  }
}

async function runPipeline(params, socket, driveClient) {
  const runId = uuidv4().slice(0, 8);
  const dirs = getDirs(runId);
  await ensureDirs(dirs);

  const {
    files,
    context = '',
    vibe = 'Cinematic',
    audience = 'General',
    brief = '',
    platform = 'instagram',
    beauty = {},
    videoOptions = {}
  } = params;

  const agentNames = [
    'Compressor', 'Beauty Processor', 'Vision Scout',
    'Story Director', 'Edit Supervisor', 'Platform Spec', 'Copy Writer'
  ];

  // Initialize all agents as queued
  for (let i = 0; i < agentNames.length; i++) {
    socket.emit('agent:update', { agentIndex: i, status: 'queued', message: `${agentNames[i]} waiting...` });
  }

  const result = {
    runId,
    platform,
    context,
    vibe,
    audience,
    brief,
    agents: {},
    concepts: null,
    editPlans: null,
    platformSpecs: null,
    captions: null,
    compressionReport: null,
    driveLinks: [],
    errors: []
  };

  try {
    // ═══ AGENT 0: COMPRESSOR ═══
    socket.emit('log', { message: '━━━ AGENT 0: MEDIA COMPRESSOR ━━━', type: 'agent', timestamp: new Date().toISOString() });
    let compressorResult;
    try {
      compressorResult = await compressor.run(files, videoOptions, dirs, socket);
      result.compressionReport = compressorResult.report;
      result.agents.compressor = { status: 'done', report: compressorResult.report };
    } catch (err) {
      socket.emit('agent:update', { agentIndex: 0, status: 'error', message: `Compressor failed: ${err.message}` });
      socket.emit('log', { message: `Agent 0 error: ${err.message}`, type: 'error' });
      result.agents.compressor = { status: 'error', error: err.message };
      result.errors.push({ agent: 'compressor', error: err.message });
      // Continue with original files
      compressorResult = { files, report: null };
    }

    // ═══ AGENT 1: BEAUTY PROCESSOR ═══
    socket.emit('log', { message: '━━━ AGENT 1: BEAUTY PROCESSOR ━━━', type: 'agent', timestamp: new Date().toISOString() });
    try {
      const beautyResult = await beautyProcessor.run(compressorResult.files, beauty, dirs, socket);
      result.agents.beauty = { status: 'done', processed: beautyResult.processed, skipped: beautyResult.skipped };
    } catch (err) {
      socket.emit('agent:update', { agentIndex: 1, status: 'error', message: `Beauty failed: ${err.message}` });
      socket.emit('log', { message: `Agent 1 error: ${err.message}`, type: 'error' });
      result.agents.beauty = { status: 'error', error: err.message };
      result.errors.push({ agent: 'beauty', error: err.message });
    }

    // ═══ AGENT 2: VISION SCOUT ═══
    socket.emit('log', { message: '━━━ AGENT 2: VISION SCOUT ━━━', type: 'agent', timestamp: new Date().toISOString() });
    let visionResult = { analyses: [], videoManifest: [] };
    try {
      visionResult = await visionScout.run(compressorResult.files, context, socket);
      result.agents.vision = { status: 'done', analyzed: visionResult.analyses.length };
    } catch (err) {
      socket.emit('agent:update', { agentIndex: 2, status: 'error', message: `Vision failed: ${err.message}` });
      socket.emit('log', { message: `Agent 2 error: ${err.message}`, type: 'error' });
      result.agents.vision = { status: 'error', error: err.message };
      result.errors.push({ agent: 'vision', error: err.message });
    }

    // ═══ AGENT 3: STORY DIRECTOR ═══
    socket.emit('log', { message: '━━━ AGENT 3: STORY DIRECTOR ━━━', type: 'agent', timestamp: new Date().toISOString() });
    let concepts = [];
    try {
      concepts = await storyDirector.run(
        visionResult.analyses, visionResult.videoManifest,
        context, { vibe, audience, brief, platform }, socket
      );
      result.concepts = concepts;
      result.agents.story = { status: 'done', concepts: concepts.length };
    } catch (err) {
      socket.emit('agent:update', { agentIndex: 3, status: 'error', message: `Story Director failed: ${err.message}` });
      socket.emit('log', { message: `Agent 3 error: ${err.message}`, type: 'error' });
      result.agents.story = { status: 'error', error: err.message };
      result.errors.push({ agent: 'story', error: err.message });
    }

    // ═══ AGENT 4: EDIT SUPERVISOR ═══
    socket.emit('log', { message: '━━━ AGENT 4: EDIT SUPERVISOR ━━━', type: 'agent', timestamp: new Date().toISOString() });
    let editPlans = [];
    if (concepts.length > 0) {
      try {
        editPlans = await editSupervisor.run(concepts, compressorResult.files, visionResult.videoManifest, dirs, socket);
        result.editPlans = editPlans;
        result.agents.edit = { status: 'done', plans: editPlans.length };
      } catch (err) {
        socket.emit('agent:update', { agentIndex: 4, status: 'error', message: `Edit Supervisor failed: ${err.message}` });
        socket.emit('log', { message: `Agent 4 error: ${err.message}`, type: 'error' });
        result.agents.edit = { status: 'error', error: err.message };
        result.errors.push({ agent: 'edit', error: err.message });
      }
    } else {
      socket.emit('agent:update', { agentIndex: 4, status: 'done', message: 'Skipped — no concepts to edit' });
    }

    // ═══ AGENT 5: PLATFORM SPEC ═══
    socket.emit('log', { message: '━━━ AGENT 5: PLATFORM SPEC ━━━', type: 'agent', timestamp: new Date().toISOString() });
    let platformSpecs = [];
    if (concepts.length > 0) {
      try {
        platformSpecs = await platformSpec.run(concepts, editPlans, platform, socket);
        result.platformSpecs = platformSpecs;
        result.agents.platform = { status: 'done', specs: platformSpecs.length };
      } catch (err) {
        socket.emit('agent:update', { agentIndex: 5, status: 'error', message: `Platform Spec failed: ${err.message}` });
        socket.emit('log', { message: `Agent 5 error: ${err.message}`, type: 'error' });
        result.agents.platform = { status: 'error', error: err.message };
        result.errors.push({ agent: 'platform', error: err.message });
      }
    } else {
      socket.emit('agent:update', { agentIndex: 5, status: 'done', message: 'Skipped — no concepts' });
    }

    // ═══ AGENT 6: COPY WRITER ═══
    socket.emit('log', { message: '━━━ AGENT 6: COPY WRITER ━━━', type: 'agent', timestamp: new Date().toISOString() });
    let captions = [];
    if (concepts.length > 0) {
      try {
        captions = await copyWriter.run(concepts, platformSpecs, context, { vibe, audience, platform }, socket);
        result.captions = captions;
        result.agents.copy = { status: 'done', captions: captions.length };
      } catch (err) {
        socket.emit('agent:update', { agentIndex: 6, status: 'error', message: `Copy Writer failed: ${err.message}` });
        socket.emit('log', { message: `Agent 6 error: ${err.message}`, type: 'error' });
        result.agents.copy = { status: 'error', error: err.message };
        result.errors.push({ agent: 'copy', error: err.message });
      }
    } else {
      socket.emit('agent:update', { agentIndex: 6, status: 'done', message: 'Skipped — no concepts' });
    }

    // ═══ WRITE OUTPUT FILES ═══
    socket.emit('log', { message: '━━━ WRITING OUTPUT FILES ━━━', type: 'agent', timestamp: new Date().toISOString() });
    await writeOutputFiles(result, dirs);

    // ═══ UPLOAD TO GOOGLE DRIVE ═══
    if (driveClient) {
      try {
        socket.emit('log', { message: 'Uploading results to Google Drive...', type: 'info' });
        const driveLinks = await uploadResultsToDrive(driveClient, result, dirs);
        result.driveLinks = driveLinks;
        socket.emit('log', { message: `Uploaded ${driveLinks.length} files to Google Drive`, type: 'success' });
      } catch (err) {
        socket.emit('log', { message: `Drive upload failed: ${err.message}`, type: 'warning' });
        result.errors.push({ agent: 'drive', error: err.message });
      }
    }

    // ═══ CLEANUP ═══
    await cleanUploads(dirs);
    socket.emit('log', { message: 'Temp files cleaned up', type: 'info' });

  } catch (err) {
    socket.emit('log', { message: `Pipeline error: ${err.message}`, type: 'error' });
    result.errors.push({ agent: 'pipeline', error: err.message });
  }

  socket.emit('pipeline:complete', { runId, result });
  socket.emit('log', { message: `Pipeline complete! Run ID: ${runId}`, type: 'success', timestamp: new Date().toISOString() });

  return result;
}

async function writeOutputFiles(result, dirs) {
  const outputDir = dirs.output;
  await fs.mkdir(outputDir, { recursive: true });

  // Write concept edit plans (already written by Edit Supervisor, but also write captions)
  if (result.captions) {
    for (let i = 0; i < result.captions.length; i++) {
      const caption = result.captions[i];
      const text = formatCaptionText(caption, i + 1);
      await fs.writeFile(path.join(outputDir, `concept_${i + 1}_caption.txt`), text);
    }
  }

  // Write full pipeline result JSON
  await fs.writeFile(
    path.join(outputDir, 'pipeline_result.json'),
    JSON.stringify(result, null, 2)
  );
}

function formatCaptionText(caption, conceptNum) {
  let text = `════════════════════════════════════════\n`;
  text += `CONCEPT ${conceptNum} CAPTION PACKAGE\n`;
  text += `════════════════════════════════════════\n\n`;
  text += `HOOK LINE:\n${caption.hookLine}\n\n`;
  text += `CAPTION:\n${caption.captionBody}\n\n`;
  text += `CTA:\n${caption.cta}\n\n`;
  text += `HASHTAGS:\n${(caption.hashtags || []).join(' ')}\n\n`;
  text += `POSTING TIME: ${caption.postingTime}\n`;
  text += `SOUND SUGGESTION: ${caption.soundSuggestion}\n`;
  text += `ALT TEXT: ${caption.altText}\n`;
  return text;
}

async function uploadResultsToDrive(drive, result, dirs) {
  const { ensureOutputFolder, uploadToDrive } = require('./utils/driveClient');
  const links = [];

  try {
    const folderId = await ensureOutputFolder(drive);
    const outputDir = dirs.output;

    const filesToUpload = [];
    try {
      const dirFiles = await fs.readdir(outputDir);
      for (const file of dirFiles) {
        const filePath = path.join(outputDir, file);
        const stat = await fs.stat(filePath);
        if (stat.isFile()) {
          filesToUpload.push({ path: filePath, name: file });
        }
      }
    } catch (e) {
      // Skip if output dir read fails
    }

    // Also upload from concepts subdirectory
    try {
      const conceptsDir = path.join(outputDir, 'concepts');
      const conceptFiles = await fs.readdir(conceptsDir);
      for (const file of conceptFiles) {
        filesToUpload.push({ path: path.join(conceptsDir, file), name: file });
      }
    } catch (e) {
      // Skip
    }

    for (const file of filesToUpload) {
      try {
        const uploaded = await uploadToDrive(drive, file.path, file.name, folderId);
        links.push({ name: file.name, ...uploaded });
      } catch (e) {
        // Skip individual upload failures
      }
    }
  } catch (e) {
    // Drive upload non-critical
  }

  return links;
}

module.exports = { runPipeline };
