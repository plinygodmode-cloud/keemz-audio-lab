/* ==========================================================================
   KEEMZ AUDIO LAB — front-end application
   Vanilla JS, no dependencies. All user-supplied or configuration values are
   escaped before they touch the DOM, and every URL is validated.
   ========================================================================== */
(() => {
  'use strict';

  /* ----------------------------- utilities ------------------------------- */
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  // matchMedia is missing in some embedded webviews and test environments;
  // a missing API must never stop the page from rendering.
  const mediaQuery = (query, fallback = false) => {
    if (typeof window.matchMedia !== 'function') {
      return { matches: fallback, addEventListener() {}, removeEventListener() {} };
    }
    try {
      return window.matchMedia(query);
    } catch {
      return { matches: fallback, addEventListener() {}, removeEventListener() {} };
    }
  };
  const reduceMotion = () => mediaQuery('(prefers-reduced-motion: reduce)').matches;
  const finePointer = () => mediaQuery('(hover: hover) and (pointer: fine)').matches;
  const htmlEscapes = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const escapeHtml = value => String(value === undefined || value === null ? '' : value).replace(/[&<>"']/g, char => htmlEscapes[char]);
  const text = (value, max = 180) => String(value === undefined || value === null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  /** Same-origin path or absolute http(s) URL only — never javascript: etc. */
  function safeUrl(value, { allowPath = true } = {}) {
    const raw = String(value === undefined || value === null ? '' : value).trim();
    if (!raw || raw.startsWith('//')) return '';
    try {
      const url = new URL(raw, window.location.origin);
      if (!['http:', 'https:'].includes(url.protocol)) return '';
      const absolute = /^https?:\/\//i.test(raw);
      const sameSite = allowPath && raw.startsWith('/') && !raw.startsWith('//');
      return absolute || sameSite ? url.href : '';
    } catch {
      return '';
    }
  }

  function toEmbed(provider, value) {
    const url = safeUrl(value);
    if (!url) return '';
    const parsed = new URL(url);
    if (provider === 'soundcloud' && /(^|\.)soundcloud\.com$/i.test(parsed.hostname)) {
      return `https://w.soundcloud.com/player/?url=${encodeURIComponent(parsed.href)}&color=%2300cfff&auto_play=false&hide_related=true&show_comments=false&show_user=true&show_reposts=false&visual=true`;
    }
    if (provider === 'spotify' && /(^|\.)open\.spotify\.com$/i.test(parsed.hostname)) {
      parsed.pathname = parsed.pathname.replace(/^\/(?!embed\/)/, '/embed/');
      return parsed.href;
    }
    if (provider === 'youtube') {
      let id = '';
      if (parsed.hostname === 'youtu.be') id = parsed.pathname.slice(1).split('/')[0];
      else if (/(^|\.)(youtube\.com|youtube-nocookie\.com)$/i.test(parsed.hostname)) {
        id = parsed.searchParams.get('v') || (parsed.pathname.match(/\/(?:embed|shorts|live)\/([^/?]+)/) || [])[1] || '';
        if (!id && parsed.pathname === '/playlist' && parsed.searchParams.get('list')) {
          return `https://www.youtube-nocookie.com/embed/videoseries?list=${encodeURIComponent(parsed.searchParams.get('list'))}`;
        }
      }
      return id ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?rel=0` : '';
    }
    return '';
  }

  const moneyFormatter = new Map();
  function money(minor, currency) {
    const code = /^[A-Z]{3}$/.test(String(currency || '')) ? String(currency) : 'EGP';
    const amount = Number(minor) / 100;
    if (!Number.isFinite(amount)) return '—';
    try {
      if (!moneyFormatter.has(code)) {
        moneyFormatter.set(code, new Intl.NumberFormat('en', { style: 'currency', currency: code, maximumFractionDigits: 2 }));
      }
      return moneyFormatter.get(code).format(amount);
    } catch {
      return `${code} ${amount.toFixed(2)}`;
    }
  }

  const formatTime = seconds => {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    const total = Math.floor(seconds);
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  };

  /* --------------------------- configuration ----------------------------- */
  const rawConfig = window.KAL_CONFIG && typeof window.KAL_CONFIG === 'object' ? window.KAL_CONFIG : {};

  const config = {
    siteName: text(rawConfig.siteName, 80) || 'Keemz Audio Lab',
    location: text(rawConfig.location, 60),
    contactEmail: EMAIL_RE.test(String(rawConfig.contactEmail || '')) ? String(rawConfig.contactEmail) : '',
    whatsapp: /^\+?\d{8,16}$/.test(String(rawConfig.whatsapp || '').replace(/\s/g, '')) ? String(rawConfig.whatsapp).replace(/\s/g, '') : '',
    socials: rawConfig.socials && typeof rawConfig.socials === 'object' ? rawConfig.socials : {},
    featured: rawConfig.featured && typeof rawConfig.featured === 'object' ? rawConfig.featured : {},
    tracks: Array.isArray(rawConfig.tracks) ? rawConfig.tracks : [],
    services: Array.isArray(rawConfig.services) ? rawConfig.services : [],
    inquiryOptions: Array.isArray(rawConfig.inquiryOptions) && rawConfig.inquiryOptions.length
      ? rawConfig.inquiryOptions.map(option => text(option, 60)).filter(Boolean)
      : ['Beat production', 'Sound design', 'Mixing & mastering', 'Stem separation', 'Custom sample pack', 'Other / collaboration'],
    signals: Array.isArray(rawConfig.signals) ? rawConfig.signals : [],
    storeNote: text(rawConfig.storeNote, 240),
    licensingUrl: safeUrl(rawConfig.licensingUrl) || '/licensing',
    availability: text(rawConfig.availability, 40),
    responseTime: text(rawConfig.responseTime, 80),
    turnstileSiteKey: text(rawConfig.turnstileSiteKey, 120)
  };

  /* ------------------------------ toasts --------------------------------- */
  const toastRegion = $('#toast-region');
  function toast(message, { type = 'success', actionLabel, onAction, duration = 4200 } = {}) {
    if (!toastRegion) return;
    const node = document.createElement('div');
    node.className = `toast is-${type}`;
    node.setAttribute('role', type === 'error' ? 'alert' : 'status');
    const label = document.createElement('span');
    label.textContent = message;
    node.append(label);
    if (actionLabel && typeof onAction === 'function') {
      const action = document.createElement('button');
      action.type = 'button';
      action.textContent = actionLabel;
      action.addEventListener('click', () => {
        onAction();
        dismiss();
      });
      node.append(action);
    }
    const dismiss = () => {
      node.classList.add('leaving');
      window.setTimeout(() => node.remove(), 260);
    };
    toastRegion.append(node);
    window.setTimeout(dismiss, duration);
  }

  /* --------------------------- focus helpers ----------------------------- */
  const focusableSelector = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  function trapFocus(container) {
    const onKeydown = event => {
      if (event.key !== 'Tab') return;
      const items = $$(focusableSelector, container).filter(element => element.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    container.addEventListener('keydown', onKeydown);
    return () => container.removeEventListener('keydown', onKeydown);
  }

  let scrollLockCount = 0;
  const lockScroll = () => {
    scrollLockCount += 1;
    document.body.classList.add('no-scroll');
  };
  const unlockScroll = () => {
    scrollLockCount = Math.max(0, scrollLockCount - 1);
    if (!scrollLockCount) document.body.classList.remove('no-scroll');
  };

  /* ------------------------------ reveal --------------------------------- */
  let revealObserver = null;
  if ('IntersectionObserver' in window && !reduceMotion()) {
    revealObserver = new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('in');
          revealObserver.unobserve(entry.target);
        });
      },
      { threshold: 0.08, rootMargin: '0px 0px -6% 0px' }
    );
  }
  function reveal(nodes) {
    const list = nodes instanceof Element ? [nodes] : Array.from(nodes || []);
    list.forEach(node => {
      if (!node) return;
      node.classList.add('reveal');
      if (revealObserver) revealObserver.observe(node);
      else node.classList.add('in');
    });
  }

  /* ------------------------------ header --------------------------------- */
  const header = $('#site-header');
  const menu = $('#mobile-menu');
  const menuToggle = $('#menu-toggle');
  let menuOpen = false;
  let releaseMenuTrap = null;

  function setMenu(open) {
    if (!menu || !menuToggle) return;
    menuOpen = open;
    menu.classList.toggle('open', open);
    menu.setAttribute('aria-hidden', String(!open));
    menuToggle.setAttribute('aria-expanded', String(open));
    menuToggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    if (open) {
      lockScroll();
      releaseMenuTrap = trapFocus(menu);
      const firstLink = $('a', menu);
      if (firstLink) firstLink.focus({ preventScroll: true });
    } else {
      if (releaseMenuTrap) releaseMenuTrap();
      releaseMenuTrap = null;
      unlockScroll();
    }
  }

  menuToggle?.addEventListener('click', () => setMenu(!menuOpen));
  $$('#mobile-menu a').forEach(link => link.addEventListener('click', () => setMenu(false)));

  let ticking = false;
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(() => {
      header?.classList.toggle('scrolled', window.scrollY > 18);
      ticking = false;
    });
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // Scroll spy for the desktop navigation.
  const navLinks = $$('[data-nav]');
  const sectionsForNav = navLinks
    .map(link => ({ link, section: $(link.getAttribute('href')) }))
    .filter(entry => entry.section);
  if ('IntersectionObserver' in window && sectionsForNav.length) {
    const spy = new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;
          sectionsForNav.forEach(({ link, section }) => {
            if (section === entry.target) link.setAttribute('aria-current', 'true');
            else link.removeAttribute('aria-current');
          });
        });
      },
      { rootMargin: '-45% 0px -50% 0px', threshold: 0 }
    );
    sectionsForNav.forEach(({ section }) => spy.observe(section));
  }

  /* ------------------------------- hero ---------------------------------- */
  const heroList = $('#hero-list');
  if (heroList && config.services.length) {
    heroList.innerHTML = config.services
      .slice(0, 4)
      .map(
        (service, index) =>
          `<li><span>${escapeHtml(text(service.number, 4) || String(index + 1).padStart(2, '0'))}</span>${escapeHtml(
            text(service.name, 60) || 'Studio service'
          )}</li>`
      )
      .join('');
  }

  const availability = $('#availability');
  if (availability) {
    const value = availability.querySelector('span');
    if (value) value.textContent = config.availability || value.textContent;
    availability.hidden = !config.availability;
  }
  const responseTime = $('#response-time');
  if (responseTime) {
    if (config.responseTime) responseTime.textContent = config.responseTime;
    responseTime.hidden = !config.responseTime;
  }

  if (config.signals.length) {
    const strip = $('.signal-strip');
    if (strip) {
      strip.innerHTML = config.signals
        .slice(0, 4)
        .map(
          signal =>
            `<div class="signal-item"><b>${escapeHtml(text(signal.value, 12))}${
              signal.unit ? `<span>${escapeHtml(text(signal.unit, 8))}</span>` : ''
            }</b><small>${escapeHtml(text(signal.label, 40))}</small></div>`
        )
        .join('');
    }
  }

  /* ------------------------------ services -------------------------------- */
  const serviceRoot = $('#service-grid');
  if (serviceRoot) {
    if (config.services.length) {
      serviceRoot.innerHTML = config.services
        .map(
          (service, index) => `<article class="service-card">
            <span class="service-number">${escapeHtml(text(service.number, 4) || String(index + 1).padStart(2, '0'))}</span>
            <span class="service-glyph" aria-hidden="true">${escapeHtml(text(service.glyph, 2) || '◈')}</span>
            <h3>${escapeHtml(text(service.name, 60) || 'Studio service')}</h3>
            <p>${escapeHtml(text(service.description, 400))}</p>
            ${
              service.inquiry
                ? `<button class="service-cta" type="button" data-inquiry="${escapeHtml(text(service.inquiry, 60))}">Start an inquiry <span aria-hidden="true">↗</span></button>`
                : ''
            }
          </article>`
        )
        .join('');
    } else {
      serviceRoot.innerHTML = `<article class="service-card"><h3>Services on request</h3><p>Send the brief and the studio will reply with scope, timeline and price.</p></article>`;
    }
  }

  /* --------------------------- channels & embeds -------------------------- */
  const socialNames = { instagram: 'Instagram', soundcloud: 'SoundCloud', spotify: 'Spotify', youtube: 'YouTube' };

  function renderChannels() {
    const entries = Object.entries(config.socials)
      .map(([key, value]) => [key, safeUrl(value)])
      .filter(([, url]) => url);
    const channelRoot = $('#channel-links');
    const socialRoot = $('#social-list');

    if (channelRoot) {
      channelRoot.innerHTML = entries
        .map(
          ([key, url]) =>
            `<a class="channel-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(
              socialNames[key] || key
            )} <span aria-hidden="true">↗</span></a>`
        )
        .join('');
    }

    if (socialRoot) {
      const links = entries.map(
        ([key, url]) =>
          `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(socialNames[key] || key)} ↗</a>`
      );
      if (config.contactEmail) {
        links.push(`<a href="mailto:${escapeHtml(config.contactEmail)}">Email ↗</a>`);
      }
      if (config.whatsapp) {
        links.push(
          `<a href="https://wa.me/${escapeHtml(config.whatsapp.replace(/\D/g, ''))}" target="_blank" rel="noopener noreferrer">WhatsApp ↗</a>`
        );
      }
      socialRoot.innerHTML = links.join('');
    }

    const footSocial = $('#social-list-foot');
    if (footSocial) {
      footSocial.innerHTML = entries
        .map(
          ([key, url]) =>
            `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(
              socialNames[key] || key
            )} ↗</a>`
        )
        .join('');
    }

    const foot = $('#mobile-menu-foot');
    if (foot) {
      foot.textContent = config.contactEmail ? config.contactEmail : '';
    }
  }

  function renderFeatured() {
    const root = $('#featured-embeds');
    if (!root) return;
    const definitions = [
      ['soundcloud', 'SoundCloud', 'Tracks / playlists', config.featured.soundcloud],
      ['spotify', 'Spotify', 'Releases / playlists', config.featured.spotify],
      ['youtube', 'YouTube', 'Videos / sessions', config.featured.youtube]
    ];
    const active = definitions.filter(([type, , , url]) => toEmbed(type, url));

    if (!active.length) {
      const hasChannels = Object.values(config.socials).some(url => safeUrl(url));
      root.innerHTML = `<article class="embed-card is-empty">
        <div class="embed-head"><strong>Listening room</strong><span>Direct channels</span></div>
        <div class="embed-placeholder">
          <b>${hasChannels ? 'Follow the channels' : 'Private listening on request'}</b>
          <small>${
            hasChannels
              ? 'New releases and previews are published on the studio channels.'
              : 'Ask for a private link to recent work, or book a listening session with the studio.'
          }</small>
        </div>
      </article>`;
      return;
    }

    root.innerHTML = active
      .map(
        ([type, label, subtitle, url]) => `<article class="embed-card">
          <div class="embed-head"><strong>${label}</strong><span>${subtitle}</span></div>
          <iframe class="embed-frame" src="${escapeHtml(toEmbed(type, url))}" title="${label} player" loading="lazy"
            allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
            referrerpolicy="strict-origin-when-cross-origin"></iframe>
        </article>`
      )
      .join('');
  }

  /* ----------------------------- portfolio -------------------------------- */
  const trackRoot = $('#track-list');
  const filterRoot = $('#track-filters');
  const searchInput = $('#track-search');
  const trackStatus = $('#track-status');

  const tracks = config.tracks
    .map((track, index) => {
      const type = ['audio', 'soundcloud', 'spotify', 'youtube'].includes(track?.type) ? track.type : 'audio';
      const src = safeUrl(track?.src);
      const playable = type === 'audio' && src;
      const embed = type === 'audio' ? '' : toEmbed(type, src);
      const artwork = safeUrl(track?.artwork);
      return {
        id: `track-${index}`,
        index,
        title: text(track?.title, 120) || `Untitled ${index + 1}`,
        category: text(track?.category, 40),
        description: text(track?.description, 240),
        note: text(track?.note, 160),
        bpm: Number.isFinite(Number(track?.bpm)) && Number(track?.bpm) > 0 ? Math.round(Number(track.bpm)) : null,
        genre: text(track?.genre, 40),
        musicalKey: text(track?.key, 16),
        featured: track?.featured === true,
        playable: Boolean(playable),
        src: playable ? src : '',
        embed: embed || '',
        artwork: artwork || '',
        categoryLabel: text(track?.category, 40) || 'Audio'
      };
    })
    .filter(track => track.src || track.embed)
    .sort((a, b) => Number(b.featured) - Number(a.featured) || a.index - b.index)
    .map((track, index) => ({ ...track, position: index }));

  const portfolio = { category: 'All', query: '' };
  let activeAudio = null;
  let activeRow = null;
  let activeButton = null;

  function buildFilters() {
    if (!filterRoot) return;
    const categories = ['All', ...new Set(tracks.map(track => track.categoryLabel).filter(Boolean))];
    filterRoot.innerHTML = categories
      .map(
        category =>
          `<button type="button" class="filter-chip" data-filter="${escapeHtml(category)}" aria-pressed="${
            portfolio.category === category ? 'true' : 'false'
          }">${escapeHtml(category)}</button>`
      )
      .join('');
  }

  function visibleTracks() {
    const query = portfolio.query.toLowerCase();
    return tracks.filter(track => {
      const categoryOk = portfolio.category === 'All' || track.categoryLabel === portfolio.category;
      if (!categoryOk) return false;
      if (!query) return true;
      return [track.title, track.category, track.genre, track.musicalKey, track.description, track.note]
        .join(' ')
        .toLowerCase()
        .includes(query);
    });
  }

  function stopAudio() {
    if (activeAudio) {
      activeAudio.pause();
      activeAudio.removeAttribute('src');
      activeAudio.load();
      activeAudio = null;
    }
    if (activeButton) {
      activeButton.innerHTML = playIcon('Play');
      activeButton.setAttribute('aria-label', `Play ${activeRow?.dataset.title || 'track'}`);
    }
    if (activeRow) {
      activeRow.classList.remove('is-playing');
      const player = $('.track-player', activeRow);
      if (player) player.hidden = true;
    }
    activeRow = null;
    activeButton = null;
  }

  const playIcon = label =>
    `<svg viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M2 1.4v9.2L10.4 6z"/></svg><span class="btn-text">${label}</span>`;
  const pauseIcon = label =>
    `<svg viewBox="0 0 12 12" aria-hidden="true" focusable="false"><rect x="2" y="1.6" width="2.6" height="8.8"/><rect x="7.4" y="1.6" width="2.6" height="8.8"/></svg><span class="btn-text">${label}</span>`;

  function trackMarkup(track) {
    const badges = [];
    if (track.featured) badges.push('<span class="track-badge featured">Featured</span>');
    if (track.bpm) badges.push(`<span class="track-badge">${track.bpm} BPM</span>`);
    if (track.genre) badges.push(`<span class="track-badge">${escapeHtml(track.genre)}</span>`);
    if (track.musicalKey) badges.push(`<span class="track-badge">${escapeHtml(track.musicalKey)}</span>`);

    const art = track.artwork
      ? `<span class="track-art"><img src="${escapeHtml(track.artwork)}" alt="" width="52" height="52" loading="lazy" decoding="async"></span>`
      : `<span class="track-art" aria-hidden="true"><span class="track-art-glyph">◈</span></span>`;

    let action = '<span class="track-dead">Preview soon</span>';
    if (track.playable) {
      action = `<button class="track-play" type="button" data-play="${escapeHtml(track.id)}" aria-label="Play ${escapeHtml(
        track.title
      )}">${playIcon('Play')}</button>`;
    } else if (track.embed) {
      action = `<button class="track-play" type="button" data-embed="${escapeHtml(track.id)}" aria-expanded="false" aria-label="Open ${escapeHtml(
        track.title
      )} player">${playIcon('Open')}</button>`;
    }

    const player = track.playable
      ? `<div class="track-expand"><div class="track-player" hidden>
           <div class="track-progress">
             <input class="seek" type="range" min="0" max="1000" value="0" step="1" aria-label="Seek within ${escapeHtml(
               track.title
             )}" disabled>
             <span class="track-time"><b>0:00</b> / <span class="duration">0:00</span></span>
           </div>
           <span class="track-player-error" role="status"></span>
         </div></div>`
      : '';

    const embedPanel = track.embed
      ? `<div class="track-expand"><div class="track-embed" hidden><iframe data-src="${escapeHtml(
          track.embed
        )}" title="${escapeHtml(track.title)} player" loading="lazy" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" referrerpolicy="strict-origin-when-cross-origin"></iframe></div></div>`
      : '';

    const metaParts = [track.note];
    return `<article class="track-row" data-track="${escapeHtml(track.id)}" data-title="${escapeHtml(track.title)}">
      <span class="track-index">${String(track.position + 1).padStart(2, '0')}</span>
      ${art}
      <div class="track-main">
        <h3 class="track-title">${escapeHtml(track.title)}</h3>
        ${metaParts[0] ? `<p class="track-meta">${escapeHtml(track.note)}</p>` : ''}
        ${badges.length ? `<div class="track-badges">${badges.join('')}</div>` : ''}
        ${track.description ? `<p class="track-note">${escapeHtml(track.description)}</p>` : ''}
      </div>
      <span class="track-category">${escapeHtml(track.categoryLabel)}</span>
      <div class="track-actions">${action}</div>
      ${player}${embedPanel}
    </article>`;
  }

  function renderTracks() {
    if (!trackRoot) return;
    if (!tracks.length) {
      $('.portfolio-controls')?.setAttribute('hidden', '');
      trackRoot.innerHTML = `<div class="track-empty">
        <b>No public previews yet.</b>
        <small>Previews appear here once a release is cleared for public listening. In the meantime, ask the studio for a private listening link.</small>
        <a class="text-link" href="#contact">Request a listening link <span aria-hidden="true">↗</span></a>
      </div>`;
      if (trackStatus) trackStatus.textContent = '';
      return;
    }

    const list = visibleTracks();
    if (!list.length) {
      trackRoot.innerHTML = `<div class="track-empty"><b>Nothing matches that search.</b><small>Try another keyword or category.</small></div>`;
      if (trackStatus) trackStatus.textContent = 'No results';
      return;
    }

    stopAudio();
    trackRoot.innerHTML = list.map(trackMarkup).join('');
    reveal($$('.track-row', trackRoot));
    if (trackStatus) {
      trackStatus.textContent = `${list.length} ${list.length === 1 ? 'piece' : 'pieces'}${
        portfolio.category === 'All' ? '' : ` in ${portfolio.category}`
      }${portfolio.query ? ` matching “${portfolio.query}”` : ''}`;
    }
  }

  function bindTrackEvents() {
    if (!trackRoot) return;

    trackRoot.addEventListener('click', event => {
      const playButton = event.target.closest('[data-play]');
      if (playButton) {
        togglePlay(playButton);
        return;
      }
      const embedButton = event.target.closest('[data-embed]');
      if (embedButton) toggleEmbed(embedButton);
    });

    trackRoot.addEventListener('input', event => {
      const seek = event.target.closest('.seek');
      if (!seek || !activeAudio || !activeRow) return;
      const duration = activeAudio.duration;
      if (!Number.isFinite(duration) || duration <= 0) return;
      activeAudio.currentTime = (Number(seek.value) / 1000) * duration;
      updateProgress();
    });

    function updateProgress() {
      if (!activeAudio || !activeRow) return;
      const seek = $('.seek', activeRow);
      const time = $('.track-time b', activeRow);
      const duration = activeAudio.duration;
      if (seek && Number.isFinite(duration) && duration > 0) {
        seek.value = String(Math.round((activeAudio.currentTime / duration) * 1000));
        seek.style.setProperty('--seek-progress', `${(activeAudio.currentTime / duration) * 100}%`);
      }
      if (time) time.textContent = formatTime(activeAudio.currentTime);
    }

    function togglePlay(button) {
      const row = button.closest('.track-row');
      const track = tracks.find(item => item.id === button.dataset.play);
      if (!row || !track || !track.src) return;

      if (activeRow === row && activeAudio) {
        if (activeAudio.paused) {
          activeAudio.play().catch(() => showPlayerError(row, 'Playback was blocked by the browser.'));
        } else {
          activeAudio.pause();
        }
        return;
      }

      stopAudio();

      const audio = new Audio();
      audio.preload = 'metadata';
      audio.src = track.src;
      activeAudio = audio;
      activeRow = row;
      activeButton = button;
      row.classList.add('is-playing');
      button.innerHTML = pauseIcon('Pause');
      button.setAttribute('aria-label', `Pause ${track.title}`);

      const player = $('.track-player', row);
      if (player) player.hidden = false;
      const seek = $('.seek', row);
      const durationLabel = $('.duration', row);
      const errorSlot = $('.track-player-error', row);
      if (errorSlot) errorSlot.textContent = '';

      audio.addEventListener('loadedmetadata', () => {
        if (durationLabel) durationLabel.textContent = formatTime(audio.duration);
        if (seek) seek.disabled = !Number.isFinite(audio.duration) || audio.duration <= 0;
      });
      audio.addEventListener('timeupdate', updateProgress);
      audio.addEventListener('play', () => {
        button.innerHTML = pauseIcon('Pause');
        row.classList.add('is-playing');
      });
      audio.addEventListener('pause', () => {
        if (activeRow !== row) return;
        button.innerHTML = playIcon('Play');
        row.classList.remove('is-playing');
      });
      audio.addEventListener('ended', () => {
        stopAudio();
        if (seek) {
          seek.value = '0';
          seek.style.setProperty('--seek-progress', '0%');
        }
      });
      audio.addEventListener('error', () => {
        showPlayerError(row, 'This preview could not be loaded. The file may be missing or in an unsupported format.');
        stopAudio();
      });

      audio.play().catch(() => {
        showPlayerError(row, 'Playback was blocked. Press play again to start the preview.');
        stopAudio();
      });
    }

    function showPlayerError(row, message) {
      const slot = $('.track-player-error', row);
      const player = $('.track-player', row);
      if (player) player.hidden = false;
      if (slot) slot.textContent = message;
    }

    function toggleEmbed(button) {
      const row = button.closest('.track-row');
      const panel = row ? $('.track-embed', row) : null;
      if (!row || !panel) return;
      const iframe = $('iframe', panel);
      const opening = panel.hidden;

      // Close every other open player so audio never overlaps.
      $$('.track-embed', trackRoot).forEach(other => {
        if (other !== panel) other.hidden = true;
      });
      $$('[data-embed]', trackRoot).forEach(other => {
        if (other !== button) {
          other.setAttribute('aria-expanded', 'false');
          other.innerHTML = playIcon('Open');
        }
      });
      stopAudio();

      if (opening && iframe && !iframe.getAttribute('src')) {
        const src = iframe.getAttribute('data-src');
        if (src) iframe.setAttribute('src', src);
      }
      panel.hidden = !opening;
      button.setAttribute('aria-expanded', String(opening));
      button.innerHTML = opening ? pauseIcon('Close') : playIcon('Open');
    }
  }

  if (tracks.length) {
    buildFilters();
    renderTracks();
    bindTrackEvents();

    filterRoot?.addEventListener('click', event => {
      const chip = event.target.closest('[data-filter]');
      if (!chip) return;
      portfolio.category = chip.dataset.filter || 'All';
      $$('[data-filter]', filterRoot).forEach(button => {
        button.setAttribute('aria-pressed', String(button === chip));
      });
      renderTracks();
    });

    let searchTimer = 0;
    searchInput?.addEventListener('input', () => {
      window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(() => {
        portfolio.query = text(searchInput.value, 60);
        renderTracks();
      }, 140);
    });
  } else {
    renderTracks();
  }

  /* -------------------------------- store --------------------------------- */
  const storeRoot = $('#store-grid');
  const CART_KEY = 'kal-cart-v3';
  let products = [];
  let catalogState = 'loading';
  let cart = readCart();

  function readCart() {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(CART_KEY) || '{}');
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      return parsed;
    } catch {
      return {};
    }
  }

  function writeCart() {
    try {
      window.localStorage.setItem(CART_KEY, JSON.stringify(cart));
    } catch {
      /* storage may be blocked (private mode); the bag still works for this page */
    }
  }

  const productById = id => products.find(product => product.id === id);
  const cartRows = () =>
    Object.entries(cart)
      .map(([id, quantity]) => {
        const product = productById(id);
        const qty = Math.max(0, Math.min(10, Number(quantity) || 0));
        return product && qty > 0 ? { product, qty } : null;
      })
      .filter(Boolean);
  const cartCount = () => cartRows().reduce((sum, row) => sum + row.qty, 0);
  const cartTotal = () => cartRows().reduce((sum, row) => sum + row.product.priceMinor * row.qty, 0);

  function productMarkup(product, index) {
    const tags = (product.tags || []).slice(0, 4);
    const contents = (product.contents || []).slice(0, 4);
    const art = product.image
      ? `<div class="product-art"><img src="${escapeHtml(product.image)}" alt="" loading="lazy" decoding="async"><span class="product-index">KAL / PACK ${String(
          index + 1
        ).padStart(2, '0')}</span><span class="product-format">${escapeHtml(product.format)}</span></div>`
      : `<div class="product-art"><span class="product-index">KAL / PACK ${String(index + 1).padStart(
          2,
          '0'
        )}</span><span class="product-glyph" aria-hidden="true">${escapeHtml(product.glyph || '◈')}</span><span class="product-format">${escapeHtml(
          product.format
        )}</span></div>`;

    const preview = product.previewUrl
      ? `<button class="preview-button" type="button" data-preview="${escapeHtml(product.id)}" aria-pressed="false" aria-label="Play preview of ${escapeHtml(
          product.name
        )}"><span aria-hidden="true">▷</span></button>`
      : '';

    const price = product.compareAtMinor
      ? `<strong>${escapeHtml(money(product.priceMinor, product.currency))}</strong><s>${escapeHtml(
          money(product.compareAtMinor, product.currency)
        )}</s>`
      : `<strong>${escapeHtml(money(product.priceMinor, product.currency))}</strong>`;

    return `<article class="product-card" data-product="${escapeHtml(product.id)}" data-tilt>
      ${art}
      <div class="product-info">
        <h3 class="product-name">${escapeHtml(product.name)}</h3>
        ${product.description ? `<p class="product-description">${escapeHtml(product.description)}</p>` : ''}
        ${contents.length ? `<ul class="product-contents">${contents.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : ''}
        ${tags.length ? `<div class="product-tags">${tags.map(tag => `<span>${escapeHtml(tag)}</span>`).join('')}</div>` : ''}
      </div>
      <div class="product-foot">
        <span class="product-price">${price}</span>
        <span class="product-actions">
          ${preview}
          <button class="add-button" type="button" data-add="${escapeHtml(product.id)}" aria-label="Add ${escapeHtml(
            product.name
          )} to bag">Add to bag +</button>
        </span>
      </div>
    </article>`;
  }

  function renderStore() {
    if (!storeRoot) return;
    if (catalogState === 'loading') {
      storeRoot.innerHTML = `<div class="store-state"><span class="loader" aria-hidden="true"></span><span>Opening the sample vault…</span></div>`;
      return;
    }
    if (catalogState === 'error') {
      storeRoot.innerHTML = `<div class="store-state">
        <b>The store could not be loaded.</b>
        <small>The catalogue service did not respond. Nothing has been charged. Try again, or contact the studio for a direct order.</small>
        <button class="button retry" type="button" data-retry-store>Try again <span aria-hidden="true">↻</span></button>
      </div>`;
      return;
    }
    if (!products.length) {
      storeRoot.innerHTML = `<div class="store-state">
        <b>No packs are on sale right now.</b>
        <small>Packs appear here only once a real product, price and private download file are configured. Commission a custom kit or ask about upcoming releases.</small>
        <a class="text-link" href="#contact">Commission a pack <span aria-hidden="true">↗</span></a>
      </div>`;
      return;
    }
    storeRoot.innerHTML = products.map(productMarkup).join('');
    reveal($$('.product-card', storeRoot));
    bindTilt();
  }

  function bindTilt() {
    if (!finePointer() || reduceMotion()) return;
    $$('[data-tilt]').forEach(card => {
      if (card.dataset.tiltBound) return;
      card.dataset.tiltBound = '1';
      let frame = 0;
      card.addEventListener('pointermove', event => {
        if (frame) return;
        frame = window.requestAnimationFrame(() => {
          const rect = card.getBoundingClientRect();
          const x = (event.clientX - rect.left) / rect.width - 0.5;
          const y = (event.clientY - rect.top) / rect.height - 0.5;
          card.style.transform = `perspective(900px) rotateX(${(-y * 5).toFixed(2)}deg) rotateY(${(x * 6).toFixed(
            2
          )}deg) translateY(-5px)`;
          frame = 0;
        });
      });
      card.addEventListener('pointerleave', () => {
        card.style.transform = '';
      });
    });
  }

  async function loadCatalog() {
    catalogState = 'loading';
    renderStore();
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch('/api/catalog', { headers: { Accept: 'application/json' }, signal: controller.signal });
      if (!response.ok) throw new Error(`Catalogue responded ${response.status}`);
      const data = await response.json();
      products = Array.isArray(data.products) ? data.products : [];
      catalogState = 'ready';
    } catch (error) {
      console.warn('[KAL] catalogue unavailable:', error.message);
      catalogState = 'error';
      products = [];
    } finally {
      window.clearTimeout(timeout);
      // Drop bag entries that no longer exist in the catalogue.
      let changed = false;
      Object.keys(cart).forEach(id => {
        if (!productById(id)) {
          delete cart[id];
          changed = true;
        }
      });
      if (changed) writeCart();
      renderStore();
      renderCart();
    }
  }

  /* --------------------------------- cart --------------------------------- */
  const drawer = $('#cart-drawer');
  const drawerBackdrop = $('#drawer-backdrop');
  const cartLines = $('#cart-lines');
  const cartCountEl = $('#cart-count');
  const cartCountSr = $('#cart-count-sr');
  const cartTotalEl = $('#cart-total');
  const checkoutTrigger = $('#checkout-open');
  const cartTrigger = $('#cart-open');
  let releaseCartTrap = null;

  function renderCart() {
    const rows = cartRows();
    const count = rows.reduce((sum, row) => sum + row.qty, 0);

    if (cartCountEl) {
      cartCountEl.textContent = String(count);
      cartCountEl.dataset.visible = count > 0 ? 'true' : 'false';
    }
    if (cartCountSr) cartCountSr.textContent = `${count} ${count === 1 ? 'item' : 'items'} in bag`;

    if (cartLines) {
      if (!rows.length) {
        cartLines.innerHTML = `<div class="cart-empty">
          <b>Your bag is empty.</b>
          <span>Find your next sound in the sample vault.</span>
          <a class="text-link" href="#store" data-close-cart>Browse packs <span aria-hidden="true">↗</span></a>
        </div>`;
      } else {
        cartLines.innerHTML = rows
          .map(
            ({ product, qty }) => `<div class="cart-line" data-id="${escapeHtml(product.id)}">
              <div>
                <div class="cart-line-title">${escapeHtml(product.name)}</div>
                <div class="cart-line-price">${escapeHtml(money(product.priceMinor, product.currency))} each</div>
                <div class="cart-line-sub">${escapeHtml(product.format)} · licences included</div>
              </div>
              <div class="qty-control">
                <button type="button" data-dec="${escapeHtml(product.id)}" aria-label="Decrease ${escapeHtml(
                  product.name
                )} quantity" ${qty <= 1 ? 'disabled' : ''}>−</button>
                <span aria-live="polite">${qty}</span>
                <button type="button" data-inc="${escapeHtml(product.id)}" aria-label="Increase ${escapeHtml(
                  product.name
                )} quantity" ${qty >= 10 ? 'disabled' : ''}>+</button>
              </div>
              <button class="remove-line" type="button" data-remove="${escapeHtml(product.id)}">Remove</button>
            </div>`
          )
          .join('');
      }
    }

    if (cartTotalEl) {
      cartTotalEl.textContent = rows.length ? money(cartTotal(), rows[0].product.currency) : '—';
    }
    if (checkoutTrigger) checkoutTrigger.disabled = !rows.length;
    updateCheckoutSummary();
  }

  function changeQuantity(id, delta) {
    const next = Math.max(0, Math.min(10, (Number(cart[id]) || 0) + delta));
    if (next < 1) delete cart[id];
    else cart[id] = next;
    writeCart();
    renderCart();
  }

  function addToCart(id) {
    const product = productById(id);
    if (!product) return;
    const current = Number(cart[id]) || 0;
    if (current >= 10) {
      toast('That pack is already at the maximum quantity of 10.', { type: 'error' });
      return;
    }
    cart[id] = current + 1;
    writeCart();
    renderCart();
    if (cartCountEl) {
      cartCountEl.classList.remove('bump');
      void cartCountEl.offsetWidth;
      cartCountEl.classList.add('bump');
    }
    toast(`${product.name} added to your bag.`, {
      type: 'success',
      actionLabel: 'View bag',
      onAction: () => openCart()
    });
  }

  function openCart() {
    if (!drawer) return;
    renderCart();
    drawer.classList.add('open');
    drawer.removeAttribute('inert');
    drawer.setAttribute('aria-hidden', 'false');
    if (drawerBackdrop) {
      drawerBackdrop.hidden = false;
      drawerBackdrop.classList.add('open');
    }
    lockScroll();
    releaseCartTrap = trapFocus(drawer);
    drawer.focus({ preventScroll: true });
  }

  function closeCart({ restoreFocus = true } = {}) {
    if (!drawer || !drawer.classList.contains('open')) return;
    drawer.classList.remove('open');
    drawer.setAttribute('inert', '');
    drawer.setAttribute('aria-hidden', 'true');
    if (drawerBackdrop) {
      drawerBackdrop.classList.remove('open');
      drawerBackdrop.hidden = true;
    }
    if (releaseCartTrap) releaseCartTrap();
    releaseCartTrap = null;
    unlockScroll();
    if (restoreFocus) cartTrigger?.focus({ preventScroll: true });
  }

  cartTrigger?.addEventListener('click', openCart);
  $('#cart-close')?.addEventListener('click', () => closeCart());
  drawerBackdrop?.addEventListener('click', () => closeCart());

  let previewAudio = null;
  let previewButton = null;

  function stopPreview() {
    if (previewAudio) {
      previewAudio.pause();
      previewAudio.removeAttribute('src');
      previewAudio.load();
      previewAudio = null;
    }
    if (previewButton) {
      previewButton.setAttribute('aria-pressed', 'false');
      previewButton.innerHTML = '<span aria-hidden="true">▷</span>';
    }
    previewButton = null;
  }

  function togglePreview(button) {
    const product = productById(button.dataset.preview);
    if (!product || !product.previewUrl) return;
    if (previewButton === button) {
      stopPreview();
      return;
    }
    stopAudio();
    stopPreview();
    const audio = new Audio(product.previewUrl);
    audio.preload = 'metadata';
    previewAudio = audio;
    previewButton = button;
    button.setAttribute('aria-pressed', 'true');
    button.innerHTML = '<span aria-hidden="true">❚❚</span>';
    audio.addEventListener('ended', stopPreview);
    audio.addEventListener('error', () => {
      stopPreview();
      toast('That preview could not be loaded.', { type: 'error' });
    });
    audio.play().catch(() => {
      stopPreview();
      toast('Playback was blocked by the browser.', { type: 'error' });
    });
  }

  storeRoot?.addEventListener('click', event => {
    const preview = event.target.closest('[data-preview]');
    if (preview) return togglePreview(preview);
    const addButton = event.target.closest('[data-add]');
    if (addButton) {
      addToCart(addButton.dataset.add);
      const original = addButton.textContent;
      addButton.textContent = 'Added ✓';
      addButton.classList.add('is-added');
      window.setTimeout(() => {
        if (!addButton.isConnected) return;
        addButton.textContent = original;
        addButton.classList.remove('is-added');
      }, 1200);
      return;
    }
    const retry = event.target.closest('[data-retry-store]');
    if (retry) loadCatalog();
  });

  cartLines?.addEventListener('click', event => {
    const inc = event.target.closest('[data-inc]');
    if (inc) return changeQuantity(inc.dataset.inc, 1);
    const dec = event.target.closest('[data-dec]');
    if (dec) return changeQuantity(dec.dataset.dec, -1);
    const remove = event.target.closest('[data-remove]');
    if (remove) {
      const product = productById(remove.dataset.remove);
      delete cart[remove.dataset.remove];
      writeCart();
      renderCart();
      if (product) toast(`${product.name} removed from your bag.`);
      return;
    }
    if (event.target.closest('[data-close-cart]')) closeCart({ restoreFocus: false });
  });

  /* ------------------------------- checkout -------------------------------- */
  const checkoutBackdrop = $('#checkout-backdrop');
  const checkoutForm = $('#checkout-form');
  const checkoutStatus = $('#checkout-status');
  const checkoutSummary = $('#checkout-summary');
  const payButton = $('#pay-button');
  let checkoutBusy = false;
  let releaseCheckoutTrap = null;
  let checkoutOpener = null;

  function updateCheckoutSummary() {
    if (!checkoutSummary) return;
    const rows = cartRows();
    checkoutSummary.innerHTML = rows.length
      ? `${rows
          .map(
            row =>
              `<div class="checkout-summary-line"><span>${escapeHtml(row.product.name)} × ${row.qty}</span><strong>${escapeHtml(
                money(row.product.priceMinor * row.qty, row.product.currency)
              )}</strong></div>`
          )
          .join('')}
         <div class="checkout-summary-total"><span>Total</span><span>${escapeHtml(
           money(cartTotal(), rows[0].product.currency)
         )}</span></div>`
      : '';
  }

  function openCheckout() {
    if (!checkoutBackdrop || !cartRows().length) return;
    checkoutOpener = document.activeElement;
    closeCart({ restoreFocus: false });
    checkoutBackdrop.hidden = false;
    checkoutBackdrop.classList.add('open');
    updateCheckoutSummary();
    lockScroll();
    releaseCheckoutTrap = trapFocus(checkoutForm);
    if (checkoutStatus) {
      checkoutStatus.textContent = '';
      checkoutStatus.className = 'form-status';
    }
    const firstInput = $('input', checkoutForm);
    window.setTimeout(() => firstInput?.focus({ preventScroll: true }), 120);
  }

  function closeCheckout({ restoreFocus = true } = {}) {
    if (!checkoutBackdrop) return;
    checkoutBackdrop.classList.remove('open');
    checkoutBackdrop.hidden = true;
    if (releaseCheckoutTrap) releaseCheckoutTrap();
    releaseCheckoutTrap = null;
    unlockScroll();
    if (restoreFocus && checkoutOpener instanceof HTMLElement) checkoutOpener.focus({ preventScroll: true });
  }

  checkoutTrigger?.addEventListener('click', openCheckout);
  $('#checkout-close')?.addEventListener('click', () => closeCheckout());
  checkoutBackdrop?.addEventListener('click', event => {
    if (event.target === checkoutBackdrop) closeCheckout();
  });

  $('#checkout-form input[name="phone"]')?.addEventListener('input', event => {
    // Keep formatting friendly but never strip a leading +.
    event.target.value = event.target.value.replace(/[^\d+\s()-]/g, '');
  });

  checkoutForm?.addEventListener('submit', async event => {
    event.preventDefault();
    if (checkoutBusy) return;

    const items = cartRows().map(row => ({ id: row.product.id, quantity: row.qty }));
    if (!items.length) {
      closeCheckout();
      return;
    }

    const formData = new FormData(checkoutForm);
    const customer = {
      name: text(formData.get('name'), 120),
      email: String(formData.get('email') || '').trim(),
      phone: String(formData.get('phone') || '').trim()
    };

    const fields = {
      name: $('input[name="name"]', checkoutForm),
      email: $('input[name="email"]', checkoutForm),
      phone: $('input[name="phone"]', checkoutForm)
    };
    const problems = [];
    if (customer.name.length < 2) problems.push(['name', 'Enter the name for the order.']);
    if (!EMAIL_RE.test(customer.email)) problems.push(['email', 'Enter a valid email address.']);
    if (customer.phone.replace(/\D/g, '').length < 8) problems.push(['phone', 'Enter a phone number with country code.']);

    Object.entries(fields).forEach(([key, element]) => {
      if (!element) return;
      if (problems.some(([field]) => field === key)) element.setAttribute('aria-invalid', 'true');
      else element.removeAttribute('aria-invalid');
    });

    if (problems.length) {
      checkoutStatus.textContent = problems[0][1];
      checkoutStatus.className = 'form-status error';
      fields[problems[0][0]]?.focus();
      return;
    }

    checkoutBusy = true;
    payButton.disabled = true;
    payButton.setAttribute('aria-busy', 'true');
    const label = $('.button-label', payButton);
    if (label) label.textContent = 'Starting secure checkout…';
    checkoutStatus.textContent = 'Creating your payment session…';
    checkoutStatus.className = 'form-status pending';

    try {
      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ items, customer })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.checkoutUrl) {
        throw new Error(data.error || 'Checkout could not be started. Please try again.');
      }
      const checkoutUrl = safeUrl(data.checkoutUrl);
      if (!checkoutUrl) throw new Error('The payment provider returned an invalid checkout link.');
      checkoutStatus.textContent = 'Redirecting to secure payment…';
      window.location.assign(checkoutUrl);
    } catch (error) {
      checkoutStatus.textContent = error.message;
      checkoutStatus.className = 'form-status error';
      checkoutBusy = false;
      payButton.disabled = false;
      payButton.removeAttribute('aria-busy');
      if (label) label.textContent = 'Continue to Paymob';
    }
  });

  /* -------------------------------- contact -------------------------------- */
  const contactForm = $('#contact-form');
  const contactStatus = $('#contact-status');
  const serviceSelect = $('#contact-service');
  let turnstileToken = '';

  if (serviceSelect) {
    serviceSelect.innerHTML = `<option value="">Select a service</option>${config.inquiryOptions
      .map(option => `<option value="${escapeHtml(option)}">${escapeHtml(option)}</option>`)
      .join('')}`;
  }

  function setFormStatus(element, message, state = '') {
    if (!element) return;
    element.textContent = message;
    element.className = `form-status${state ? ` ${state}` : ''}`;
  }

  contactForm?.addEventListener('submit', async event => {
    event.preventDefault();
    const submitButton = $('button[type="submit"]', contactForm);
    const formData = new FormData(contactForm);
    const payload = {
      name: text(formData.get('name'), 100),
      email: String(formData.get('email') || '').trim(),
      service: String(formData.get('service') || ''),
      message: String(formData.get('message') || '').trim(),
      website: String(formData.get('website') || ''),
      turnstileToken
    };

    const problems = [];
    if (payload.name.length < 2) problems.push(['name', 'Please tell us your name.']);
    if (!EMAIL_RE.test(payload.email)) problems.push(['email', 'Enter a valid email address.']);
    if (!payload.service) problems.push(['service', 'Choose the service you need.']);
    if (payload.message.length < 10) problems.push(['message', 'Add a little more detail (at least 10 characters).']);

    ['name', 'email', 'service', 'message'].forEach(name => {
      const field = contactForm.elements.namedItem(name);
      if (!field) return;
      if (problems.some(([key]) => key === name)) field.setAttribute('aria-invalid', 'true');
      else field.removeAttribute('aria-invalid');
    });

    if (problems.length) {
      setFormStatus(contactStatus, problems[0][1], 'error');
      contactForm.elements.namedItem(problems[0][0])?.focus();
      return;
    }
    if (config.turnstileSiteKey && !turnstileToken) {
      setFormStatus(contactStatus, 'Please complete the spam check, or email the studio directly.', 'error');
      return;
    }

    if (submitButton) submitButton.disabled = true;
    setFormStatus(contactStatus, 'Sending your inquiry…', 'pending');

    try {
      const response = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'The message could not be sent.');
      setFormStatus(contactStatus, 'Inquiry sent. Thank you — you will hear back within 1–2 business days.');
      contactForm.reset();
      turnstileToken = '';
      if (window.turnstile && typeof window.turnstile.reset === 'function') window.turnstile.reset();
      toast('Your inquiry is on its way.', { type: 'success' });
    } catch (error) {
      setFormStatus(contactStatus, error.message, 'error');
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  });

  // Service cards can pre-select the inquiry type and scroll to the form.
  $('#service-grid')?.addEventListener('click', event => {
    const button = event.target.closest('[data-inquiry]');
    if (!button) return;
    const value = button.dataset.inquiry || '';
    if (serviceSelect) {
      const exists = Array.from(serviceSelect.options).some(option => option.value === value);
      serviceSelect.value = exists ? value : '';
      if (!exists) serviceSelect.focus();
      else serviceSelect.dispatchEvent(new Event('change', { bubbles: true }));
    }
    $('#contact')?.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' });
    window.setTimeout(() => {
      const message = contactForm?.elements.namedItem('message');
      if (existsOption(value)) message?.focus({ preventScroll: true });
    }, 420);

    function existsOption(candidate) {
      return Boolean(candidate) && Array.from(serviceSelect?.options || []).some(option => option.value === candidate);
    }
  });

  // Optional Turnstile widget (only loads when a site key is configured).
  if (config.turnstileSiteKey) {
    const slot = $('#turnstile-slot');
    const loadWidget = () => {
      if (!slot || !window.turnstile) return;
      try {
        window.turnstile.render(slot, {
          sitekey: config.turnstileSiteKey,
          theme: 'dark',
          callback: token => {
            turnstileToken = token;
          },
          'expired-callback': () => {
            turnstileToken = '';
          },
          'error-callback': () => {
            turnstileToken = '';
          }
        });
      } catch (error) {
        console.warn('[KAL] Turnstile could not render:', error);
      }
    };
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.defer = true;
    script.addEventListener('load', loadWidget);
    script.addEventListener('error', () => {
      if (slot) slot.innerHTML = '<p class="form-legal">The spam check could not load. Email the studio directly if the form will not send.</p>';
    });
    document.head.append(script);
  }

  /* --------------------------------- global -------------------------------- */
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if (checkoutBackdrop?.classList.contains('open')) {
      closeCheckout();
      return;
    }
    if (drawer?.classList.contains('open')) {
      closeCart();
      return;
    }
    if (menuOpen) setMenu(false);
  });

  // Close the mobile menu if the viewport grows past the breakpoint.
  const desktopQuery = mediaQuery('(min-width: 901px)');
  const onBreakpoint = event => {
    if (event.matches && menuOpen) setMenu(false);
  };
  if (typeof desktopQuery.addEventListener === 'function') desktopQuery.addEventListener('change', onBreakpoint);

  const copyright = $('#copyright');
  if (copyright) copyright.textContent = `© ${new Date().getFullYear()} Keemz Audio Lab`;

  const licensingLink = $('#licensing-link');
  if (licensingLink && config.licensingUrl) licensingLink.setAttribute('href', config.licensingUrl);

  if (config.storeNote) {
    const note = $('#store-note');
    if (note) note.textContent = config.storeNote;
  }

  renderChannels();
  renderFeatured();
  renderCart();
  loadCatalog();

  /* --------------------------- atmosphere ---------------------------------
     Small, cheap flourishes. Everything here is decorative, transform-only,
     and disabled for touch pointers and reduced-motion users. */
  (function atmosphere() {
    // Seamless marquee: duplicate the strip so a -50% translate loops cleanly.
    const ticker = $('#ticker');
    if (ticker && !ticker.dataset.ready) {
      ticker.dataset.ready = '1';
      ticker.innerHTML += ticker.innerHTML;
    }

    // Scroll progress rail.
    const rail = $('#scroll-progress');
    if (rail) {
      let queued = 0;
      const paint = () => {
        queued = 0;
        const max = document.documentElement.scrollHeight - window.innerHeight;
        rail.style.width = `${max > 0 ? Math.min(100, (window.scrollY / max) * 100).toFixed(2) : 0}%`;
      };
      const schedule = () => {
        if (!queued) queued = window.requestAnimationFrame(paint);
      };
      window.addEventListener('scroll', schedule, { passive: true });
      window.addEventListener('resize', schedule, { passive: true });
      paint();
    }

    // Location, only when the studio configured one.
    const locationSlot = $('[data-location]');
    if (locationSlot && config.location) {
      locationSlot.textContent = `${locationSlot.textContent} — ${config.location}`;
    }

    // Hero footnote: real counts, never invented numbers.
    const heroMeta = $('#hero-meta');
    if (heroMeta) {
      const bits = [];
      const count = config.tracks.length;
      if (count) bits.push(`${count} selected piece${count === 1 ? '' : 's'}`);
      if (config.services.length) bits.push(`${config.services.length} services`);
      heroMeta.textContent = bits.join(' · ');
    }

    if (!finePointer() || reduceMotion()) return;

    // Magnetic calls to action.
    $$('.cta').forEach(button => {
      button.addEventListener('pointermove', event => {
        const rect = button.getBoundingClientRect();
        const dx = (event.clientX - (rect.left + rect.width / 2)) / rect.width;
        const dy = (event.clientY - (rect.top + rect.height / 2)) / rect.height;
        button.style.transform = `translate(${(dx * 6).toFixed(1)}px, ${(dy * 4).toFixed(1)}px)`;
      });
      button.addEventListener('pointerleave', () => {
        button.style.transform = '';
      });
    });

    // A single ember ring as the pointer. Purely decorative.
    if ($('.kal-cursor')) return;
    const ring = document.createElement('div');
    ring.className = 'kal-cursor';
    ring.setAttribute('aria-hidden', 'true');
    document.body.appendChild(ring);

    let x = window.innerWidth / 2;
    let y = window.innerHeight / 2;
    let targetX = x;
    let targetY = y;
    let seen = false;

    window.addEventListener(
      'pointermove',
      event => {
        targetX = event.clientX;
        targetY = event.clientY;
        if (!seen) {
          seen = true;
          ring.classList.add('on');
        }
      },
      { passive: true }
    );
    window.addEventListener('pointerdown', () => ring.classList.add('down'));
    window.addEventListener('pointerup', () => ring.classList.remove('down'));
    document.addEventListener('pointerover', event => {
      const interactive = event.target instanceof Element
        ? event.target.closest('a, button, input, textarea, select, [data-tilt]')
        : null;
      ring.classList.toggle('hot', Boolean(interactive));
    });

    (function follow() {
      x += (targetX - x) * 0.18;
      y += (targetY - y) * 0.18;
      ring.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`;
      window.requestAnimationFrame(follow);
    })();
  })();

  reveal($$('.section-head, .section-rail, .listen-stack > *, .process-list li, .contact-head, .contact-form, .social-list, .manifesto-text, .signal-item, .service-card'));

  if (!tracks.length) {
    const filters = $('#track-filters');
    if (filters) filters.innerHTML = '';
  }
})();
