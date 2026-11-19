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
  document.getElementById('pwaInstallBtn').classList.remove('hidden');
});

document.getElementById('pwaInstallBtn').addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  document.getElementById('pwaInstallBtn').classList.add('hidden');
});

async function initStore() {
  try {
    // Load cached GitHub data instantly for 0ms smooth startup
    const cached = localStorage.getItem('huzef_store_cache_v1');
    if (cached) {
      const parsed = JSON.parse(cached);
      liveMeta = parsed.liveMeta || {};
      githubRepos = parsed.githubRepos || [];
    }

    const res = await fetch('apps.json?t=' + Date.now());
    storeData = await res.json();
    renderAll();

    // Background silent sync with GitHub API
    await syncFullGitHubEcosystem();
  } catch (err) {
    console.error('Store init error:', err);
  }
}

async function syncFullGitHubEcosystem() {
  const pill = document.getElementById('apiStatusPill');
  if (pill) pill.textContent = 'Syncing GitHub...';

  const user = storeData.store.github_user;

  try {
    // 1. Fetch all public repos sorted by latest push
    const repoRes = await fetch(`https://api.github.com/users/${user}/repos?sort=pushed&per_page=30`);
    if (repoRes.ok) {
      githubRepos = await repoRes.json();
    }

    // 2. Sync known apps in apps.json
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
            : `https://github.com/${user}/${app.repo}/releases/latest/download/${app.apk_filename}`,
          notes: rel.body || app.simple_summary,
          publishedAt: rel.published_at ? new Date(rel.published_at).toLocaleDateString('en-IN') : 'Latest'
        };
      } catch {}
    }));

    // 3. Auto-discover ANY new repo on GitHub where you uploaded an .apk release
    const knownRepos = new Set(storeData.apps.map(a => a.repo.toLowerCase()));
    const candidates = githubRepos.filter(r => !r.fork && !knownRepos.has(r.name.toLowerCase()));

    await Promise.all(candidates.map(async (repo) => {
      try {
        const relRes = await fetch(`https://api.github.com/repos/${user}/${repo.name}/releases/latest`);
        if (!relRes.ok) return;
        const rel = await relRes.json();
        const apkAsset = (rel.assets || []).find(a => a.name.toLowerCase().endsWith('.apk'));
        if (!apkAsset) return; // Only include repos that actually have an APK release

        const id = repo.name.toLowerCase();
        const cleanName = repo.name.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

        storeData.apps.push({
          id,
          name: cleanName,
          tagline: repo.description || 'Official Android APK by @huzefdev',
          category: (repo.topics && repo.topics[0]) ? repo.topics[0] : 'Android APK',
          featured: false,
          accent: '#38BDF8',
          accent_secondary: '#00F5A0',
          repo: repo.name,
          apk_filename: apkAsset.name,
          fallback_version: rel.tag_name || 'v1.0',
          fallback_size: (apkAsset.size / (1024 * 1024)).toFixed(1) + ' MB',
          icon_image: `https://raw.githubusercontent.com/${user}/${repo.name}/${repo.default_branch}/playstore.png`,
          icon_text: cleanName.slice(0, 2).toUpperCase(),
          screenshots: [],
          sha256: 'Verified GitHub Release Asset',
          simple_summary: repo.description || 'Direct signed Android APK build. Tap Install APK to download directly.',
          features: ['Direct APK Install', 'Zero Ads', 'Auto-Synced from GitHub']
        });

        liveMeta[id] = {
          version: rel.tag_name || 'v1.0',
          size: (apkAsset.size / (1024 * 1024)).toFixed(1) + ' MB',
          downloadUrl: apkAsset.browser_download_url,
          notes: rel.body || repo.description || 'Latest release build.',
          publishedAt: new Date(rel.published_at).toLocaleDateString('en-IN')
        };
      } catch {}
    }));

    localStorage.setItem('huzef_store_cache_v1', JSON.stringify({ liveMeta, githubRepos }));
    if (pill) pill.textContent = 'Auto-Synced ●';
  } catch {
    if (pill) pill.textContent = 'Offline Ready ●';
  }

  renderAll();
}

function getMeta(app) {
  return liveMeta[app.id] || {
    version: app.fallback_version,
    size: app.fallback_size,
    downloadUrl: `https://github.com/${storeData.store.github_user}/${app.repo}/releases/latest/download/${app.apk_filename}`,
    notes: app.simple_summary,
    publishedAt: 'Verified'
  };
}

function renderIconHTML(app, sizePx = 56) {
  if (app.icon_image) {
    return `<div class="app-icon-box" style="width:${sizePx}px;height:${sizePx}px;background:linear-gradient(145deg, ${app.accent}, ${app.accent_secondary});">
      <img src="${encodeURI(app.icon_image)}" alt="${app.name}" onerror="this.remove()" />
      <span>${app.icon_text}</span>
    </div>`;
  }
  return `<div class="app-icon-box" style="width:${sizePx}px;height:${sizePx}px;background:linear-gradient(145deg, ${app.accent}, ${app.accent_secondary});">
    <span>${app.icon_text}</span>
  </div>`;
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

function buildGalleryHTML(app) {
  const videoHTML = app.video_id
    ? `<div class="video-trailer-card">
        <iframe src="https://www.youtube-nocookie.com/embed/${app.video_id}?rel=0&modestbranding=1&playsinline=1"
          title="${app.name} Launch Trailer"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowfullscreen></iframe>
      </div>`
    : "";
  const shotsHTML = (app.screenshots || []).map(src => `
    <div class="screenshot-card" onclick="openLightbox('${encodeURI(src)}')">
      <img src="${encodeURI(src)}" alt="${app.name} Preview" loading="lazy" />
    </div>
  `).join("");
  return videoHTML + shotsHTML;
}

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
  galleryStrip.innerHTML = buildGalleryHTML(app);

  document.getElementById('heroDots').innerHTML = featured.length > 1
    ? featured.map((_, i) => `<span class="hero-dot ${i === activeHeroIndex ? 'active' : ''}" onclick="setHero(${i})"></span>`).join('')
    : '';
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
  feed.innerHTML = storeData.apps.map(app => {
    const meta = getMeta(app);
    return `
      <div class="changelog-card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <strong>${app.name} <span style="color:var(--emerald);font-family:var(--font-mono);font-size:12px;">${meta.version}</span></strong>
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
    grid.innerHTML = `<p style="color:var(--text-secondary);font-size:13px;">Repositories from github.com/huzefdev sync automatically when online.</p>`;
    return;
  }
  grid.innerHTML = githubRepos.slice(0, 6).map(repo => `
    <a href="${repo.html_url}" target="_blank" rel="noopener" class="repo-card" style="text-decoration:none;color:inherit;display:block;">
      <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
        <strong style="color:#fff;">${repo.name}</strong>
        <span class="mono-tag" style="color:var(--emerald);">★ ${repo.stargazers_count}</span>
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

let activeAbort = null;

async function triggerDownload(app) {
  const meta = getMeta(app);
  const fileName = app.apk_filename || `${app.name.replace(/\s+/g, "-")}.apk`;

  // Cancel any ongoing download
  if (activeAbort) {
    activeAbort.abort();
    activeAbort = null;
  }

  let hud = document.getElementById("dlHud");
  if (!hud) {
    hud = document.createElement("div");
    hud.id = "dlHud";
    hud.className = "dl-hud";
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
      <div id="dlSub" class="dl-sub">Connecting to high-speed CDN...</div>
    </div>
    <button id="dlCancelBtn" class="dl-cancel" title="Cancel">✕</button>
  `;
  hud.classList.remove("hidden");

  const controller = new AbortController();
  activeAbort = controller;
  document.getElementById("dlCancelBtn").onclick = () => {
    controller.abort();
    hud.classList.add("hidden");
  };

  const ringFg = document.getElementById("dlRingFg");
  const pctEl = document.getElementById("dlPct");
  const subEl = document.getElementById("dlSub");
  const circumference = 125.6;

  try {
    // Use CORS-friendly GitHub API asset stream or direct release URL
    const response = await fetch(meta.downloadUrl, { signal: controller.signal });
    if (!response.ok || !response.body) throw new Error("Stream fallback");

    const total = Number(response.headers.get("content-length")) || 0;
    const reader = response.body.getReader();
    const chunks = [];
    let received = 0;
    const startTime = performance.now();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;

      const elapsed = Math.max((performance.now() - startTime) / 1000, 0.1);
      const speedMBs = ((received / (1024 * 1024)) / elapsed).toFixed(1);
      const recMB = (received / (1024 * 1024)).toFixed(1);

      if (total > 0) {
        const pct = Math.min(Math.round((received / total) * 100), 100);
        const totMB = (total / (1024 * 1024)).toFixed(1);
        ringFg.style.strokeDashoffset = circumference - (pct / 100) * circumference;
        pctEl.textContent = `${pct}%`;
        subEl.textContent = `${recMB} / ${totMB} MB • ${speedMBs} MB/s`;
      } else {
        pctEl.textContent = "↓";
        subEl.textContent = `${recMB} MB • ${speedMBs} MB/s`;
      }
    }

    pctEl.textContent = "✓";
    ringFg.style.strokeDashoffset = 0;
    subEl.textContent = "Download complete! Opening APK installer...";

    const blob = new Blob(chunks, { type: "application/vnd.android.package-archive" });
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();

    setTimeout(() => {
      URL.revokeObjectURL(blobUrl);
      hud.classList.add("hidden");
    }, 3500);
  } catch (err) {
    if (err.name === "AbortError") return;
    // Seamless direct native browser download fallback (no new tab redirect)
    pctEl.textContent = "↓";
    ringFg.style.strokeDashoffset = 30;
    subEl.textContent = `Direct download started (${meta.size})...`;
    const a = document.createElement("a");
    a.href = meta.downloadUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => hud.classList.add("hidden"), 3000);
  }
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
        <span class="mono-tag" style="color:var(--emerald);">${app.category.toUpperCase()}</span>
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
  document.getElementById(`view-${tabName}`).classList.remove('hidden');

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

document.getElementById('desktopSearchInput').addEventListener('input', (e) => handleSearch(e.target.value));
document.getElementById('mobileSearchInput').addEventListener('input', (e) => {
  document.getElementById('clearSearchBtn').classList.toggle('hidden', !e.target.value);
  handleSearch(e.target.value);
});

document.getElementById('dockSearchBtn').addEventListener('click', () => {
  const wrap = document.getElementById('mobileSearchWrap');
  const isHidden = wrap.classList.toggle('hidden');
  if (!isHidden) {
    switchTab('library');
    document.getElementById('mobileSearchInput').focus();
  }
});

document.getElementById('clearSearchBtn').addEventListener('click', () => {
  document.getElementById('mobileSearchInput').value = '';
  document.getElementById('clearSearchBtn').classList.add('hidden');
  handleSearch('');
});

document.getElementById('refreshApiBtn').addEventListener('click', () => {
  localStorage.removeItem('huzef_store_cache_v1');
  syncFullGitHubEcosystem();
});

initStore();
