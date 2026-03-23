// Loaded before content/video-tracker.js (see manifest). Exposes helpers on globalThis.
(function () {
  var g = typeof globalThis !== 'undefined' ? globalThis : self;

  function getAllVideoElements(root) {
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
    walk(root);
    return videos;
  }

  /** Prefer playing videos; otherwise largest by area (main player vs tiny ads). */
  function pickPrimaryVideo(videos) {
    if (!videos || !videos.length) return null;
    var playing = videos.filter(function (v) {
      return !v.paused && !v.ended;
    });
    var pool = playing.length ? playing : videos;
    return pool.slice().sort(function (a, b) {
      function area(el) {
        var w = el.clientWidth || el.videoWidth || 0;
        var h = el.clientHeight || el.videoHeight || 0;
        return w * h;
      }
      return area(b) - area(a);
    })[0];
  }

  g.__ltGetAllVideoElements = getAllVideoElements;
  g.__ltPickPrimaryVideo = pickPrimaryVideo;
})();
