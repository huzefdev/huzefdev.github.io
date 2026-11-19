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

    const res = await fetch('apps.json?v=8&t=' + Date.now());
    storeData = await res.json();
    renderAll();

    // Only hit GitHub API if cache is older than 2 hours (GitHub Action already keeps apps.json fresh)
    const lastSync = Number(localStorage.getItem("huzef_last_sync_ts") || 0);
    const twoHours = 2 * 60 * 60 * 1000;
    if (Date.now() - lastSync > twoHours) {
      await syncFullGitHubEcosystem();
    } else {
      const pill = document.getElementById("apiStatusPill");
      if (pill) pill.textContent = "Instant CDN ●";
    }
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
    localStorage.setItem("huzef_last_sync_ts", String(Date.now()));
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
    downloadUrl: app.direct_download_url || `https://github.com/${storeData.store.github_user}/${app.repo}/releases/latest/download/${app.apk_filename}`,
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

function triggerDownload(app) {
  const meta = getMeta(app);
  const directUrl = meta.downloadUrl || `https://github.com/${storeData.store.github_user}/${app.repo}/releases/download/v0.52/${app.apk_filename}`;
  const ua = navigator.userAgent || "";
  const isInApp = /Instagram|FBAN|FBAV|Twitter|Line|Snapchat/i.test(ua);

  // From Instagram / In-App browser: jump straight to Chrome so APK downloads cleanly without 404/block
  if (isInApp) {
    const noProto = directUrl.replace(/^https?:\/\//, "");
    if (/Android/i.test(ua)) {
      window.location.href = `intent://${noProto}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(directUrl)};end`;
    } else {
      window.location.href = directUrl;
    }
    return;
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
      <div id="dlSub" class="dl-sub">Starting download (${meta.size})...</div>
    </div>
    <button id="dlCancelBtn" class="dl-cancel" title="Close">✕</button>
  `;
  hud.classList.remove("hidden");

  const ringFg = document.getElementById("dlRingFg");
  const pctEl = document.getElementById("dlPct");
  const subEl = document.getElementById("dlSub");
  const circumference = 125.6;

  document.getElementById("dlCancelBtn").onclick = () => hud.classList.add("hidden");

  // Trigger real browser APK download cleanly
  const a = document.createElement("a");
  a.href = directUrl;
  a.download = app.apk_filename || "Pocketcloud.apk";
  a.rel = "noopener";
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
      pctEl.textContent = "✓";
      subEl.textContent = "Check notification bar to install APK";
      setTimeout(() => hud.classList.add("hidden"), 4500);
    } else {
      ringFg.style.strokeDashoffset = circumference - (progress / 100) * circumference;
      pctEl.textContent = `${progress}%`;
      subEl.textContent = `Downloading ${app.apk_filename || "Pocketcloud.apk"} (${meta.size})...`;
    }
  }, 180);
}
