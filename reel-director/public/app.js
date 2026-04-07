// REEL DIRECTOR — Frontend
const socket = io();

const state = {
  user: null,
  currentFolder: 'root',
  folderStack: [{ id: 'root', name: 'Home' }],
  driveFiles: [],
  selectedDriveFiles: new Map(),
  uploadedFiles: [],
  currentFilter: 'all',
  currentPlatform: 'instagram',
  currentVibe: 'Cinematic',
  videoOptions: {},
  beauty: {
    smooth: false, smoothStrength: 'medium',
    slim: false, slimStrength: 'subtle',
    bright: false, warmth: false, picsart: false
  }
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
const fmtSize = (b) => {
  if (!b) return '—';
  b = Number(b);
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
  if (b < 1024 * 1024 * 1024) return (b / 1024 / 1024).toFixed(1) + ' MB';
  return (b / 1024 / 1024 / 1024).toFixed(2) + ' GB';
};

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

// AUTH
async function checkAuth() {
  try {
    const res = await fetch('/auth/user');
    const data = await res.json();
    if (!data.loggedIn) return;
    state.user = data.user;
    $('#login-btn').style.display = 'none';
    const info = $('#user-info');
    info.style.display = 'flex';
    $('#user-avatar').src = data.user.picture || '';
    $('#user-name').textContent = data.user.name || '';
    $('#drive-section').style.display = '';
    loadDriveFolder('root');
  } catch (e) { console.warn('Auth check failed', e); }
}

// PLATFORM + VIBE
$$('.platform-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('.platform-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.currentPlatform = btn.dataset.platform;
  });
});

$$('.vibe-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('.vibe-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.currentVibe = btn.dataset.vibe;
  });
});

$$('.quick-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    const ta = $('#brief-input');
    const txt = chip.dataset.text;
    ta.value = ta.value ? ta.value + '\n' + txt : txt;
  });
});

// BEAUTY
$('#beauty-toggle').addEventListener('click', () => {
  $('#beauty-panel').classList.toggle('open');
  $('#beauty-toggle').classList.toggle('open');
});

['smooth', 'slim', 'bright', 'warmth', 'picsart'].forEach(k => {
  const el = $('#beauty-' + k);
  if (el) el.addEventListener('change', () => { state.beauty[k] = el.checked; });
});

['smooth-strength', 'slim-strength'].forEach(id => {
  const container = $('#' + id);
  if (!container) return;
  container.querySelectorAll('.strength-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.strength-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      if (id === 'smooth-strength') state.beauty.smoothStrength = btn.dataset.val;
      else state.beauty.slimStrength = btn.dataset.val;
    });
  });
});

function mapBeautyForServer() {
  return {
    skinSmoothing: state.beauty.smooth,
    smoothingStrength: state.beauty.smoothStrength,
    faceSlimming: state.beauty.slim,
    slimmingAmount: state.beauty.slimStrength,
    brightnessLift: state.beauty.bright,
    warmthBoost: state.beauty.warmth,
    usePicsart: state.beauty.picsart
  };
}

// DRIVE BROWSER
async function loadDriveFolder(folderId) {
  state.currentFolder = folderId;
  const grid = $('#drive-grid');
  grid.innerHTML = '<div class="muted small">Loading…</div>';
  try {
    const res = await fetch('/drive/list?folderId=' + encodeURIComponent(folderId));
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    state.driveFiles = data.files || [];
    renderDriveGrid();
  } catch (e) {
    grid.innerHTML = '<div class="muted small">Error: ' + e.message + '</div>';
  }
}

function renderDriveGrid() {
  const grid = $('#drive-grid');
  const filter = state.currentFilter;
  const files = state.driveFiles.filter(f => {
    const isFolder = f.mimeType === 'application/vnd.google-apps.folder';
    if (filter === 'all' || isFolder) return true;
    if (filter === 'photos') return (f.mimeType || '').startsWith('image/');
    if (filter === 'videos') return (f.mimeType || '').startsWith('video/');
    return true;
  });
  $('#file-count').textContent = files.length + ' items';
  grid.innerHTML = '';
  files.forEach(f => {
    const isFolder = f.mimeType === 'application/vnd.google-apps.folder';
    const item = document.createElement('div');
    item.className = 'drive-item' + (state.selectedDriveFiles.has(f.id) ? ' selected' : '');
    if (isFolder) {
      item.innerHTML = `<div class="folder-icon">📁</div><div class="item-label">${escapeHtml(f.name)}</div>`;
      item.addEventListener('click', () => {
        state.folderStack.push({ id: f.id, name: f.name });
        renderBreadcrumb();
        loadDriveFolder(f.id);
      });
    } else {
      const vid = (f.mimeType || '').startsWith('video/');
      item.innerHTML = `
        <img src="/drive/thumb/${f.id}" loading="lazy" onerror="this.style.display='none'">
        ${vid ? '<div class="video-badge">▶</div>' : ''}
        <div class="item-label">${escapeHtml(f.name)}</div>
      `;
      item.addEventListener('click', () => toggleDriveFile(f));
    }
    grid.appendChild(item);
  });
  updateSelectionBar();
}

function renderBreadcrumb() {
  const bc = $('#breadcrumb');
  bc.innerHTML = '';
  state.folderStack.forEach((f, i) => {
    const span = document.createElement('span');
    span.textContent = f.name;
    if (i === state.folderStack.length - 1) span.className = 'active';
    span.addEventListener('click', () => {
      state.folderStack = state.folderStack.slice(0, i + 1);
      renderBreadcrumb();
      loadDriveFolder(f.id);
    });
    bc.appendChild(span);
    if (i < state.folderStack.length - 1) {
      const sep = document.createElement('span');
      sep.textContent = ' / ';
      sep.className = 'muted';
      bc.appendChild(sep);
    }
  });
}

function toggleDriveFile(f) {
  if (state.selectedDriveFiles.has(f.id)) state.selectedDriveFiles.delete(f.id);
  else state.selectedDriveFiles.set(f.id, f);
  renderDriveGrid();
  updateVideoOptions();
  updateGenerateBtn();
}

function updateSelectionBar() {
  const bar = $('#selection-bar');
  const total = state.selectedDriveFiles.size + state.uploadedFiles.length;
  if (total > 0) {
    bar.style.display = '';
    $('#selection-count').textContent = total + ' files selected';
  } else {
    bar.style.display = 'none';
  }
}

$('#select-all-btn').addEventListener('click', () => {
  state.driveFiles.forEach(f => {
    if (f.mimeType !== 'application/vnd.google-apps.folder') state.selectedDriveFiles.set(f.id, f);
  });
  renderDriveGrid();
  updateVideoOptions();
  updateGenerateBtn();
});

$('#deselect-all-btn').addEventListener('click', () => {
  state.selectedDriveFiles.clear();
  renderDriveGrid();
  updateVideoOptions();
  updateGenerateBtn();
});

$$('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.currentFilter = btn.dataset.filter;
    renderDriveGrid();
  });
});

// DIRECT UPLOAD
const uploadZone = $('#upload-zone');
const fileInput = $('#file-input');

uploadZone.addEventListener('click', () => fileInput.click());
uploadZone.addEventListener('dragover', (e) => { e.preventDefault(); uploadZone.classList.add('dragover'); });
uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('dragover'));
uploadZone.addEventListener('drop', (e) => {
  e.preventDefault();
  uploadZone.classList.remove('dragover');
  handleFiles(e.dataTransfer.files);
});
fileInput.addEventListener('change', (e) => handleFiles(e.target.files));

async function handleFiles(fileList) {
  if (!fileList || fileList.length === 0) return;
  const formData = new FormData();
  Array.from(fileList).forEach(f => formData.append('files', f));
  try {
    const res = await fetch('/upload', { method: 'POST', body: formData });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Upload failed');
    data.files.forEach(f => {
      state.uploadedFiles.push({
        id: f.id,
        name: f.name,
        path: f.localPath,
        size: f.size,
        mimetype: f.mimetype,
        type: f.type
      });
    });
    renderUploaded();
    updateVideoOptions();
    updateGenerateBtn();
    updateSelectionBar();
  } catch (e) {
    alert('Upload error: ' + e.message);
  }
}

function renderUploaded() {
  const c = $('#uploaded-files');
  if (state.uploadedFiles.length === 0) { c.innerHTML = ''; return; }
  c.innerHTML = '<div class="muted small">Uploaded:</div>' + state.uploadedFiles.map(f =>
    `<div class="uploaded-item">📎 ${escapeHtml(f.name)} <span class="muted small">(${fmtSize(f.size)})</span></div>`
  ).join('');
}

// VIDEO OPTIONS
function updateVideoOptions() {
  const videos = [];
  state.selectedDriveFiles.forEach(f => {
    if ((f.mimeType || '').startsWith('video/')) videos.push({ id: f.id, name: f.name });
  });
  state.uploadedFiles.forEach(f => {
    if (f.type === 'video') videos.push({ id: f.id, name: f.name });
  });
  const section = $('#video-options-section');
  const list = $('#video-options-list');
  if (videos.length === 0) { section.style.display = 'none'; return; }
  section.style.display = '';
  list.innerHTML = '';
  videos.forEach(v => {
    if (!state.videoOptions[v.id]) state.videoOptions[v.id] = 'both';
    const row = document.createElement('div');
    row.className = 'video-option-row';
    row.innerHTML = `
      <div class="video-name">🎬 ${escapeHtml(v.name)}</div>
      <div class="video-option-cards">
        ${['trim','frames','both'].map(opt => `
          <div class="video-option-card ${state.videoOptions[v.id] === opt ? 'selected' : ''}" data-vid="${v.id}" data-opt="${opt}">
            <div class="option-icon">${opt === 'trim' ? '✂️' : opt === 'frames' ? '📸' : '🎯'}</div>
            <div class="option-title">${opt === 'trim' ? 'Trim Clips' : opt === 'frames' ? 'Extract Frames' : 'Both'}</div>
            <div class="option-desc">${opt === 'trim' ? 'Use video segments' : opt === 'frames' ? 'Still images only' : 'Clips + stills'}</div>
          </div>
        `).join('')}
      </div>
    `;
    list.appendChild(row);
  });
  list.querySelectorAll('.video-option-card').forEach(card => {
    card.addEventListener('click', () => {
      const vid = card.dataset.vid;
      state.videoOptions[vid] = card.dataset.opt;
      updateVideoOptions();
    });
  });
}

// GENERATE
function updateGenerateBtn() {
  const btn = $('#generate-btn');
  const meta = $('#generate-meta');
  const total = state.selectedDriveFiles.size + state.uploadedFiles.length;
  btn.disabled = total === 0;
  meta.textContent = total === 0 ? 'Select files to begin' : `${total} file${total > 1 ? 's' : ''} ready`;
}

$('#generate-btn').addEventListener('click', runPipeline);

async function runPipeline() {
  const files = [];
  state.selectedDriveFiles.forEach(f => {
    files.push({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      size: f.size ? Number(f.size) : 0,
      driveFileId: f.id,
      type: (f.mimeType || '').startsWith('video/') ? 'video' : 'photo'
    });
  });
  state.uploadedFiles.forEach(f => {
    files.push({
      id: f.id,
      name: f.name,
      mimeType: f.mimetype,
      size: f.size,
      localPath: f.path,
      type: f.type
    });
  });

  const payload = {
    files,
    context: $('#context-input').value,
    audience: $('#audience-input').value,
    vibe: state.currentVibe,
    brief: $('#brief-input').value,
    platform: state.currentPlatform,
    beauty: mapBeautyForServer(),
    videoOptions: state.videoOptions,
    socketId: socket.id
  };

  $('#pipeline-section').style.display = '';
  $('#live-log').innerHTML = '';
  $$('.agent-node').forEach(n => {
    n.className = 'agent-node queued';
    const st = n.querySelector('.node-status');
    if (st) st.textContent = 'queued';
  });
  $('#compression-section').style.display = 'none';
  $('#results-section').style.display = 'none';
  $('#download-section').style.display = 'none';

  try {
    const res = await fetch('/pipeline/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Pipeline failed to start');
    appendLog('Pipeline started with ' + data.fileCount + ' files', 'success');
  } catch (e) {
    appendLog('Error: ' + e.message, 'error');
  }
}

// SOCKET EVENTS
socket.on('agent:update', (data) => {
  const idx = data.agentIndex;
  const node = document.querySelector(`.agent-node[data-index="${idx}"]`);
  if (node) {
    node.classList.remove('queued', 'running', 'done', 'error');
    node.classList.add(data.status || 'running');
    const st = node.querySelector('.node-status');
    if (st) st.textContent = data.status || 'running';
  }
  if (data.message) appendLog(data.message, data.status === 'error' ? 'error' : 'agent');
  if (idx === 0 && data.status === 'done' && data.data) {
    renderCompressionReport(data.data);
  }
});

socket.on('log', (data) => {
  appendLog(data.message || '', data.type || 'info');
});

socket.on('pipeline:complete', (data) => {
  appendLog('Pipeline complete!', 'success');
  if (data && data.result) {
    renderResults(data.result);
    $('#download-section').style.display = '';
    if (data.result.driveLink) {
      const btn = $('#drive-link-btn');
      btn.href = data.result.driveLink;
      btn.style.display = '';
    }
  }
});

socket.on('pipeline:error', (data) => {
  appendLog('Pipeline error: ' + (data.error || 'unknown'), 'error');
});

function appendLog(msg, type = 'info') {
  const log = $('#live-log');
  const line = document.createElement('div');
  line.className = 'log-line';
  const ts = new Date().toLocaleTimeString();
  line.innerHTML = `<span class="timestamp">${ts}</span> <span class="${type}">${escapeHtml(msg)}</span>`;
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
}

// COMPRESSION REPORT
function renderCompressionReport(report) {
  $('#compression-section').style.display = '';
  const pills = $('#report-pills');
  const totalOrig = report.totalOriginalSize || 0;
  const totalComp = report.totalCompressedSize || 0;
  const saved = totalOrig - totalComp;
  const pct = totalOrig > 0 ? Math.round((saved / totalOrig) * 100) : 0;
  pills.innerHTML = `
    <div class="report-pill"><div class="pill-value">${report.filesProcessed || (report.files || []).length}</div><div class="pill-label">Files</div></div>
    <div class="report-pill"><div class="pill-value">${fmtSize(totalOrig)}</div><div class="pill-label">Original</div></div>
    <div class="report-pill"><div class="pill-value">${fmtSize(totalComp)}</div><div class="pill-label">Compressed</div></div>
    <div class="report-pill"><div class="pill-value">${pct}%</div><div class="pill-label">Saved</div></div>
  `;
  $('#compression-progress').style.width = pct + '%';
  const tbody = $('#report-tbody');
  tbody.innerHTML = '';
  (report.files || []).forEach(f => {
    const s = (f.originalSize || 0) - (f.compressedSize || 0);
    const p = f.originalSize ? Math.round((s / f.originalSize) * 100) : 0;
    tbody.innerHTML += `<tr>
      <td>${escapeHtml(f.name || '')}</td>
      <td>${fmtSize(f.originalSize)}</td>
      <td>${fmtSize(f.compressedSize)}</td>
      <td>${p}%</td>
    </tr>`;
  });
}

// RESULTS
function renderResults(result) {
  $('#results-section').style.display = '';
  const concepts = result.concepts || [];
  const editPlans = result.editPlans || [];
  const platformSpecs = result.platformSpecs || [];
  const captions = result.captions || [];

  const tabs = $('#concept-tabs');
  const content = $('#concept-content');
  tabs.innerHTML = '';
  content.innerHTML = '';

  concepts.forEach((c, i) => {
    const tab = document.createElement('button');
    tab.className = 'concept-tab' + (i === 0 ? ' active' : '');
    tab.textContent = c.title || `Concept ${i + 1}`;
    tab.addEventListener('click', () => {
      $$('.concept-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      $$('.concept-panel').forEach(p => p.classList.remove('active'));
      $(`#concept-panel-${i}`).classList.add('active');
    });
    tabs.appendChild(tab);

    const panel = document.createElement('div');
    panel.id = `concept-panel-${i}`;
    panel.className = 'concept-panel' + (i === 0 ? ' active' : '');
    panel.innerHTML = renderConceptDetail(c, editPlans[i], platformSpecs[i], captions[i]);
    content.appendChild(panel);
  });
}

function renderConceptDetail(concept, editPlan, platformSpec, caption) {
  const shots = (concept && concept.shots) || [];
  const shotRows = shots.map((s, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${escapeHtml(s.mediaId || s.file || '—')}</td>
      <td>${escapeHtml(s.duration || '—')}</td>
      <td>${escapeHtml(s.notes || s.description || '—')}</td>
    </tr>
  `).join('');

  const capBlock = caption ? `
    <div class="caption-item">
      <div class="caption-label">Caption</div>
      <div class="caption-text">${escapeHtml(caption.caption || caption.text || '')}</div>
      ${caption.hashtags ? `<div class="hashtags">${escapeHtml(Array.isArray(caption.hashtags) ? caption.hashtags.join(' ') : caption.hashtags)}</div>` : ''}
    </div>
  ` : '';

  const specBlock = platformSpec ? `
    <div class="spec-block">
      <div class="spec-label">Platform Spec</div>
      <pre class="spec-text">${escapeHtml(JSON.stringify(platformSpec, null, 2))}</pre>
    </div>
  ` : '';

  return `
    <div class="concept-detail">
      <h3>${escapeHtml(concept.title || 'Concept')}</h3>
      <p class="muted">${escapeHtml(concept.description || concept.summary || '')}</p>
      <div class="shot-table-wrapper">
        <table class="shot-table">
          <thead><tr><th>#</th><th>Media</th><th>Duration</th><th>Notes</th></tr></thead>
          <tbody>${shotRows}</tbody>
        </table>
      </div>
      ${capBlock}
      ${specBlock}
    </div>
  `;
}

// INIT
checkAuth();
renderBreadcrumb();
updateGenerateBtn();
