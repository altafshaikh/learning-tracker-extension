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

  /** Save session (if long enough) and clear. */
  function endSession(reason) {
    if (lastState === 'playing') accumulateActiveSegment();
    lastState = 'idle';
    clearTimeout(titleRefreshTimer);
    stopManualTick();

    if (!session) return;

    if (session.totalPlayMs > 30000) {
      var payload = {
        id: session.id,
        title: session.title,
        url: session.url,
        startTime: session.startTime,
        endTime: Date.now(),
        durationMs: session.totalPlayMs
      };
      try { chrome.runtime.sendMessage({ type: 'LT_SESSION_END', session: payload }); } catch (e) {}
      console.log('[LT] Saved:', Math.round(session.totalPlayMs / 1000) + 's', session.title, reason);
    } else {
      console.log('[LT] Discarded short session:', reason);
    }

    session = null;
  }

  function startManualReading() {
    if (session) return false;
    stopManualTick();
    session = {
      id: uid(),
      title: getTitle(),
      url: window.location.href,
      startTime: Date.now(),
      totalPlayMs: 0,
      segmentStart: null,
      manual: true,
      pageKey: getPageKey(),
      ytVideoId: ''
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
      if (session.pageKey && getPageKey() !== session.pageKey) {
        endSession('page_change');
      }
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
      sendResponse({
        playing: lastState === 'playing',
        paused: lastState === 'paused' && !!session,
        sessionActive: !!session,
        manualReading: !!(session && session.manual),
        hasVideo: !!getVideoEl(),
        title: session ? session.title : '',
        elapsedMs: getElapsedMs()
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
      endSession(msg.type === 'LT_SESSION_COMPLETE' ? 'manual_complete' : 'manual_stop');
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
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        if (session) endSession('url_change');
        else lastState = 'idle';
        noVideoStreak = 0;
      }
    }, 1000);
  } else {
    var lastHrefNav = location.href;
    setInterval(function () {
      if (location.href !== lastHrefNav) {
        lastHrefNav = location.href;
        if (session) endSession('url_change');
        else lastState = 'idle';
        noVideoStreak = 0;
      }
    }, 1000);
  }

  function onLeave() {
    if (session) endSession('tab_close');
  }
  window.addEventListener('pagehide', onLeave);
  window.addEventListener('beforeunload', onLeave);

  var mo = new MutationObserver(function () {
    if (getAllVideos().length && !pollTimer) startPolling();
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });

  startPolling();
  console.log('[LT] Video tracker active on', location.hostname);
})();
