// content/video-tracker.js
// Session = one learning record. Time accumulates while video plays; pausing only stops the clock.
// Finalize (save) on: tab close, navigation/new video, manual Done, or prolonged loss of video — NOT tab blur.

(function () {
  if (window.__ltActive) return;
  if (typeof globalThis.__ltGetAllVideoElements !== 'function' ||
      typeof globalThis.__ltPickPrimaryVideo !== 'function') {
    console.error('[LT] Missing utils/video-discovery.js — check manifest script order');
    return;
  }
  window.__ltActive = true;

  var session = null;
  var lastState = 'idle'; // 'playing' | 'paused' | 'idle'
  var pollTimer = null;
  var titleRefreshTimer = null;
  var noVideoStreak = 0;
  var manualTick = null;

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function getTitle() {
    var yt = document.querySelector('h1.ytd-watch-metadata yt-formatted-string') ||
      document.querySelector('#above-the-fold #title h1') ||
      document.querySelector('h1.style-scope.ytd-watch-metadata');
    if (yt && yt.textContent.trim()) return yt.textContent.trim();

    var ud = document.querySelector('[data-purpose="lead-title"]') ||
      document.querySelector('.udlite-heading-xl');
    if (ud) return ud.textContent.trim();

    return document.title
      .replace(/\s*[-–|]\s*(YouTube|Udemy|Coursera|Vimeo|Loom|Pluralsight|LinkedIn Learning)\s*$/i, '')
      .trim() || document.title;
  }

  function getYouTubeVideoId() {
    var h = location.hostname;
    if (!h.includes('youtube.com')) return '';
    var p = location.pathname || '';
    if (p.indexOf('/shorts/') === 0) {
      var segs = p.split('/').filter(Boolean);
      return segs[1] || '';
    }
    var m = location.search.match(/[?&]v=([^&]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  }

  function getPageKey() {
    return location.href.split('#')[0];
  }

  function getAllVideos() {
    return globalThis.__ltGetAllVideoElements(document.documentElement);
  }

  function getVideoEl() {
    return globalThis.__ltPickPrimaryVideo(getAllVideos());
  }

  function isYouTube() {
    return window.location.hostname.includes('youtube.com');
  }

  function accumulateActiveSegment() {
    if (session && session.segmentStart) {
      session.totalPlayMs += Date.now() - session.segmentStart;
      session.segmentStart = null;
    }
  }

  /** Video paused / ended — keep session, stop counting until resume. */
  function pauseClock(reason) {
    if (lastState !== 'playing') return;
    lastState = 'paused';
    accumulateActiveSegment();
    console.log('[LT] Paused clock:', reason);
  }

  function stopManualTick() {
    if (manualTick) {
      clearInterval(manualTick);
      manualTick = null;
    }
  }

  function buildManualSnapshot() {
    if (!session || !session.manual) return null;
    return {
      id: session.id,
      title: session.title,
      url: session.url,
      startTime: session.startTime,
      totalPlayMs: session.totalPlayMs,
      exploredPages: session.exploredPages ? session.exploredPages.slice() : [],
      origin: session.origin
    };
  }

  function restoreManualFromSnapshot(snap) {
    if (!snap) return;
    stopManualTick();
    session = {
      id: snap.id,
      title: snap.title,
      url: snap.url,
      startTime: snap.startTime,
      totalPlayMs: Number(snap.totalPlayMs) || 0,
      segmentStart: null,
      manual: true,
      origin: snap.origin,
      ytVideoId: '',
      exploredPages: Array.isArray(snap.exploredPages) ? snap.exploredPages.slice() : []
    };
    lastState = 'playing';
    manualTick = setInterval(function () {
      if (!session || !session.manual) return;
      if (document.hidden) return;
      session.totalPlayMs += 1000;
    }, 1000);
    console.log('[LT] Manual session resumed (paused learning continues)');
  }

  function tryResumeManualAfterLoad() {
    if (session || isYouTube()) return;
    try {
      chrome.runtime.sendMessage(
        { type: 'LT_MANUAL_TRY_RESUME', origin: location.origin },
        function (resp) {
          if (chrome.runtime.lastError || !resp || !resp.ok || !resp.snapshot) return;
          restoreManualFromSnapshot(resp.snapshot);
          try {
            chrome.runtime.sendMessage({ type: 'LT_MANUAL_CLEAR_STASH' }, function () {});
          } catch (e2) {}
        }
      );
    } catch (e) {}
  }

  /** Append current URL/title when user navigates during a manual (non-video) session. */
  function recordExploredPage() {
    if (!session || !session.manual || !session.exploredPages) return;
    var href = window.location.href;
    var title = getTitle() || '';
    var pages = session.exploredPages;
    var last = pages[pages.length - 1];
    if (last && last.url === href) return;
    pages.push({ url: href, title: title, t: Date.now() });
    console.log('[LT] Manual: page', pages.length, title.slice(0, 50));
  }

  /**
   * Save session (if long enough) and clear.
   * @param {function} [done] — called after background persists (or immediately if nothing to save)
   */
  function endSession(reason, done) {
    done = typeof done === 'function' ? done : function () {};

    if (lastState === 'playing') accumulateActiveSegment();
    lastState = 'idle';
    clearTimeout(titleRefreshTimer);
    stopManualTick();

    if (!session) {
      done({ ok: false, reason: 'no_session' });
      return;
    }

    var cur = session;
    session = null;

    if (cur.totalPlayMs > 30000) {
      var payload = {
        id: cur.id,
        title: cur.title,
        url: cur.url,
        startTime: cur.startTime,
        endTime: Date.now(),
        durationMs: cur.totalPlayMs,
        manualReading: !!cur.manual,
        exploredPages: cur.manual && cur.exploredPages ? cur.exploredPages : []
      };
      try {
        chrome.runtime.sendMessage({ type: 'LT_SESSION_END', session: payload }, function (resp) {
          if (chrome.runtime.lastError) {
            done({ ok: true, persisted: false, error: chrome.runtime.lastError.message });
            return;
          }
          console.log('[LT] Saved:', Math.round(cur.totalPlayMs / 1000) + 's', cur.title, reason);
          done({ ok: true, persisted: !!(resp && resp.ok), response: resp });
        });
      } catch (e) {
        console.log('[LT] Saved (send failed):', cur.title, reason);
        done({ ok: true, persisted: false, error: e.message });
      }
    } else {
      console.log('[LT] Discarded short session:', reason);
      done({ ok: false, reason: 'too_short' });
    }
  }

  function startManualReading() {
    if (session) return false;
    stopManualTick();
    var startHref = window.location.href;
    var startTitle = getTitle() || document.title;
    session = {
      id: uid(),
      title: startTitle,
      url: startHref,
      startTime: Date.now(),
      totalPlayMs: 0,
      segmentStart: null,
      manual: true,
      origin: window.location.origin,
      ytVideoId: '',
      exploredPages: [{ url: startHref, title: startTitle, t: Date.now() }]
    };
    lastState = 'playing';
    manualTick = setInterval(function () {
      if (!session || !session.manual) return;
      if (document.hidden) return;
      session.totalPlayMs += 1000;
    }, 1000);
    try {
      chrome.runtime.sendMessage({ type: 'LT_PLAYING', title: session.title, url: session.url });
    } catch (e) {}
    console.log('[LT] Manual reading session started:', session.title);
    return true;
  }

  function getElapsedMs() {
    if (!session) return 0;
    var extra = session.segmentStart ? Date.now() - session.segmentStart : 0;
    return session.totalPlayMs + extra;
  }

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
        segmentStart: Date.now(),
        ytVideoId: getYouTubeVideoId(),
        pageKey: getPageKey()
      };
      titleRefreshTimer = setTimeout(function () {
        if (session) session.title = getTitle() || session.title;
      }, 2000);

      try {
        chrome.runtime.sendMessage({ type: 'LT_PLAYING', title: session.title, url: session.url });
      } catch (e) {}
      console.log('[LT] ▶ Session started:', session.title);
    } else {
      session.segmentStart = Date.now();
      console.log('[LT] ▶ Resumed same session');
    }
  }

  function poll() {
    if (session && session.manual) {
      noVideoStreak = 0;
      if (document.hidden) {
        if (lastState === 'playing') lastState = 'paused';
      } else {
        lastState = 'playing';
      }
      // Same-tab doc/wiki navigation: keep one session; pages go to exploredPages (see URL watcher).
      return;
    }

    var video = getVideoEl();

    if (video && !video.paused && !video.ended) {
      noVideoStreak = 0;

      if (session) {
        if (isYouTube()) {
          var vid = getYouTubeVideoId();
          if (session.ytVideoId && vid && session.ytVideoId !== vid) {
            endSession('new_video');
          }
        } else if (session.pageKey && getPageKey() !== session.pageKey) {
          endSession('page_change');
        }
      }

      if (!session || lastState !== 'playing') {
        onPlay();
      } else {
        lastState = 'playing';
      }

      if (session && isYouTube()) {
        var fresh = getTitle();
        if (fresh) session.title = fresh;
      }
    } else if (video) {
      noVideoStreak = 0;
      if (lastState === 'playing') {
        pauseClock(video.ended ? 'ended' : 'video_pause');
      }
    } else {
      noVideoStreak++;
      if (noVideoStreak >= 3 && session && !session.manual && (lastState === 'playing' || lastState === 'paused')) {
        endSession('no_video');
        noVideoStreak = 0;
      }
    }
  }

  function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(poll, 1200);
  }

  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (msg.type === 'LT_GET_STATUS') {
      var ep = session && session.manual && session.exploredPages ? session.exploredPages.length : 0;
      sendResponse({
        playing: lastState === 'playing',
        paused: lastState === 'paused' && !!session,
        sessionActive: !!session,
        manualReading: !!(session && session.manual),
        hasVideo: !!getVideoEl(),
        title: session ? session.title : '',
        elapsedMs: getElapsedMs(),
        pagesExplored: ep
      });
      return true;
    }
    if (msg.type === 'LT_START_MANUAL_READ') {
      sendResponse({ ok: startManualReading() });
      return true;
    }
    if (msg.type === 'LT_MANUAL_START') {
      onPlay();
    }
    if (msg.type === 'LT_MANUAL_STOP' || msg.type === 'LT_SESSION_COMPLETE') {
      endSession(msg.type === 'LT_SESSION_COMPLETE' ? 'manual_complete' : 'manual_stop', function (result) {
        sendResponse({ ack: true, end: result });
      });
      return true;
    }
  });

  if (isYouTube()) {
    var lastUrl = location.href;

    document.addEventListener('yt-navigate-finish', function () {
      if (session) endSession('navigation');
      else lastState = 'idle';
      lastUrl = location.href;
      noVideoStreak = 0;
      setTimeout(poll, 2000);
    });

    setInterval(function () {
      if (location.href === lastUrl) return;
      lastUrl = location.href;
      if (session) endSession('url_change');
      else lastState = 'idle';
      noVideoStreak = 0;
    }, 1000);
  } else {
    var lastHrefNav = location.href;
    setInterval(function () {
      if (location.href === lastHrefNav) return;
      lastHrefNav = location.href;
      if (session && session.manual) {
        recordExploredPage();
        noVideoStreak = 0;
        return;
      }
      if (session) endSession('url_change');
      else lastState = 'idle';
      noVideoStreak = 0;
    }, 1000);
  }

  function onLeave() {
    if (session && session.manual && !isYouTube()) {
      var snap = buildManualSnapshot();
      if (snap) {
        try {
          chrome.runtime.sendMessage({ type: 'LT_MANUAL_STASH', snapshot: snap });
        } catch (e) {}
      }
      stopManualTick();
      session = null;
      lastState = 'idle';
      return;
    }
    if (session) endSession('tab_close');
  }
  window.addEventListener('pagehide', onLeave);
  window.addEventListener('beforeunload', onLeave);

  var mo = new MutationObserver(function () {
    if (getAllVideos().length && !pollTimer) startPolling();
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });

  tryResumeManualAfterLoad();
  startPolling();
  console.log('[LT] Video tracker active on', location.hostname);
})();
