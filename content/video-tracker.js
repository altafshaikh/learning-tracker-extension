// content/video-tracker.js
// Detects video play/pause on YouTube and any HTML5 video site.
// Uses POLLING as primary method (most reliable for YouTube SPA).

(function () {
  if (window.__ltActive) return;
  window.__ltActive = true;

  // ── State ──────────────────────────────────────────────────────────────────
  var session = null;        // active session object
  var lastState = 'idle';    // 'playing' | 'paused' | 'idle'
  var pollTimer = null;
  var titleRefreshTimer = null;

  // ── Helpers ────────────────────────────────────────────────────────────────
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function getTitle() {
    // YouTube — title lives in a specific element that loads after navigation
    var yt = document.querySelector('h1.ytd-watch-metadata yt-formatted-string') ||
             document.querySelector('#above-the-fold #title h1') ||
             document.querySelector('h1.style-scope.ytd-watch-metadata');
    if (yt && yt.textContent.trim()) return yt.textContent.trim();

    // Udemy
    var ud = document.querySelector('[data-purpose="lead-title"]') ||
             document.querySelector('.udlite-heading-xl');
    if (ud) return ud.textContent.trim();

    // Generic: strip site name from document.title
    return document.title
      .replace(/\s*[-–|]\s*(YouTube|Udemy|Coursera|Vimeo|Loom|Pluralsight|LinkedIn Learning)\s*$/i, '')
      .trim() || document.title;
  }

  // YouTube and many SPAs put <video> inside Shadow DOM — querySelectorAll('video') misses it.
  function getAllVideos() {
    var videos = [];
    function walk(node) {
      if (!node) return;
      if (node.nodeName === 'VIDEO') videos.push(node);
      if (node.shadowRoot) walk(node.shadowRoot);
      var child = node.firstElementChild;
      while (child) {
        walk(child);
        child = child.nextElementSibling;
      }
    }
    walk(document.documentElement);
    return videos;
  }

  function getVideoEl() {
    var videos = getAllVideos();
    return videos.find(function(v) { return !v.paused; }) || videos[0] || null;
  }

  function isYouTube() {
    return window.location.hostname.includes('youtube.com');
  }

  // ── Session lifecycle ──────────────────────────────────────────────────────
  function onPlay() {
    if (lastState === 'playing') return;
    lastState = 'playing';

    if (!session) {
      session = {
        id: uid(),
        title: getTitle(),
        url: window.location.href,
        startTime: Date.now(),
        totalPlayMs: 0,
        segmentStart: Date.now()
      };
      // Refresh title after 2s (YouTube loads it async)
      titleRefreshTimer = setTimeout(function() {
        if (session) session.title = getTitle() || session.title;
      }, 2000);

      try { chrome.runtime.sendMessage({ type: 'LT_PLAYING', title: session.title, url: session.url }); } catch(e) {}
      console.log('[LT] ▶ Started:', session.title);
    } else {
      // Resuming
      session.segmentStart = Date.now();
    }
  }

  function onPause(reason) {
    if (lastState !== 'playing') return;
    lastState = 'paused';

    if (session && session.segmentStart) {
      session.totalPlayMs += Date.now() - session.segmentStart;
      session.segmentStart = null;
    }

    // Only save if played for > 30 seconds total
    if (session && session.totalPlayMs > 30000) {
      var payload = {
        id: session.id,
        title: session.title,
        url: session.url,
        startTime: session.startTime,
        endTime: Date.now(),
        durationMs: session.totalPlayMs
      };
      try { chrome.runtime.sendMessage({ type: 'LT_SESSION_END', session: payload }); } catch(e) {}
      console.log('[LT] ⏸ Saved:', Math.round(session.totalPlayMs / 1000) + 's', session.title);
    }

    session = null;
    clearTimeout(titleRefreshTimer);
  }

  // ── Polling loop ───────────────────────────────────────────────────────────
  // Poll every 1.5s — catches YouTube state changes that don't fire DOM events
  function poll() {
    var video = getVideoEl();

    if (video) {
      if (!video.paused && video.readyState >= 2) {
        onPlay();
        // Keep title fresh while playing (YouTube updates it async)
        if (session && isYouTube()) {
          var fresh = getTitle();
          if (fresh && fresh !== session.title) session.title = fresh;
        }
      } else {
        if (lastState === 'playing') onPause('poll_pause');
      }
    } else {
      // No video on page
      if (lastState === 'playing') onPause('no_video');
    }
  }

  function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(poll, 1500);
  }

  // ── Messages from popup / background ─────────────────────────────────────────
  chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
    if (msg.type === 'LT_GET_STATUS') {
      sendResponse({
        playing: lastState === 'playing',
        title: session ? session.title : ''
      });
      return true;
    }
    if (msg.type === 'LT_MANUAL_START') {
      onPlay();
    }
    if (msg.type === 'LT_MANUAL_STOP') {
      onPause('manual');
    }
  });

  // ── YouTube SPA: re-init on navigation ───────────────────────────────────
  // YouTube is a SPA — URL changes without page reload
  if (isYouTube()) {
    var lastUrl = location.href;

    document.addEventListener('yt-navigate-finish', function() {
      if (lastState === 'playing') onPause('navigation');
      session = null;
      lastState = 'idle';
      lastUrl = location.href;
      // Give YouTube time to inject the new video element
      setTimeout(poll, 2000);
    });

    // Also watch URL changes via interval as backup
    setInterval(function() {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        if (lastState === 'playing') onPause('url_change');
        session = null;
        lastState = 'idle';
      }
    }, 1000);
  }

  // ── Tab visibility ─────────────────────────────────────────────────────────
  document.addEventListener('visibilitychange', function() {
    if (document.hidden && lastState === 'playing') {
      onPause('tab_hidden');
    }
  });

  window.addEventListener('beforeunload', function() {
    if (lastState === 'playing') onPause('unload');
  });

  // ── Watch for dynamically added video elements (incl. inside shadow roots) ──
  var mo = new MutationObserver(function() {
    if (getAllVideos().length && !pollTimer) startPolling();
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });

  // ── Kick off ───────────────────────────────────────────────────────────────
  startPolling();
  console.log('[LT] Video tracker active on', location.hostname);
})();
