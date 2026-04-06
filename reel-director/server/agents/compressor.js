const path = require('path');
const fs = require('fs').promises;
const { compressImage } = require('../utils/imageProcessor');
const { extractFrames, getVideoMetadata } = require('../utils/videoProcessor');

async function run(files, videoOptions, dirs, socket) {
  const report = {
    photos: [],
    videos: [],
    totalOriginalBytes: 0,
    totalCompressedBytes: 0,
    frames: []
  };

  socket.emit('agent:update', { agentIndex: 0, status: 'running', message: 'Starting media compression...' });

  // Process photos
  const photos = files.filter(f => f.type === 'photo');
  for (let i = 0; i < photos.length; i++) {
    const photo = photos[i];
    try {
      socket.emit('log', { message: `Compressing photo ${i + 1}/${photos.length}: ${photo.name}`, type: 'info' });
      const result = await compressImage(photo.localPath, dirs.compressed);
      report.photos.push({
        name: photo.name,
        id: photo.id,
        originalSize: result.originalSize,
        compressedSize: result.compressedSize,
        savedPercent: result.savedPercent,
        compressedPath: result.outputPath
      });
      photo.compressedPath = result.outputPath;
      report.totalOriginalBytes += result.originalSize;
      report.totalCompressedBytes += result.compressedSize;
    } catch (err) {
      socket.emit('log', { message: `Warning: Failed to compress ${photo.name}, using original: ${err.message}`, type: 'warning' });
      photo.compressedPath = photo.localPath;
      const stats = await fs.stat(photo.localPath);
      report.photos.push({
        name: photo.name,
        id: photo.id,
        originalSize: stats.size,
        compressedSize: stats.size,
        savedPercent: '0.0',
        compressedPath: photo.localPath,
        error: true
      });
      report.totalOriginalBytes += stats.size;
      report.totalCompressedBytes += stats.size;
    }
  }

  // Process videos
  const videos = files.filter(f => f.type === 'video');
  for (let i = 0; i < videos.length; i++) {
    const video = videos[i];
    const option = (videoOptions && videoOptions[video.id]) || { mode: 'clip' };
    const mode = option.mode || 'clip';

    try {
      socket.emit('log', { message: `Processing video ${i + 1}/${videos.length}: ${video.name} (mode: ${mode})`, type: 'info' });
      const metadata = await getVideoMetadata(video.localPath);

      const videoReport = {
        name: video.name,
        id: video.id,
        option: mode,
        duration: metadata.duration,
        size: metadata.size,
        framesExtracted: 0,
        hasClip: false
      };

      if (mode === 'clip' || mode === 'both') {
        // Copy video to clips directory
        const clipPath = path.join(dirs.clips, video.name);
        await fs.copyFile(video.localPath, clipPath);
        video.clipPath = clipPath;
        videoReport.hasClip = true;
        socket.emit('log', { message: `Video clip saved: ${video.name}`, type: 'success' });
      }

      if (mode === 'frames' || mode === 'both') {
        // Extract frames
        const frameDir = path.join(dirs.frames, video.id);
        const frames = await extractFrames(video.localPath, frameDir, video.id);

        // Compress each frame
        for (const frame of frames) {
          try {
            const result = await compressImage(frame.path, dirs.compressed);
            frame.compressedPath = result.outputPath;
            report.totalOriginalBytes += result.originalSize;
            report.totalCompressedBytes += result.compressedSize;
          } catch (err) {
            frame.compressedPath = frame.path;
          }
        }

        video.frames = frames;
        report.frames.push(...frames);
        videoReport.framesExtracted = frames.length;
        socket.emit('log', { message: `Extracted ${frames.length} frames from ${video.name}`, type: 'success' });
      }

      report.videos.push(videoReport);
    } catch (err) {
      socket.emit('log', { message: `Warning: Failed to process video ${video.name}: ${err.message}`, type: 'warning' });
      report.videos.push({
        name: video.name,
        id: video.id,
        option: mode,
        error: err.message,
        framesExtracted: 0,
        hasClip: false
      });
    }
  }

  const totalSavedMB = ((report.totalOriginalBytes - report.totalCompressedBytes) / (1024 * 1024)).toFixed(2);
  const totalReduction = report.totalOriginalBytes > 0
    ? ((report.totalOriginalBytes - report.totalCompressedBytes) / report.totalOriginalBytes * 100).toFixed(1)
    : '0.0';

  report.summary = {
    totalFiles: files.length,
    totalPhotos: photos.length,
    totalVideos: videos.length,
    totalFramesExtracted: report.frames.length,
    originalMB: (report.totalOriginalBytes / (1024 * 1024)).toFixed(2),
    compressedMB: (report.totalCompressedBytes / (1024 * 1024)).toFixed(2),
    savedMB: totalSavedMB,
    reductionPercent: totalReduction
  };

  socket.emit('agent:update', { agentIndex: 0, status: 'done', message: `Compressed ${files.length} files. Saved ${totalSavedMB} MB (${totalReduction}% reduction)`, data: report });
  socket.emit('log', { message: `Agent 0 complete: ${totalSavedMB} MB saved across ${files.length} files`, type: 'success' });

  return { files, report };
}

module.exports = { run };
