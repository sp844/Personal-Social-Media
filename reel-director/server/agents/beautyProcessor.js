const path = require('path');
const fs = require('fs').promises;
const { isPortrait, applyBeautyProcessing } = require('../utils/imageProcessor');

async function run(files, settings, dirs, socket) {
  socket.emit('agent:update', { agentIndex: 1, status: 'running', message: 'Starting beauty processing...' });

  const {
    skinSmoothing = false,
    smoothingStrength = 'medium',
    faceSlimming = false,
    slimmingAmount = 'none',
    brightnessLift = false,
    warmthBoost = false,
    usePicsart = false
  } = settings || {};

  // If all beauty settings are off, skip
  if (!skinSmoothing && !faceSlimming && !brightnessLift && !warmthBoost) {
    socket.emit('agent:update', { agentIndex: 1, status: 'done', message: 'Beauty processing skipped (all settings off)' });
    socket.emit('log', { message: 'Agent 1: All beauty settings disabled, skipping', type: 'info' });
    return { files, processed: 0, skipped: files.length };
  }

  const results = { processed: [], skipped: [], errors: [] };

  // Get all photos (including video frames)
  const allPhotos = [];
  for (const file of files) {
    if (file.type === 'photo') {
      allPhotos.push(file);
    }
    if (file.frames) {
      for (const frame of file.frames) {
        allPhotos.push({
          ...frame,
          type: 'frame',
          compressedPath: frame.compressedPath || frame.path
        });
      }
    }
  }

  let processedCount = 0;
  let skippedCount = 0;

  for (let i = 0; i < allPhotos.length; i++) {
    const photo = allPhotos[i];
    const inputPath = photo.compressedPath || photo.localPath;

    try {
      const portrait = await isPortrait(inputPath);

      if (!portrait) {
        skippedCount++;
        results.skipped.push({ name: photo.name || photo.id, reason: 'Not portrait orientation' });
        socket.emit('log', { message: `Skipped ${photo.name || photo.id} (landscape/scenery)`, type: 'info' });
        continue;
      }

      const outputFileName = `beauty_${photo.id || path.basename(inputPath)}`;
      const outputPath = path.join(dirs.beauty, outputFileName.endsWith('.jpg') ? outputFileName : outputFileName + '.jpg');

      // Try Picsart first if enabled
      if (usePicsart && process.env.PICSART_API_KEY) {
        try {
          const picsartResult = await processPicsart(inputPath, outputPath);
          if (picsartResult.success) {
            photo.beautyPath = outputPath;
            processedCount++;
            results.processed.push({ name: photo.name || photo.id, method: 'picsart' });
            socket.emit('log', { message: `Beauty processed (Picsart): ${photo.name || photo.id}`, type: 'success' });
            continue;
          }
        } catch (err) {
          socket.emit('log', { message: `Picsart failed for ${photo.name || photo.id}, falling back to Sharp: ${err.message}`, type: 'warning' });
        }
      }

      // Sharp-based processing
      await applyBeautyProcessing(inputPath, outputPath, {
        skinSmoothing,
        smoothingStrength,
        faceSlimming,
        slimmingAmount,
        brightnessLift,
        warmthBoost
      });

      photo.beautyPath = outputPath;
      processedCount++;
      results.processed.push({ name: photo.name || photo.id, method: 'sharp' });
      socket.emit('log', { message: `Beauty processed (Sharp): ${photo.name || photo.id} [${i + 1}/${allPhotos.length}]`, type: 'success' });

    } catch (err) {
      skippedCount++;
      results.errors.push({ name: photo.name || photo.id, error: err.message });
      socket.emit('log', { message: `Beauty error for ${photo.name || photo.id}: ${err.message}`, type: 'warning' });
    }
  }

  socket.emit('agent:update', {
    agentIndex: 1,
    status: 'done',
    message: `Processed ${processedCount} portraits, skipped ${skippedCount}`,
    data: results
  });
  socket.emit('log', { message: `Agent 1 complete: ${processedCount} processed, ${skippedCount} skipped`, type: 'success' });

  return { files, processed: processedCount, skipped: skippedCount, results };
}

async function processPicsart(inputPath, outputPath) {
  const fetch = require('node-fetch');
  const FormData = require('form-data');
  const fsSync = require('fs');

  const form = new FormData();
  form.append('image', fsSync.createReadStream(inputPath));
  form.append('upscale_factor', '1');

  const response = await fetch('https://api.picsart.io/tools/1.0/upscale/enhance', {
    method: 'POST',
    headers: {
      'X-Picsart-API-Key': process.env.PICSART_API_KEY
    },
    body: form
  });

  if (!response.ok) {
    throw new Error(`Picsart API error: ${response.status}`);
  }

  const data = await response.json();
  if (data.data && data.data.url) {
    const imageResponse = await fetch(data.data.url);
    const buffer = await imageResponse.buffer();
    await fs.writeFile(outputPath, buffer);
    return { success: true };
  }

  throw new Error('No image URL in Picsart response');
}

module.exports = { run };
