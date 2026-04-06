# REEL DIRECTOR — AI Multi-Agent Content Studio

REEL DIRECTOR is a local Node.js application that transforms your photos and videos into professional Instagram Reels and TikTok posts using a 6-agent Claude AI pipeline. Connect your Google Drive, select your media, configure your creative vision, and let the AI agents handle compression, beauty processing, scene analysis, narrative creation, edit planning, and caption writing — all streamed live to your browser.

## Prerequisites

- **Node.js 18+** — [Download](https://nodejs.org/)
- **FFmpeg** — Bundled via `ffmpeg-static` (no manual install needed)
- **Anthropic API Key** — [Get one](https://console.anthropic.com/)
- **Google Cloud Project** — For Google Drive integration (optional)

## Installation

```bash
# Clone the repository
git clone https://github.com/sp844/personal-social-media.git
cd personal-social-media/reel-director

# Install dependencies
npm install

# Create your environment file
cp .env.example .env
# Edit .env with your API keys
```

## Environment Variables

Edit `.env` with your values:

```
ANTHROPIC_API_KEY=sk-ant-...          # Required — Claude API key
GOOGLE_CLIENT_ID=xxx.apps...          # Optional — Google OAuth
GOOGLE_CLIENT_SECRET=GOCSPX-...       # Optional — Google OAuth
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/google/callback
GOOGLE_REFRESH_TOKEN=                  # Auto-filled after first login
PICSART_API_KEY=                       # Optional — Better beauty processing
PORT=3000
SESSION_SECRET=any-random-32-char-string
```

## Google Cloud Console Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or select existing)
3. Enable these APIs:
   - Google Drive API
   - Google People API (or Google+ API)
4. Go to **Credentials** → **Create Credentials** → **OAuth 2.0 Client ID**
5. Application type: **Web application**
6. Add authorized redirect URI: `http://localhost:3000/auth/google/callback`
7. Copy **Client ID** and **Client Secret** to your `.env` file
8. Go to **OAuth consent screen** → Add your email as a test user

## Running Locally

```bash
node server/index.js
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Deploying to Railway

1. Push your code to GitHub
2. Go to [Railway](https://railway.app/) and create a new project
3. Connect your GitHub repository
4. Set environment variables in Railway dashboard:
   - `ANTHROPIC_API_KEY`
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `GOOGLE_REDIRECT_URI=https://your-app.railway.app/auth/google/callback`
   - `SESSION_SECRET`
   - `NODE_ENV=production`
5. Railway will auto-detect `railway.json` and deploy
6. Update your Google Cloud Console redirect URI to match your Railway URL

## Using from Android

1. Deploy to Railway (or run locally with a tunnel like ngrok)
2. Open the URL in Chrome browser on your Android device
3. The UI is fully mobile-responsive
4. Sign in with Google, browse your Drive, and run the pipeline

## The 6-Agent Pipeline

| # | Agent | What It Does |
|---|-------|-------------|
| 0 | **Compressor** | Resizes and compresses photos with Sharp. Extracts video frames or copies clips based on your choice. |
| 1 | **Beauty Processor** | Applies skin smoothing, face slimming, brightness lift, and warmth boost to portrait photos. Optional Picsart API for enhanced results. |
| 2 | **Vision Scout** | Analyzes every photo and video frame with Claude Vision. Scores quality, detects faces, categorizes content, recommends usage. |
| 3 | **Story Director** | Creates 3 completely different narrative concepts: Fast-Cut Energy, Cinematic Story, and a Creative Wildcard. Each selects different hero media. |
| 4 | **Edit Supervisor** | Generates step-by-step edit instructions for each concept. Executes FFmpeg trims for video clips. Outputs CapCut/DaVinci Resolve workflows. |
| 5 | **Platform Spec** | Applies exact Instagram Reels or TikTok specifications. Generates FFmpeg export commands, posting time recommendations, and sound suggestions. |
| 6 | **Copy Writer** | Writes scroll-stopping hooks, conversational captions, CTAs, 15 hashtags (large/medium/niche mix), and accessibility alt text for each concept. |

All agents stream progress in real-time via Socket.io. If one agent fails, the pipeline continues with graceful fallbacks.

## Troubleshooting

### "Anthropic API key not set"
Make sure `ANTHROPIC_API_KEY` is set in your `.env` file and the file is in the `reel-director/` root directory.

### "Socket connection not found"
Refresh the page to re-establish the WebSocket connection before running the pipeline.

### "Google auth failed"
- Verify your Client ID and Client Secret are correct
- Make sure the redirect URI in `.env` exactly matches what's in Google Cloud Console
- Add your email as a test user in the OAuth consent screen

### "FFmpeg errors"
FFmpeg is bundled via `ffmpeg-static`. If you see path errors, try `npm rebuild ffmpeg-static`.

### "Sharp installation issues"
Sharp requires native binaries. Run `npm rebuild sharp` or delete `node_modules` and run `npm install` again.

### "413 Payload Too Large"
The pipeline automatically splits large image batches. If you still see this error, try selecting fewer files.

### "Rate limit (429) errors"
The pipeline automatically retries with backoff. If persistent, reduce the number of files or wait a minute.

---

Built with Claude AI by Anthropic
