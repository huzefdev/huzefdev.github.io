let storeData = null;
let liveMeta = {};
let githubRepos = [];
let activeHeroIndex = 0;
let currentCategory = 'All';
let searchQuery = '';
let deferredPrompt = null;

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  const btn = document.getElementById('pwaInstallBtn');
  if (btn) btn.classList.remove('hidden');
});

const pwaBtn = document.getElementById('pwaInstallBtn');
if (pwaBtn) {
  pwaBtn.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    pwaBtn.classList.add('hidden');
  });
}

async function initStore() {
  try {
    const cached = localStorage.getItem('huzef_store_cache_v2');
    if (cached) {
      const parsed = JSON.parse(cached);
      liveMeta = parsed.liveMeta || {};
      githubRepos = parsed.githubRepos || [];
    }

    const res = await fetch('apps.json?v=9&t=' + Date.now());
    storeData = await res.json();
    renderAll();

    // Only hit GitHub API once every 2 hours (GitHub Action keeps apps.json updated)
    const lastSync = Number(localStorage.getItem('huzef_last_sync_ts') || 0);
    if (Date.now() - lastSync > 2 * 60 * 60 * 1000) {
      await syncFullGitHubEcosystem();
    } else {
      const pill = document.getElementById('apiStatusPill');
      if (pill) pill.textContent = 'Instant CDN ●';
    }
  } catch (err) {
    console.error('Store init error:', err);
  }
}

async function syncFullGitHubEcosystem() {
  const pill = document.getElementById('apiStatusPill');
  if (pill) pill.textContent = 'Syncing...';
  const user = storeData.store.github_user;

  try {
    const repoRes = await fetch(`https://api.github.com/users/${user}/repos?sort=pushed&per_page=30`);
    if (repoRes.ok) {
      githubRepos = await repoRes.json();
    }

    await Promise.all(storeData.apps.map(async (app) => {
      try {
        const relRes = await fetch(`https://api.github.com/repos/${user}/${app.repo}/releases/latest`);
        if (!relRes.ok) return;
        const rel = await relRes.json();
        const apkAsset = (rel.assets || []).find(a => a.name.toLowerCase().endsWith('.apk'));
        liveMeta[app.id] = {
          version: rel.tag_name || app.fallback_version,
          size: apkAsset ? (apkAsset.size / (1024 * 1024)).toFixed(1) + ' MB' : app.fallback_size,
          downloadUrl: apkAsset
            ? apkAsset.browser_download_url
            : (app.direct_download_url || `https://github.com/${user}/${app.repo}/releases/download/${app.fallback_version}/${app.apk_filename}`),
          notes: rel.body || app.simple_summary,
          publishedAt: rel.published_at ? new Date(rel.published_at).toLocaleDateString('en-IN') : 'Latest'
        };
      } catch {}
    }));

    localStorage.setItem('huzef_store_cache_v2', JSON.stringify({ liveMeta, githubRepos }));
    localStorage.setItem('huzef_last_sync_ts', String(Date.now()));
    if (pill) pill.textContent = 'Live CDN ●';
  } catch {
    if (pill) pill.textContent = 'Instant CDN ●';
  }
  renderAll();
}

function getMeta(app) {
  return liveMeta[app.id] || {
    version: app.fallback_version,
    size: app.fallback_size,
    downloadUrl: app.direct_download_url || `https://github.com/${storeData.store.github_user}/${app.repo}/releases/download/${app.fallback_version}/${app.apk_filename}`,
    notes: app.simple_summary,
    publishedAt: 'Verified'
  };
}

function renderIconHTML(app, sizePx = 56) {
  if (app.icon_image) {
    return `<div class="app-icon-box" style="width:${sizePx}px;height:${sizePx}px;">
      <img src="${encodeURI(app.icon_image)}" alt="${app.name}" onerror="this.remove()" />
      <span>${app.icon_text}</span>
    </div>`;
  }
  return `<div class="app-icon-box" style="width:${sizePx}px;height:${sizePx}px;">
    <span>${app.icon_text}</span>
  </div>`;
}

function buildGalleryHTML(app) {
  const vidHTML = app.video_id
    ? `<div class="video-trailer-card">
        <iframe src="https://www.youtube-nocookie.com/embed/${app.video_id}?rel=0&modestbranding=1&playsinline=1"
          title="${app.name} Launch Trailer"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowfullscreen></iframe>
      </div>`
    : '';
  const shotsHTML = (app.screenshots || []).map(src => `
    <div class="screenshot-card" onclick="openLightbox('${encodeURI(src)}')">
      <img src="${encodeURI(src)}" alt="${app.name} Preview" loading="lazy" />
    </div>
  `).join('');
  return vidHTML + shotsHTML;
}

function renderAll() {
  if (!storeData) return;
  renderHero();
  renderAppsGrid('homeAppsGrid', storeData.apps);
  renderLibraryGrid();
  renderChangelogFeed();
  renderGitHubRepos();
  renderCategoryChips();
}

function renderCategoryChips() {
  const wrap = document.querySelector('.category-chips');
  if (!wrap) return;
  const cats = ['All', ...new Set(storeData.apps.map(a => a.category))];
  wrap.innerHTML = cats.map(c =>
    `<button class="cat-chip ${currentCategory === c ? 'active' : ''}" onclick="setCategory('${c}')">${c === 'All' ? 'All APKs' : c}</button>`
  ).join('');
}

window.setCategory = (cat) => {
  currentCategory = cat;
  renderCategoryChips();
  renderLibraryGrid();
};

function renderHero() {
  const featured = storeData.apps.filter(a => a.featured);
  if (!featured.length) return;
  const app = featured[activeHeroIndex % featured.length];
  const meta = getMeta(app);

  document.getElementById('heroBadge').textContent = `FEATURED APK • ${meta.version} • ${meta.size}`;
  document.getElementById('heroTitle').textContent = app.name;
  document.getElementById('heroSub').textContent = app.tagline;

  document.getElementById('heroInstallBtn').onclick = () => triggerDownload(app);
  document.getElementById('heroDetailsBtn').onclick = () => openAppModal(app.id);

  const galleryStrip = document.getElementById('heroGalleryStrip');
  if (galleryStrip) {
    galleryStrip.innerHTML = buildGalleryHTML(app);
  }

  const dotsEl = document.getElementById('heroDots');
  if (dotsEl) {
    dotsEl.innerHTML = featured.length > 1
      ? featured.map((_, i) => `<span class="hero-dot ${i === activeHeroIndex ? 'active' : ''}" onclick="setHero(${i})"></span>`).join('')
      : '';
  }
}

window.setHero = (i) => {
  activeHeroIndex = i;
  renderHero();
};

function renderAppsGrid(containerId, appsList) {
  const el = document.getElementById(containerId);
  if (!el) return;

  el.innerHTML = appsList.map(app => {
    const meta = getMeta(app);
    return `
      <div class="app-card">
        <div class="app-card-top" onclick="openAppModal('${app.id}')">
          ${renderIconHTML(app, 56)}
          <div class="app-card-title">
            <h3>${app.name}</h3>
            <div class="app-card-meta">${meta.version} • ${meta.size} • APK</div>
          </div>
        </div>
        <p class="app-card-desc" onclick="openAppModal('${app.id}')">${app.simple_summary}</p>
        <div class="app-card-footer">
          <span class="cat-pill">${app.category}</span>
          <div class="card-btns">
            <button class="btn-preview" onclick="openAppModal('${app.id}')">Preview</button>
            <button class="btn-install" onclick="triggerDownloadById('${app.id}')">Install APK</button>
          </div>
        </div>
      </div>
    `;
  }).join('') || `<p style="color:var(--text-secondary);">No matching APKs found.</p>`;
}

function renderLibraryGrid() {
  const q = searchQuery.toLowerCase();
  const filtered = storeData.apps.filter(app => {
    const matchCat = currentCategory === 'All' || app.category === currentCategory;
    const matchQ = !q || app.name.toLowerCase().includes(q) || app.tagline.toLowerCase().includes(q) || app.simple_summary.toLowerCase().includes(q);
    return matchCat && matchQ;
  });
  renderAppsGrid('libraryGrid', filtered);
}

function renderChangelogFeed() {
  const feed = document.getElementById('changelogFeed');
  if (!feed) return;
  feed.innerHTML = storeData.apps.map(app => {
    const meta = getMeta(app);
    return `
      <div class="changelog-card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <strong>${app.name} <span style="color:var(--text-secondary);font-family:var(--font-mono);font-size:12px;">${meta.version}</span></strong>
          <span class="mono-tag">${meta.publishedAt}</span>
        </div>
        <p style="font-size:13px;color:var(--text-secondary);line-height:1.5;margin-bottom:12px;">${meta.notes}</p>
        <button class="btn-install" onclick="triggerDownloadById('${app.id}')">Download APK (${meta.size})</button>
      </div>
    `;
  }).join('');
}

function renderGitHubRepos() {
  const grid = document.getElementById('githubReposGrid');
  if (!grid) return;
  if (!githubRepos.length) {
    grid.innerHTML = `<p style="color:var(--text-secondary);font-size:13px;">Open-source repositories from @huzefdev sync automatically.</p>`;
    return;
  }
  grid.innerHTML = githubRepos.slice(0, 6).map(repo => `
    <a href="${repo.html_url}" target="_blank" rel="noopener" class="repo-card" style="text-decoration:none;color:inherit;display:block;">
      <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
        <strong style="color:#fff;">${repo.name}</strong>
        <span class="mono-tag">★ ${repo.stargazers_count}</span>
      </div>
      <p style="font-size:12px;color:var(--text-secondary);line-height:1.45;margin-bottom:8px;">${repo.description || 'Open-source Android & systems project.'}</p>
      <span class="mono-tag">${repo.language || 'Systems'} • Updated ${new Date(repo.updated_at).toLocaleDateString('en-IN')}</span>
    </a>
  `).join('');
}

window.triggerDownloadById = (id) => {
  const app = storeData.apps.find(a => a.id === id);
  if (app) triggerDownload(app);
};

function triggerDownload(app) {
  const meta = getMeta(app);
  const directUrl = meta.downloadUrl;
  const ua = navigator.userAgent || '';
  const isInApp = /Instagram|FBAN|FBAV|Twitter|Line|Snapchat/i.test(ua);

  // Instagram / In-App browser: open directly in Chrome so APK downloads cleanly without block
  if (isInApp) {
    const noProto = directUrl.replace(/^https?:\/\//, '');
    if (/Android/i.test(ua)) {
      window.location.href = `intent://${noProto}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(directUrl)};end`;
    } else {
      window.location.href = directUrl;
    }
    return;
  }

  let hud = document.getElementById('dlHud');
  if (!hud) {
    hud = document.createElement('div');
    hud.id = 'dlHud';
    hud.className = 'dl-hud';
    document.body.appendChild(hud);
  }

  hud.innerHTML = `
    <div class="ring-wrap">
      <svg viewBox="0 0 48 48">
        <circle class="ring-bg" cx="24" cy="24" r="20"></circle>
        <circle id="dlRingFg" class="ring-fg" cx="24" cy="24" r="20"></circle>
      </svg>
      <span id="dlPct" class="ring-pct">0%</span>
    </div>
    <div class="dl-info">
      <strong>Downloading ${app.name}</strong>
      <div id="dlSub" class="dl-sub">Starting download (${meta.size})...</div>
    </div>
    <button id="dlCancelBtn" class="dl-cancel" title="Close">✕</button>
  `;
  hud.classList.remove('hidden');

  const ringFg = document.getElementById('dlRingFg');
  const pctEl = document.getElementById('dlPct');
  const subEl = document.getElementById('dlSub');
  const circumference = 125.6;

  document.getElementById('dlCancelBtn').onclick = () => hud.classList.add('hidden');

  const a = document.createElement('a');
  a.href = directUrl;
  a.download = app.apk_filename || 'Pocketcloud.apk';
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();

  let progress = 0;
  const timer = setInterval(() => {
    progress += 14;
    if (progress >= 100) {
      progress = 100;
      clearInterval(timer);
      ringFg.style.strokeDashoffset = 0;
      pctEl.textContent = '✓';
      subEl.textContent = 'Downloading in notification bar • Tap to install';
      setTimeout(() => hud.classList.add('hidden'), 4500);
    } else {
      ringFg.style.strokeDashoffset = circumference - (progress / 100) * circumference;
      pctEl.textContent = `${progress}%`;
      subEl.textContent = `Fetching ${app.apk_filename || 'Pocketcloud.apk'} (${meta.size})...`;
    }
  }, 180);
}

window.openAppModal = (id) => {
  const app = storeData.apps.find(a => a.id === id);
  if (!app) return;
  const meta = getMeta(app);

  const galleryHTML = (app.video_id || (app.screenshots && app.screenshots.length))
    ? `<div style="margin:14px 0;">
        <span class="mono-tag" style="display:block;margin-bottom:8px;">TRAILER & SCREENSHOTS (TAP IMAGE TO ZOOM)</span>
        <div class="modal-gallery-strip">
          ${buildGalleryHTML(app)}
        </div>
      </div>`
    : '';

  document.getElementById('modalBody').innerHTML = `
    <div style="display:flex;align-items:center;gap:14px;margin-bottom:16px;">
      ${renderIconHTML(app, 64)}
      <div>
        <span class="mono-tag">${app.category.toUpperCase()}</span>
        <h2 style="font-size:22px;font-weight:800;">${app.name}</h2>
        <span style="font-size:13px;color:var(--text-secondary);">${meta.version} • ${meta.size} • Direct APK</span>
      </div>
    </div>

    <button class="liquid-cta" style="width:100%;margin-bottom:16px;" onclick="triggerDownloadById('${app.id}')">
      Download & Install APK (${meta.size})
    </button>

    ${galleryHTML}

    <p style="font-size:14px;line-height:1.6;color:var(--text-secondary);">${app.simple_summary}</p>

    <div class="feature-pills">
      ${app.features.map(f => `<span class="feature-pill">✦ ${f}</span>`).join('')}
    </div>

    <div class="sha-box">
      <strong style="color:#fff;display:block;margin-bottom:4px;">SHA-256 SECURITY CHECKSUM</strong>
      ${app.sha256}
    </div>

    <a href="https://github.com/${storeData.store.github_user}/${app.repo}" target="_blank" rel="noopener" class="liquid-secondary" style="display:block;text-align:center;text-decoration:none;">
      View Source Code on GitHub ↗
    </a>
  `;

  document.getElementById('appModal').classList.remove('hidden');
};

window.openLightbox = (src) => {
  document.getElementById('lightboxImg').src = src;
  document.getElementById('lightboxModal').classList.remove('hidden');
};

window.closeLightbox = () => {
  document.getElementById('lightboxModal').classList.add('hidden');
};

document.getElementById('closeModalBtn').onclick = () => {
  document.getElementById('appModal').classList.add('hidden');
};
document.getElementById('appModal').onclick = (e) => {
  if (e.target.id === 'appModal') document.getElementById('appModal').classList.add('hidden');
};

window.switchTab = (tabName) => {
  document.querySelectorAll('.tab-view').forEach(v => v.classList.add('hidden'));
  const target = document.getElementById(`view-${tabName}`);
  if (target) target.classList.remove('hidden');

  document.querySelectorAll('.menu-link, .dock-item').forEach(b => b.classList.remove('active'));
  document.querySelectorAll(`[data-tab="${tabName}"]`).forEach(b => b.classList.add('active'));
  window.scrollTo({ top: 0, behavior: 'smooth' });
};

document.querySelectorAll('[data-tab]').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

function handleSearch(val) {
  searchQuery = val;
  switchTab('library');
  renderLibraryGrid();
}

const deskSearch = document.getElementById('desktopSearchInput');
if (deskSearch) deskSearch.addEventListener('input', (e) => handleSearch(e.target.value));

const mobSearch = document.getElementById('mobileSearchInput');
if (mobSearch) {
  mobSearch.addEventListener('input', (e) => {
    document.getElementById('clearSearchBtn').classList.toggle('hidden', !e.target.value);
    handleSearch(e.target.value);
  });
}

const dockSearch = document.getElementById('dockSearchBtn');
if (dockSearch) {
  dockSearch.addEventListener('click', () => {
    const wrap = document.getElementById('mobileSearchWrap');
    const isHidden = wrap.classList.toggle('hidden');
    if (!isHidden) {
      switchTab('library');
      document.getElementById('mobileSearchInput').focus();
    }
  });
}

const clearBtn = document.getElementById('clearSearchBtn');
if (clearBtn) {
  clearBtn.addEventListener('click', () => {
    document.getElementById('mobileSearchInput').value = '';
    clearBtn.classList.add('hidden');
    handleSearch('');
  });
}

const refreshBtn = document.getElementById('refreshApiBtn');
if (refreshBtn) {
  refreshBtn.addEventListener('click', () => {
    localStorage.removeItem('huzef_store_cache_v2');
    localStorage.removeItem('huzef_last_sync_ts');
    syncFullGitHubEcosystem();
  });
}

initStore();
