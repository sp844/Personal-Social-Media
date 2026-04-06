require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const fsPromises = fs.promises;
const archiver = require('archiver');
const { v4: uuidv4 } = require('uuid');

const {
  createOAuth2Client,
  getDriveClient,
  listFiles,
  downloadFile,
  getFileThumbnail
} = require('./utils/driveClient');
const { runPipeline } = require('./pipeline');

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';
const BASE_DIR = isProd ? '/tmp/reel-director' : path.join(__dirname, '..');

// Ensure directories exist
const uploadsDir = path.join(BASE_DIR, 'uploads');
const outputDir = path.join(BASE_DIR, 'output');
['', '/compressed', '/beauty', '/frames', '/clips'].forEach(sub => {
  const dir = path.join(uploadsDir, sub);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

// Socket.io setup
const io = new Server(server, {
  cors: {
    origin: isProd ? '*' : ['http://localhost:3000', 'http://127.0.0.1:3000'],
    methods: ['GET', 'POST'],
    credentials: true
  }
});

// Middleware
app.use(cors({
  origin: isProd ? true : ['http://localhost:3000', 'http://127.0.0.1:3000'],
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'reel-director-default-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: isProd,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Static files
app.use(express.static(path.join(__dirname, '..', 'public')));

// Multer for direct uploads
const upload = multer({
  dest: path.join(uploadsDir, 'raw'),
  limits: { fileSize: 500 * 1024 * 1024 } // 500MB
});

// ═══════════════════════════════════════
// HEALTH CHECK
// ═══════════════════════════════════════
app.get('/health', (req, res) => {
  let ffmpegOk = false;
  try {
    require('ffmpeg-static');
    ffmpegOk = true;
  } catch (e) { /* */ }

  let sharpOk = false;
  try {
    require('sharp');
    sharpOk = true;
  } catch (e) { /* */ }

  res.json({
    status: 'ok',
    ffmpeg: ffmpegOk,
    sharp: sharpOk,
    node: process.version,
    anthropic: !!process.env.ANTHROPIC_API_KEY,
    google: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    picsart: !!process.env.PICSART_API_KEY,
    uptime: process.uptime()
  });
});

// ═══════════════════════════════════════
// GOOGLE AUTH ROUTES
// ═══════════════════════════════════════
app.get('/auth/google', (req, res) => {
  const oauth2Client = createOAuth2Client();
  const scopes = [
    'https://www.googleapis.com/auth/drive.readonly',
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/userinfo.email'
  ];

  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent'
  });

  res.redirect(url);
});

app.get('/auth/google/callback', async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) return res.redirect('/?error=no_code');

    const oauth2Client = createOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Get user info
    const { google } = require('googleapis');
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();

    // Store tokens and user in session
    req.session.tokens = tokens;
    req.session.user = {
      name: userInfo.data.name,
      email: userInfo.data.email,
      picture: userInfo.data.picture
    };

    // Save refresh token to .env for persistence
    if (tokens.refresh_token) {
      try {
        const envPath = path.join(__dirname, '..', '.env');
        let envContent = '';
        try {
          envContent = await fsPromises.readFile(envPath, 'utf-8');
        } catch (e) {
          envContent = '';
        }

        if (envContent.includes('GOOGLE_REFRESH_TOKEN=')) {
          envContent = envContent.replace(
            /GOOGLE_REFRESH_TOKEN=.*/,
            `GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`
          );
        } else {
          envContent += `\nGOOGLE_REFRESH_TOKEN=${tokens.refresh_token}\n`;
        }
        await fsPromises.writeFile(envPath, envContent);
        process.env.GOOGLE_REFRESH_TOKEN = tokens.refresh_token;
      } catch (e) {
        console.error('Failed to save refresh token:', e.message);
      }
    }

    res.redirect('/');
  } catch (err) {
    console.error('Auth callback error:', err);
    res.redirect('/?error=auth_failed');
  }
});

app.get('/auth/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

app.get('/auth/user', (req, res) => {
  if (req.session && req.session.user && req.session.tokens) {
    res.json({ loggedIn: true, user: req.session.user });
  } else {
    res.json({ loggedIn: false });
  }
});

// ═══════════════════════════════════════
// GOOGLE DRIVE ROUTES
// ═══════════════════════════════════════
function getDrive(req) {
  if (!req.session || !req.session.tokens) return null;

  // Refresh tokens if we have a refresh token
  const tokens = { ...req.session.tokens };
  if (!tokens.refresh_token && process.env.GOOGLE_REFRESH_TOKEN) {
    tokens.refresh_token = process.env.GOOGLE_REFRESH_TOKEN;
  }

  return getDriveClient(tokens);
}

app.get('/drive/list', async (req, res) => {
  try {
    const drive = getDrive(req);
    if (!drive) return res.status(401).json({ error: 'Not authenticated' });

    const folderId = req.query.folderId || 'root';
    const files = await listFiles(drive, folderId);
    res.json({ files });
  } catch (err) {
    console.error('Drive list error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/drive/thumb/:fileId', async (req, res) => {
  try {
    const drive = getDrive(req);
    if (!drive) return res.status(401).json({ error: 'Not authenticated' });

    res.set({
      'Cache-Control': 'public, max-age=3600',
      'Content-Type': 'image/jpeg'
    });

    const stream = await getFileThumbnail(drive, req.params.fileId);
    stream.pipe(res);
  } catch (err) {
    console.error('Thumb error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/drive/download', async (req, res) => {
  try {
    const drive = getDrive(req);
    if (!drive) return res.status(401).json({ error: 'Not authenticated' });

    const { fileId, fileName } = req.body;
    if (!fileId || !fileName) return res.status(400).json({ error: 'fileId and fileName required' });

    const localPath = path.join(uploadsDir, fileName);
    await downloadFile(drive, fileId, localPath);
    res.json({ success: true, localPath });
  } catch (err) {
    console.error('Drive download error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════
// DIRECT FILE UPLOAD
// ═══════════════════════════════════════
app.post('/upload', upload.array('files', 50), (req, res) => {
  const uploaded = (req.files || []).map(f => ({
    id: uuidv4().slice(0, 6),
    name: f.originalname,
    localPath: f.path,
    size: f.size,
    mimetype: f.mimetype,
    type: f.mimetype.startsWith('video/') ? 'video' : 'photo'
  }));
  res.json({ success: true, files: uploaded });
});

// ═══════════════════════════════════════
// PIPELINE
// ═══════════════════════════════════════
app.post('/pipeline/run', async (req, res) => {
  try {
    const {
      files: fileDescriptors,
      context,
      vibe,
      audience,
      brief,
      platform,
      beauty,
      videoOptions,
      socketId
    } = req.body;

    if (!fileDescriptors || fileDescriptors.length === 0) {
      return res.status(400).json({ error: 'No files selected' });
    }

    const socket = io.sockets.sockets.get(socketId);
    if (!socket) {
      return res.status(400).json({ error: 'Socket connection not found. Please refresh the page.' });
    }

    // Download files from Drive if needed
    const drive = getDrive(req);
    const files = [];

    for (const fd of fileDescriptors) {
      try {
        let localPath = fd.localPath;

        if (!localPath && fd.driveFileId) {
          // Download from Google Drive
          localPath = path.join(uploadsDir, fd.name);
          if (drive) {
            socket.emit('log', { message: `Downloading from Drive: ${fd.name}`, type: 'info' });
            await downloadFile(drive, fd.driveFileId, localPath);
          }
        }

        if (localPath) {
          files.push({
            id: fd.id || uuidv4().slice(0, 6),
            name: fd.name,
            localPath,
            size: fd.size || 0,
            type: fd.type || (fd.mimeType && fd.mimeType.startsWith('video/') ? 'video' : 'photo'),
            mimeType: fd.mimeType,
            driveFileId: fd.driveFileId,
            description: fd.description || '',
            videoOption: videoOptions ? videoOptions[fd.id] : null
          });
        }
      } catch (err) {
        socket.emit('log', { message: `Failed to download ${fd.name}: ${err.message}`, type: 'error' });
      }
    }

    if (files.length === 0) {
      return res.status(400).json({ error: 'Failed to download any files' });
    }

    res.json({ success: true, message: 'Pipeline started', fileCount: files.length });

    // Run pipeline async
    const driveForUpload = drive || null;
    runPipeline({
      files,
      context,
      vibe,
      audience,
      brief,
      platform,
      beauty,
      videoOptions
    }, socket, driveForUpload).catch(err => {
      socket.emit('pipeline:error', { error: err.message });
      socket.emit('log', { message: `Pipeline fatal error: ${err.message}`, type: 'error' });
    });

  } catch (err) {
    console.error('Pipeline start error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════
// DOWNLOAD ZIP
// ═══════════════════════════════════════
app.get('/download/zip', async (req, res) => {
  try {
    // Find the most recent run directory
    const runs = await fsPromises.readdir(outputDir);
    const runDirs = runs.filter(r => r.startsWith('run_')).sort().reverse();

    if (runDirs.length === 0) {
      return res.status(404).json({ error: 'No output files found' });
    }

    const latestRun = path.join(outputDir, runDirs[0]);

    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="reel-director-${runDirs[0]}.zip"`
    });

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', err => { throw err; });
    archive.pipe(res);
    archive.directory(latestRun, false);
    archive.finalize();
  } catch (err) {
    console.error('ZIP error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════
// SOCKET.IO
// ═══════════════════════════════════════
io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);
  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
  });
});

// ═══════════════════════════════════════
// START SERVER
// ═══════════════════════════════════════
server.listen(PORT, () => {
  console.log(`\n  ╔═══════════════════════════════════════╗`);
  console.log(`  ║     REEL DIRECTOR - AI Studio         ║`);
  console.log(`  ║     http://localhost:${PORT}              ║`);
  console.log(`  ╚═══════════════════════════════════════╝\n`);
  console.log(`  FFmpeg: ${!!require('ffmpeg-static')}`);
  console.log(`  Sharp: ${!!require('sharp')}`);
  console.log(`  Anthropic API: ${!!process.env.ANTHROPIC_API_KEY}`);
  console.log(`  Google OAuth: ${!!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)}`);
  console.log(`  Picsart: ${!!process.env.PICSART_API_KEY}`);
  console.log('');
});
