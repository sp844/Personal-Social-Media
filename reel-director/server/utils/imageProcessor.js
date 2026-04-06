const sharp = require('sharp');
const path = require('path');
const fs = require('fs').promises;

async function compressImage(inputPath, outputDir, options = {}) {
  const stats = await fs.stat(inputPath);
  const fileSizeMB = stats.size / (1024 * 1024);

  let maxDim = 900;
  let quality = 75;

  if (fileSizeMB > 10) {
    maxDim = 720;
    quality = 65;
  } else if (fileSizeMB > 5) {
    maxDim = 800;
    quality = 70;
  }

  if (options.maxDim) maxDim = options.maxDim;
  if (options.quality) quality = options.quality;

  const fileName = path.basename(inputPath, path.extname(inputPath)) + '.jpg';
  const outputPath = path.join(outputDir, fileName);

  const metadata = await sharp(inputPath).metadata();
  const longestSide = Math.max(metadata.width, metadata.height);

  let pipeline = sharp(inputPath);

  if (longestSide > maxDim) {
    pipeline = pipeline.resize(maxDim, maxDim, {
      fit: 'inside',
      withoutEnlargement: true
    });
  }

  await pipeline.jpeg({ quality, mozjpeg: true }).toFile(outputPath);

  const compressedStats = await fs.stat(outputPath);

  return {
    inputPath,
    outputPath,
    originalSize: stats.size,
    compressedSize: compressedStats.size,
    savedBytes: stats.size - compressedStats.size,
    savedPercent: ((stats.size - compressedStats.size) / stats.size * 100).toFixed(1),
    width: metadata.width,
    height: metadata.height
  };
}

async function isPortrait(imagePath) {
  const metadata = await sharp(imagePath).metadata();
  return metadata.height > metadata.width * 0.7;
}

async function applyBeautyProcessing(inputPath, outputPath, settings = {}) {
  const {
    skinSmoothing = false,
    smoothingStrength = 'medium',
    faceSlimming = false,
    slimmingAmount = 'none',
    brightnessLift = false,
    warmthBoost = false
  } = settings;

  let pipeline = sharp(inputPath);
  const metadata = await pipeline.metadata();

  // Skin smoothing via blur
  if (skinSmoothing) {
    const sigmaMap = { light: 0.3, medium: 0.5, strong: 0.8 };
    const sigma = sigmaMap[smoothingStrength] || 0.5;
    pipeline = sharp(inputPath).blur(sigma);
  }

  // Brightness and warmth
  const modulate = {};
  if (brightnessLift) modulate.brightness = 1.03;
  if (warmthBoost) modulate.saturation = 1.06;
  if (Object.keys(modulate).length > 0) {
    pipeline = pipeline.modulate(modulate);
  }

  // Subtle contrast lift
  pipeline = pipeline.linear(1.02, -3);

  // Face slimming using geometric approach
  if (faceSlimming && slimmingAmount !== 'none') {
    const slimFactors = { subtle: 0.96, medium: 0.93, strong: 0.90 };
    const slimFactor = slimFactors[slimmingAmount] || 1;

    if (slimFactor < 1) {
      // Process base image first
      const baseBuffer = await pipeline.toBuffer();

      // Extract center region
      const centerW = Math.round(metadata.width * 0.7);
      const centerH = Math.round(metadata.height * 0.75);
      const left = Math.round((metadata.width - centerW) / 2);
      const top = Math.round((metadata.height - centerH) / 2);

      const slimmedWidth = Math.round(centerW * slimFactor);

      const faceRegion = await sharp(baseBuffer)
        .extract({ left, top, width: centerW, height: centerH })
        .resize(slimmedWidth, centerH, { fit: 'fill' })
        .resize(centerW, centerH, { fit: 'fill' })
        .toBuffer();

      await sharp(baseBuffer)
        .composite([{ input: faceRegion, left, top }])
        .jpeg({ quality: 90 })
        .toFile(outputPath);

      return { inputPath, outputPath, processed: true, settings };
    }
  }

  await pipeline.jpeg({ quality: 90 }).toFile(outputPath);
  return { inputPath, outputPath, processed: true, settings };
}

async function getImageMetadata(imagePath) {
  const metadata = await sharp(imagePath).metadata();
  return {
    width: metadata.width,
    height: metadata.height,
    format: metadata.format,
    channels: metadata.channels,
    size: metadata.size,
    isPortrait: metadata.height > metadata.width * 0.7
  };
}

module.exports = { compressImage, isPortrait, applyBeautyProcessing, getImageMetadata };
