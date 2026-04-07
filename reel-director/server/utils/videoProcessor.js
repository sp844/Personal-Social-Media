const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const ffprobePath = require('ffprobe-static').path;
const path = require('path');
const fs = require('fs').promises;

ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

function getVideoDuration(videoPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) return reject(err);
      resolve(metadata.format.duration || 0);
    });
  });
}

function getVideoMetadata(videoPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) return reject(err);
      const videoStream = metadata.streams.find(s => s.codec_type === 'video');
      resolve({
        duration: metadata.format.duration || 0,
        width: videoStream ? videoStream.width : 0,
        height: videoStream ? videoStream.height : 0,
        codec: videoStream ? videoStream.codec_name : 'unknown',
        fps: videoStream ? (function() { var parts = String(videoStream.r_frame_rate).split('/'); return parts.length === 2 ? Number(parts[0]) / Number(parts[1]) : Number(parts[0]) || 0; })() : 0,
        size: metadata.format.size || 0,
        format: metadata.format.format_name
      });
    });
  });
}

function extractFrames(videoPath, outputDir, videoId) {
  return new Promise(async (resolve, reject) => {
    try {
      await fs.mkdir(outputDir, { recursive: true });
      const duration = await getVideoDuration(videoPath);
      const frames = [];

      ffmpeg(videoPath)
        .outputOptions(['-vf', 'fps=0.5', '-q:v', '2'])
        .output(path.join(outputDir, `${videoId}_frame_%03d.jpg`))
        .on('end', async () => {
          try {
            const files = await fs.readdir(outputDir);
            const frameFiles = files
              .filter(f => f.startsWith(videoId) && f.endsWith('.jpg'))
              .sort();

            frameFiles.forEach((file, index) => {
              const timestamp = (index + 1) * 2;
              const mins = Math.floor(timestamp / 60);
              const secs = timestamp % 60;
              frames.push({
                id: `${videoId}_frame_${String(index + 1).padStart(3, '0')}`,
                name: file,
                path: path.join(outputDir, file),
                videoId,
                timestamp: `${mins}:${String(secs).padStart(2, '0')}`,
                timestampSeconds: timestamp
              });
            });

            resolve(frames);
          } catch (err) {
            reject(err);
          }
        })
        .on('error', (err) => reject(err))
        .run();
    } catch (err) {
      reject(err);
    }
  });
}

function trimVideo(inputPath, outputPath, startTime, endTime) {
  return new Promise((resolve, reject) => {
    let cmd = ffmpeg(inputPath)
      .setStartTime(startTime)
      .setDuration(endTime - startTime)
      .videoCodec('libx264')
      .addOutputOptions([
        '-preset', 'fast',
        '-crf', '26',
        '-vf', 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1'
      ])
      .audioCodec('aac')
      .audioBitrate('128k')
      .output(outputPath);

    cmd.on('end', async () => {
      try {
        const duration = await getVideoDuration(outputPath);
        resolve({ success: true, outputPath, duration });
      } catch (e) {
        resolve({ success: true, outputPath, duration: endTime - startTime });
      }
    })
    .on('error', (err) => reject(err))
    .run();
  });
}

function exportReel(inputPath, outputPath, options = {}) {
  const { preset = 'slow', crf = 22, audioBitrate = '128k' } = options;
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .videoCodec('libx264')
      .addOutputOptions([
        '-preset', preset,
        '-crf', String(crf),
        '-vf', 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1'
      ])
      .audioCodec('aac')
      .audioBitrate(audioBitrate)
      .output(outputPath)
      .on('end', () => resolve({ success: true, outputPath }))
      .on('error', (err) => reject(err))
      .run();
  });
}

module.exports = { getVideoDuration, getVideoMetadata, extractFrames, trimVideo, exportReel, ffmpeg };
