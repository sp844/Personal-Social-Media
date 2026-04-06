// ═══════════════════════════════════════════════════════════════════════════════
// REEL DIRECTOR — Frontend Client
// ═══════════════════════════════════════════════════════════════════════════════

// ═══ GLOBALS ═══
const socket = io();
let selectedFiles = new Map();
let uploadedFiles = [];
let videoOptions = {};
let currentPlatform = 'instagram';
let currentVibe = 'Cinematic';
let folderStack = [{ id: 'root', name: 'Home' }];
let allDriveFiles = [];
let currentFilter = 'all';
let pipelineRunning = false;

// ═══ UTILITY ═══
function formatBytes(bytes, decimals = 1) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
}

function toggleSection(panelId) {
  const panel = document.getElementById(panelId);
  const icon = document.getElementById(panelId + '-icon');
  if (!panel) return;
  const isHidden = panel.style.display === 'none';
  panel.style.display = isHidden ? 'block' : 'none';
  if (icon) icon.textContent = isHidden ? '▲' : '▼';
}

function isVideo(mimeType) {
  return mimeType && mimeType.startsWith('video/');
}

function isPhoto(mimeType) {
  return mimeType && mimeType.startsWith('image/');
}

// ═══ INIT ═══
document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  checkAuth();
  setupEventListeners();
  setupSocketListeners();
});

// ═══ SETTINGS PERSISTENCE ═══
function loadSettings() {
  const saved = localStorage.getItem('reelDirectorSettings');
  if (!saved) return;
  try {
    const s = JSON.parse(saved);
    if (s.platform) {
      currentPlatform = s.platform;
      document.querySelectorAll('.platform-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.platform === currentPlatform);
      });
    }
    if (s.vibe) {
      currentVibe = s.vibe;
      document.querySelectorAll('.vibe-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.vibe === currentVibe);
      });
    }
    if (s.beauty) {
      const b = s.beauty;
      if (b.smooth !== undefined) document.getElementById('beauty-smooth').checked = b.smooth;
      if (b.slim !== undefined) document.getElementById('beauty-slim').checked = b.slim;
      if (b.bright !== undefined) document.getElementById('beauty-bright').checked = b.bright;
      if (b.warmth !== undefined) document.getElementById('beauty-warmth').checked = b.warmth;
      if (b.picsart !== undefined) document.getElementById('beauty-picsart').checked = b.picsart;
      if (b.smoothStrength) {
        document.querySelectorAll('#smooth-strength .strength-btn').forEach(btn => {
          btn.classList.toggle('active', btn.dataset.val === b.smoothStrength);
        });
      }
      if (b.slimStrength) {
        document.querySelectorAll('#slim-strength .strength-btn').forEach(btn => {
          btn.classList.toggle('active', btn.dataset.val === b.slimStrength);
        });
      }
    }
  } catch (e) {
    console.warn('Failed to load settings', e);
  }
}

function saveSettings() {
  const settings = {
    platform: currentPlatform,
    vibe: currentVibe,
    beauty: getBeautySettings()
  };
  localStorage.setItem('reelDirectorSettings', JSON.stringify(settings));
}

function getBeautySettings() {
  const smoothStrengthBtn = document.querySelector('#smooth-strength .strength-btn.active');
  const slimStrengthBtn = document.querySelector('#slim-strength .strength-btn.active');
  return {
    smooth: document.getElementById('beauty-smooth').checked,
    smoothStrength: smoothStrengthBtn ? smoothStrengthBtn.dataset.val : 'medium',
    slim: document.getElementById('beauty-slim').checked,
    slimStrength: slimStrengthBtn ? slimStrengthBtn.dataset.val : 'subtle',
    bright: document.getElementById('beauty-bright').checked,
    warmth: document.getElementById('beauty-warmth').checked,
    picsart: document.getElementById('beauty-picsart').checked
  };
}

// ═══ AUTH ═══
function checkAuth() {
  fetch('/auth/user', { credentials: 'same-origin' })
    .then(res => {
      if (!res.ok) throw new Error('Not authenticated');
      return res.json();
    })
    .then(user => {
      document.getElementById('login-btn').style.display = 'none';
      const info = document.getElementById('user-info');
      info.style.display = 'flex';
      document.getElementById('user-avatar').src = user.photo || user.picture || '';
      document.getElementById('user-name').textContent = user.displayName || user.name || 'User';
      document.getElementById('drive-section').style.display = 'block';
      loadDriveFolder('root');
    })
    .catch(() => {
      document.getElementById('login-btn').style.display = 'flex';
      document.getElementById('user-info').style.display = 'none';
      document.getElementById('drive-section').style.display = 'none';
    });
}

// ═══ EVENT LISTENERS ═══
function setupEventListeners() {
  // Platform toggle
  document.querySelectorAll('.platform-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.platform-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentPlatform = btn.dataset.platform;
      saveSettings();
      updateGenerateMeta();
    });
  });

  // Vibe selector
  document.querySelectorAll('.vibe-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.vibe-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentVibe = btn.dataset.vibe;
      saveSettings();
    });
  });

  // Quick chips
  document.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const textarea = document.getElementById('brief-input');
      const text = chip.dataset.text;
      if (textarea.value) {
        textarea.value += '\n' + text;
      } else {
        textarea.value = text;
      }
    });
  });

  // Filter tabs
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      renderDriveGrid(allDriveFiles);
    });
  });

  // Upload zone
  const uploadZone = document.getElementById('upload-zone');
  const fileInput = document.getElementById('file-input');

  uploadZone.addEventListener('click', () => fileInput.click());

  uploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    uploadZone.classList.add('drag-over');
  });

  uploadZone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    uploadZone.classList.remove('drag-over');
  });

  uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    uploadZone.classList.remove('drag-over');
    const files = e.dataTransfer.files;
    if (files.length) handleFileUpload(files);
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length) handleFileUpload(e.target.files);
    e.target.value = '';
  });

  // Selection bar buttons
  document.getElementById('select-all-btn').addEventListener('click', selectAllFiles);
  document.getElementById('deselect-all-btn').addEventListener('click', deselectAllFiles);

  // Generate button
  document.getElementById('generate-btn').addEventListener('click', runPipeline);

  // Strength buttons
  document.querySelectorAll('.strength-btns').forEach(group => {
    group.querySelectorAll('.strength-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        group.querySelectorAll('.strength-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        saveSettings();
      });
    });
  });

  // Beauty toggle save
  ['beauty-smooth', 'beauty-slim', 'beauty-bright', 'beauty-warmth', 'beauty-picsart'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', saveSettings);
  });
}

// ═══ DRIVE BROWSER ═══
function loadDriveFolder(folderId) {
  const grid = document.getElementById('drive-grid');
  grid.innerHTML = '<div class="loading-spinner">Loading...</div>';

  fetch(`/drive/list?folderId=${encodeURIComponent(folderId)}`, { credentials: 'same-origin' })
    .then(res => res.json())
    .then(data => {
      allDriveFiles = data.files || data || [];
      renderDriveGrid(allDriveFiles);
    })
    .catch(err => {
      grid.innerHTML = '<div class="error-msg">Failed to load Drive files</div>';
      console.error('Drive load error:', err);
    });
}

function renderDriveGrid(files) {
  const grid = document.getElementById('drive-grid');
  grid.innerHTML = '';

  let filtered = files;
  if (currentFilter === 'photos') {
    filtered = files.filter(f => isPhoto(f.mimeType) || f.mimeType === 'application/vnd.google-apps.folder');
  } else if (currentFilter === 'videos') {
    filtered = files.filter(f => isVideo(f.mimeType) || f.mimeType === 'application/vnd.google-apps.folder');
  }

  // Folders first
  const folders = filtered.filter(f => f.mimeType === 'application/vnd.google-apps.folder');
  const mediaFiles = filtered.filter(f => f.mimeType !== 'application/vnd.google-apps.folder');

  const countEl = document.getElementById('file-count');
  countEl.textContent = `${mediaFiles.length} items`;

  folders.forEach(folder => {
    const card = document.createElement('div');
    card.className = 'drive-card drive-folder';
    card.innerHTML = `
      <div class="drive-thumb folder-icon">📁</div>
      <div class="drive-name">${escapeHtml(folder.name)}</div>
    `;
    card.addEventListener('click', () => {
      folderStack.push({ id: folder.id, name: folder.name });
      renderBreadcrumb();
      loadDriveFolder(folder.id);
    });
    grid.appendChild(card);
  });

  mediaFiles.forEach(file => {
    const card = document.createElement('div');
    const isSelected = selectedFiles.has(file.id);
    card.className = 'drive-card' + (isSelected ? ' selected' : '');
    card.dataset.fileId = file.id;

    const thumbSrc = `/drive/thumb/${file.id}`;
    const sizeStr = file.size ? formatBytes(parseInt(file.size)) : '';
    const typeIcon = isVideo(file.mimeType) ? '🎬' : '';

    card.innerHTML = `
      <div class="drive-thumb">
        <img src="${thumbSrc}" alt="${escapeHtml(file.name)}" loading="lazy" onerror="this.parentElement.innerHTML='📄'">
        ${isSelected ? '<div class="check-overlay">✓</div>' : ''}
        ${typeIcon ? '<span class="type-badge">' + typeIcon + '</span>' : ''}
      </div>
      <div class="drive-name" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</div>
      ${sizeStr ? '<div class="drive-size">' + sizeStr + '</div>' : ''}
    `;

    card.addEventListener('click', () => toggleFileSelection(file, card));
    grid.appendChild(card);
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function renderBreadcrumb() {
  const bc = document.getElementById('breadcrumb');
  bc.innerHTML = '';
  folderStack.forEach((folder, i) => {
    const btn = document.createElement('button');
    btn.className = 'breadcrumb-item' + (i === folderStack.length - 1 ? ' active' : '');
    btn.textContent = folder.name;
    btn.dataset.folder = folder.id;
    btn.addEventListener('click', () => {
      folderStack = folderStack.slice(0, i + 1);
      renderBreadcrumb();
      loadDriveFolder(folder.id);
    });
    bc.appendChild(btn);
    if (i < folderStack.length - 1) {
      const sep = document.createElement('span');
      sep.className = 'breadcrumb-sep';
      sep.textContent = ' / ';
      bc.appendChild(sep);
    }
  });
}

function toggleFileSelection(file, cardEl) {
  if (selectedFiles.has(file.id)) {
    selectedFiles.delete(file.id);
    cardEl.classList.remove('selected');
    const overlay = cardEl.querySelector('.check-overlay');
    if (overlay) overlay.remove();
  } else {
    selectedFiles.set(file.id, file);
    cardEl.classList.add('selected');
    const thumb = cardEl.querySelector('.drive-thumb');
    if (thumb && !thumb.querySelector('.check-overlay')) {
      const check = document.createElement('div');
      check.className = 'check-overlay';
      check.textContent = '✓';
      thumb.appendChild(check);
    }
  }
  updateSelectionBar();
  updateVideoOptions();
  updateGenerateMeta();
}

function selectAllFiles() {
  const mediaFiles = allDriveFiles.filter(f => f.mimeType !== 'application/vnd.google-apps.folder');
  let filtered = mediaFiles;
  if (currentFilter === 'photos') filtered = mediaFiles.filter(f => isPhoto(f.mimeType));
  if (currentFilter === 'videos') filtered = mediaFiles.filter(f => isVideo(f.mimeType));

  filtered.forEach(f => selectedFiles.set(f.id, f));
  renderDriveGrid(allDriveFiles);
  updateSelectionBar();
  updateVideoOptions();
  updateGenerateMeta();
}

function deselectAllFiles() {
  selectedFiles.clear();
  renderDriveGrid(allDriveFiles);
  updateSelectionBar();
  updateVideoOptions();
  updateGenerateMeta();
}

function updateSelectionBar() {
  const bar = document.getElementById('selection-bar');
  const count = selectedFiles.size + uploadedFiles.length;
  if (count > 0) {
    bar.style.display = 'flex';
    document.getElementById('selection-count').textContent = `${count} file${count !== 1 ? 's' : ''} selected`;
  } else {
    bar.style.display = 'none';
  }
}

// ═══ VIDEO OPTIONS ═══
function updateVideoOptions() {
  const section = document.getElementById('video-options-section');
  const list = document.getElementById('video-options-list');

  const videos = [];
  selectedFiles.forEach((file) => {
    if (isVideo(file.mimeType)) videos.push(file);
  });
  uploadedFiles.forEach(file => {
    if (isVideo(file.mimeType || file.type)) videos.push(file);
  });

  if (videos.length === 0) {
    section.style.display = 'none';
    return;
  }

  section.style.display = 'block';
  list.innerHTML = '';

  videos.forEach(video => {
    const id = video.id || video.name;
    if (!videoOptions[id]) {
      videoOptions[id] = { mode: 'clip', description: '' };
    }
    const opts = videoOptions[id];

    const card = document.createElement('div');
    card.className = 'video-option-card';
    card.innerHTML = `
      <div class="video-option-header">
        <span class="video-option-name">🎬 ${escapeHtml(video.name)}</span>
      </div>
      <div class="video-option-modes">
        <button class="mode-btn ${opts.mode === 'clip' ? 'active' : ''}" data-mode="clip" data-id="${id}">Clip</button>
        <button class="mode-btn ${opts.mode === 'frames' ? 'active' : ''}" data-mode="frames" data-id="${id}">Extract Frames</button>
        <button class="mode-btn ${opts.mode === 'both' ? 'active' : ''}" data-mode="both" data-id="${id}">Both</button>
      </div>
      <textarea class="video-desc input" placeholder="Describe this video (optional)..." data-id="${id}">${escapeHtml(opts.description)}</textarea>
    `;

    card.querySelectorAll('.mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        card.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        videoOptions[btn.dataset.id].mode = btn.dataset.mode;
      });
    });

    const textarea = card.querySelector('.video-desc');
    textarea.addEventListener('input', () => {
      videoOptions[textarea.dataset.id].description = textarea.value;
    });

    list.appendChild(card);
  });
}

// ═══ DIRECT UPLOAD ═══
function handleFileUpload(fileList) {
  const container = document.getElementById('uploaded-files');

  Array.from(fileList).forEach(file => {
    const formData = new FormData();
    formData.append('file', file);

    const pill = document.createElement('div');
    pill.className = 'uploaded-pill uploading';
    pill.innerHTML = `
      <span class="uploaded-name">${escapeHtml(file.name)}</span>
      <span class="uploaded-size">${formatBytes(file.size)}</span>
      <span class="uploaded-status">Uploading...</span>
    `;
    container.appendChild(pill);

    fetch('/upload', {
      method: 'POST',
      body: formData,
      credentials: 'same-origin'
    })
      .then(res => res.json())
      .then(data => {
        pill.classList.remove('uploading');
        pill.classList.add('uploaded');
        pill.querySelector('.uploaded-status').textContent = '✓';
        const uploaded = {
          id: data.id || data.filename || file.name,
          name: file.name,
          mimeType: file.type,
          size: file.size,
          source: 'upload',
          path: data.path || data.filename
        };
        uploadedFiles.push(uploaded);
        updateSelectionBar();
        updateVideoOptions();
        updateGenerateMeta();
      })
      .catch(err => {
        pill.classList.remove('uploading');
        pill.classList.add('upload-error');
        pill.querySelector('.uploaded-status').textContent = 'Failed';
        console.error('Upload error:', err);
      });
  });
}

// ═══ GENERATE META & PIPELINE ═══
function updateGenerateMeta() {
  const btn = document.getElementById('generate-btn');
  const meta = document.getElementById('generate-meta');
  const totalFiles = selectedFiles.size + uploadedFiles.length;

  let photoCount = 0;
  let videoCount = 0;

  selectedFiles.forEach(f => {
    if (isVideo(f.mimeType)) videoCount++;
    else photoCount++;
  });
  uploadedFiles.forEach(f => {
    if (isVideo(f.mimeType || f.type)) videoCount++;
    else photoCount++;
  });

  if (totalFiles === 0) {
    meta.textContent = 'Select files to begin';
    btn.disabled = true;
    return;
  }

  const parts = [];
  if (photoCount > 0) parts.push(`${photoCount} photo${photoCount !== 1 ? 's' : ''}`);
  if (videoCount > 0) parts.push(`${videoCount} video${videoCount !== 1 ? 's' : ''}`);
  meta.textContent = `${parts.join(' + ')} selected \u00B7 Platform: ${currentPlatform.charAt(0).toUpperCase() + currentPlatform.slice(1)}`;

  btn.disabled = pipelineRunning;
}

function runPipeline() {
  if (pipelineRunning) return;
  pipelineRunning = true;

  const btn = document.getElementById('generate-btn');
  btn.disabled = true;
  btn.querySelector('.generate-text').textContent = 'PIPELINE RUNNING...';

  // Show pipeline section, reset agents
  document.getElementById('pipeline-section').style.display = 'block';
  document.getElementById('results-section').style.display = 'none';
  document.getElementById('compression-section').style.display = 'none';
  document.getElementById('download-section').style.display = 'none';
  document.getElementById('live-log').innerHTML = '';

  document.querySelectorAll('.agent-node').forEach(node => {
    node.classList.remove('active', 'done', 'error');
    node.querySelector('.agent-status').textContent = 'queued';
  });

  // Scroll to pipeline
  document.getElementById('pipeline-section').scrollIntoView({ behavior: 'smooth' });

  // Build drive files array
  const driveFiles = [];
  selectedFiles.forEach(f => {
    driveFiles.push({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      size: f.size
    });
  });

  const payload = {
    driveFiles: driveFiles,
    uploadedFiles: uploadedFiles.map(f => ({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      size: f.size,
      path: f.path
    })),
    videoOptions: videoOptions,
    platform: currentPlatform,
    vibe: currentVibe,
    context: document.getElementById('context-input').value.trim(),
    audience: document.getElementById('audience-input').value.trim(),
    brief: document.getElementById('brief-input').value.trim(),
    beauty: getBeautySettings(),
    socketId: socket.id
  };

  fetch('/pipeline/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    credentials: 'same-origin'
  })
    .then(res => {
      if (!res.ok) throw new Error('Pipeline request failed');
      return res.json();
    })
    .then(data => {
      console.log('Pipeline started:', data);
    })
    .catch(err => {
      console.error('Pipeline error:', err);
      pipelineRunning = false;
      btn.disabled = false;
      btn.querySelector('.generate-text').textContent = 'RUN 6-AGENT PIPELINE';
      appendLog('Pipeline request failed: ' + err.message, 'error');
    });
}

// ═══ SOCKET LISTENERS ═══
function setupSocketListeners() {
  socket.on('agent:update', (data) => {
    const node = document.querySelector(`.agent-node[data-index="${data.index}"]`);
    if (!node) return;

    node.classList.remove('active', 'done', 'error', 'queued');
    node.classList.add(data.status);

    const statusEl = node.querySelector('.agent-status');
    statusEl.textContent = data.statusText || data.status;

    // If agent 0 completed with compression data, render report
    if (data.index === 0 && data.status === 'done' && data.compressionReport) {
      renderCompressionReport(data.compressionReport);
    }
  });

  socket.on('log', (data) => {
    const color = data.color || 'white';
    const msg = data.message || data.msg || data;
    appendLog(msg, color);
  });

  socket.on('pipeline:complete', (data) => {
    pipelineRunning = false;
    const btn = document.getElementById('generate-btn');
    btn.disabled = false;
    btn.querySelector('.generate-text').textContent = 'RUN 6-AGENT PIPELINE';
    renderResults(data);
  });

  socket.on('pipeline:error', (data) => {
    pipelineRunning = false;
    const btn = document.getElementById('generate-btn');
    btn.disabled = false;
    btn.querySelector('.generate-text').textContent = 'RUN 6-AGENT PIPELINE';

    const msg = data.message || data.error || 'An error occurred';
    appendLog('ERROR: ' + msg, 'error');

    const logEl = document.getElementById('live-log');
    const banner = document.createElement('div');
    banner.className = 'error-banner';
    banner.textContent = 'Pipeline failed: ' + msg;
    logEl.parentElement.insertBefore(banner, logEl);
  });
}

function appendLog(message, color) {
  const logEl = document.getElementById('live-log');
  const line = document.createElement('div');
  line.className = 'log-line';
  if (color === 'error') {
    line.style.color = '#ff4444';
  } else if (color === 'success' || color === 'green') {
    line.style.color = '#00ff88';
  } else if (color === 'warn' || color === 'yellow') {
    line.style.color = '#ffd700';
  } else if (color === 'info' || color === 'cyan') {
    line.style.color = '#00d4ff';
  } else if (color && color.startsWith('#')) {
    line.style.color = color;
  }

  const now = new Date();
  const ts = now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  line.innerHTML = `<span class="log-time">[${ts}]</span> ${escapeHtml(String(message))}`;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
}

// ═══ COMPRESSION REPORT ═══
function renderCompressionReport(report) {
  const section = document.getElementById('compression-section');
  section.style.display = 'block';

  const pills = document.getElementById('report-pills');
  const tbody = document.getElementById('report-tbody');
  const progressBar = document.getElementById('compression-progress');

  pills.innerHTML = '';
  tbody.innerHTML = '';

  const totalOriginal = report.files ? report.files.reduce((sum, f) => sum + (f.originalSize || 0), 0) : 0;
  const totalCompressed = report.files ? report.files.reduce((sum, f) => sum + (f.compressedSize || 0), 0) : 0;
  const totalSaved = totalOriginal - totalCompressed;
  const pct = totalOriginal > 0 ? Math.round((totalSaved / totalOriginal) * 100) : 0;

  const pillData = [
    { label: 'Files', value: report.files ? report.files.length : 0 },
    { label: 'Original', value: formatBytes(totalOriginal) },
    { label: 'Compressed', value: formatBytes(totalCompressed) },
    { label: 'Saved', value: `${formatBytes(totalSaved)} (${pct}%)` }
  ];

  pillData.forEach(p => {
    const pill = document.createElement('div');
    pill.className = 'report-pill';
    pill.innerHTML = `<span class="pill-value">${p.value}</span><span class="pill-label">${p.label}</span>`;
    pills.appendChild(pill);
  });

  progressBar.style.width = pct + '%';

  if (report.files) {
    report.files.forEach(f => {
      const saved = (f.originalSize || 0) - (f.compressedSize || 0);
      const filePct = f.originalSize > 0 ? Math.round((saved / f.originalSize) * 100) : 0;
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${escapeHtml(f.name || f.filename || 'file')}</td>
        <td>${formatBytes(f.originalSize)}</td>
        <td>${formatBytes(f.compressedSize)}</td>
        <td class="saved-cell">${formatBytes(saved)} (${filePct}%)</td>
      `;
      tbody.appendChild(row);
    });
  }
}

// ═══ RESULTS RENDERING ═══
function renderResults(data) {
  const section = document.getElementById('results-section');
  section.style.display = 'block';

  const downloadSection = document.getElementById('download-section');
  downloadSection.style.display = 'block';

  if (data.driveLink) {
    const driveBtn = document.getElementById('drive-link-btn');
    driveBtn.href = data.driveLink;
    driveBtn.style.display = 'inline-flex';
  }

  section.scrollIntoView({ behavior: 'smooth' });

  const concepts = data.concepts || data.results || [];
  if (concepts.length === 0) {
    document.getElementById('concept-content').innerHTML = '<p class="muted">No concepts generated.</p>';
    return;
  }

  renderConceptTabs(concepts);
  renderConceptDetail(concepts[0], 0);
}

function renderConceptTabs(concepts) {
  const tabsEl = document.getElementById('concept-tabs');
  tabsEl.innerHTML = '';

  concepts.forEach((concept, i) => {
    const tab = document.createElement('button');
    tab.className = 'concept-tab' + (i === 0 ? ' active' : '');
    tab.textContent = concept.name || concept.conceptName || `Concept ${i + 1}`;
    tab.addEventListener('click', () => {
      tabsEl.querySelectorAll('.concept-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      renderConceptDetail(concept, i);
    });
    tabsEl.appendChild(tab);
  });
}

function renderConceptDetail(concept, index) {
  const el = document.getElementById('concept-content');

  const name = concept.name || concept.conceptName || `Concept ${index + 1}`;
  const format = concept.format || concept.videoFormat || 'N/A';
  const pacing = concept.pacing || 'N/A';
  const narrative = concept.narrative || concept.narrativeArc || 'N/A';
  const hookStrategy = concept.hookStrategy || concept.hook || 'N/A';
  const uniqueAngle = concept.uniqueAngle || concept.angle || 'N/A';
  const musicVibe = concept.musicVibe || concept.music || concept.soundtrack || 'N/A';
  const selectedMedia = concept.selectedMedia || concept.mediaSelection || [];
  const platformSpecs = concept.platformSpecs || concept.specs || {};
  const optimalLength = concept.optimalLength || concept.duration || platformSpecs.duration || 'N/A';
  const postingTime = concept.postingTime || concept.bestTime || platformSpecs.bestPostingTime || 'N/A';
  const soundSuggestion = concept.soundSuggestion || concept.sound || platformSpecs.sound || 'N/A';
  const sequenceFlow = concept.sequenceFlow || concept.flow || concept.sequence || 'N/A';
  const shots = concept.shots || concept.shotList || concept.shotByShot || [];
  const editInstructions = concept.editInstructions || concept.editingInstructions || concept.edits || '';
  const caption = concept.caption || concept.captionPackage || {};
  const hashtags = concept.hashtags || caption.hashtags || [];

  const captionText = typeof caption === 'string' ? caption : (caption.main || caption.text || caption.primary || '');
  const captionAlt = caption.alt || caption.alternative || caption.hook || '';
  const captionCTA = caption.cta || caption.callToAction || '';

  el.innerHTML = `
    <div class="concept-detail">
      <div class="concept-columns">
        <!-- LEFT COLUMN -->
        <div class="concept-left">
          <div class="detail-card">
            <h3 class="detail-title">${escapeHtml(name)}</h3>
            <div class="detail-grid">
              <div class="detail-item"><span class="detail-label">Format</span><span class="detail-value">${escapeHtml(format)}</span></div>
              <div class="detail-item"><span class="detail-label">Pacing</span><span class="detail-value">${escapeHtml(pacing)}</span></div>
              <div class="detail-item"><span class="detail-label">Narrative</span><span class="detail-value">${escapeHtml(narrative)}</span></div>
              <div class="detail-item"><span class="detail-label">Hook Strategy</span><span class="detail-value">${escapeHtml(hookStrategy)}</span></div>
              <div class="detail-item"><span class="detail-label">Unique Angle</span><span class="detail-value">${escapeHtml(uniqueAngle)}</span></div>
              <div class="detail-item"><span class="detail-label">Music Vibe</span><span class="detail-value">${escapeHtml(musicVibe)}</span></div>
            </div>
            ${selectedMedia.length > 0 ? `
              <div class="media-chips">
                <span class="detail-label">Selected Media</span>
                <div class="chip-row">
                  ${selectedMedia.map(m => `<span class="media-chip">${escapeHtml(typeof m === 'string' ? m : (m.name || m.filename || ''))}</span>`).join('')}
                </div>
              </div>
            ` : ''}
          </div>
        </div>

        <!-- RIGHT COLUMN -->
        <div class="concept-right">
          <div class="detail-card">
            <h4>Platform Specs</h4>
            <div class="specs-grid">
              ${Object.entries(platformSpecs).map(([key, val]) => `
                <div class="spec-item">
                  <span class="spec-label">${escapeHtml(key)}</span>
                  <span class="spec-value">${escapeHtml(String(val))}</span>
                </div>
              `).join('')}
            </div>
            <div class="detail-grid" style="margin-top:1rem;">
              <div class="detail-item"><span class="detail-label">Optimal Length</span><span class="detail-value">${escapeHtml(String(optimalLength))}</span></div>
              <div class="detail-item"><span class="detail-label">Posting Time</span><span class="detail-value">${escapeHtml(String(postingTime))}</span></div>
              <div class="detail-item"><span class="detail-label">Sound</span><span class="detail-value">${escapeHtml(String(soundSuggestion))}</span></div>
            </div>
            <div class="detail-item" style="margin-top:1rem;">
              <span class="detail-label">Sequence Flow</span>
              <span class="detail-value">${escapeHtml(String(sequenceFlow))}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- FULL WIDTH: SHOT TABLE -->
      ${shots.length > 0 ? `
        <div class="detail-card full-width">
          <h4>Shot-by-Shot Breakdown</h4>
          <div class="shot-table-wrap">
            <table class="shot-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>File</th>
                  <th>Duration</th>
                  <th>Description</th>
                  <th>Transition</th>
                  <th>Text Overlay</th>
                </tr>
              </thead>
              <tbody>
                ${shots.map((shot, si) => `
                  <tr>
                    <td>${si + 1}</td>
                    <td>${escapeHtml(shot.file || shot.filename || shot.media || '')}</td>
                    <td>${escapeHtml(shot.duration || shot.time || '')}</td>
                    <td>${escapeHtml(shot.description || shot.desc || shot.action || '')}</td>
                    <td>${escapeHtml(shot.transition || '')}</td>
                    <td>${escapeHtml(shot.textOverlay || shot.text || shot.overlay || '')}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      ` : ''}

      <!-- FULL WIDTH: EDIT INSTRUCTIONS -->
      ${editInstructions ? `
        <div class="detail-card full-width">
          <div class="detail-header-row">
            <h4>Edit Instructions</h4>
            <button class="btn btn-sm btn-copy" onclick="copyToClipboard(this, ${escapeAttr(JSON.stringify(typeof editInstructions === 'string' ? editInstructions : JSON.stringify(editInstructions, null, 2)))})">Copy</button>
          </div>
          <pre class="edit-instructions">${escapeHtml(typeof editInstructions === 'string' ? editInstructions : JSON.stringify(editInstructions, null, 2))}</pre>
        </div>
      ` : ''}

      <!-- FULL WIDTH: CAPTION PACKAGE -->
      <div class="detail-card full-width">
        <h4>Caption Package</h4>
        ${captionText ? `
          <div class="caption-block">
            <div class="caption-header">
              <span class="caption-label">Main Caption</span>
              <button class="btn btn-sm btn-copy" onclick="copyToClipboard(this, ${escapeAttr(JSON.stringify(captionText))})">Copy</button>
            </div>
            <p class="caption-text">${escapeHtml(captionText)}</p>
          </div>
        ` : ''}
        ${captionAlt ? `
          <div class="caption-block">
            <div class="caption-header">
              <span class="caption-label">Alternative Caption</span>
              <button class="btn btn-sm btn-copy" onclick="copyToClipboard(this, ${escapeAttr(JSON.stringify(captionAlt))})">Copy</button>
            </div>
            <p class="caption-text">${escapeHtml(captionAlt)}</p>
          </div>
        ` : ''}
        ${captionCTA ? `
          <div class="caption-block">
            <div class="caption-header">
              <span class="caption-label">Call to Action</span>
              <button class="btn btn-sm btn-copy" onclick="copyToClipboard(this, ${escapeAttr(JSON.stringify(captionCTA))})">Copy</button>
            </div>
            <p class="caption-text">${escapeHtml(captionCTA)}</p>
          </div>
        ` : ''}
        ${hashtags.length > 0 ? `
          <div class="hashtag-cloud">
            <span class="caption-label">Hashtags</span>
            <button class="btn btn-sm btn-copy" onclick="copyToClipboard(this, ${escapeAttr(JSON.stringify(hashtags.join(' ')))})">Copy All</button>
            <div class="hashtag-tags">
              ${hashtags.map(h => `<span class="hashtag-tag">${escapeHtml(h.startsWith('#') ? h : '#' + h)}</span>`).join('')}
            </div>
          </div>
        ` : ''}
      </div>
    </div>
  `;
}

function escapeAttr(str) {
  return str.replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ═══ COPY TO CLIPBOARD ═══
function copyToClipboard(btnEl, text) {
  navigator.clipboard.writeText(text).then(() => {
    const original = btnEl.textContent;
    btnEl.textContent = 'Copied!';
    btnEl.classList.add('copied');
    setTimeout(() => {
      btnEl.textContent = original;
      btnEl.classList.remove('copied');
    }, 1500);
  }).catch(err => {
    console.error('Copy failed:', err);
    btnEl.textContent = 'Failed';
    setTimeout(() => {
      btnEl.textContent = 'Copy';
    }, 1500);
  });
}
