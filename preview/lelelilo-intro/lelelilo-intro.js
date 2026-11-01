/*!
 * Lelelilo-Studios intro — web adapter (no dependencies).
 * Kit: https://github.com/lelelilo-studios/games-intro-logo   Site: https://lelelilo.com
 *
 *   <script src="lelelilo-intro/lelelilo-intro.js"></script>
 *   <script>
 *     const intro = LeleliloIntro.play({ base: 'lelelilo-intro/', until: gameReadyPromise });
 *     intro.then(() => startTitleScreen());
 *   </script>
 *
 * Shows a full-screen overlay with the square intro video centred on the midnight background. It cannot be
 * skipped until lelelilo.com is on screen (SKIPPABLE_AFTER); after that any key, click, tap or gamepad button
 * skips it. The returned promise resolves when the overlay is gone. Do not restyle or shorten it.
 */
(function (global) {
  'use strict';

  var VERSION = '1.4.0';
  var DURATION = 4.8;          // seconds
  var SKIPPABLE_AFTER = 2.8;   // seconds: the URL has landed
  var BACKGROUND = '#070d18';
  var FEATHER = 7;             // % of the square faded into the background at each edge
  var STILL_HOLD = 2.2;        // seconds the still is shown when the video cannot play

  var active = null;

  function play(options) {
    if (active) return active;
    var o = options || {};
    var base = o.base == null ? 'lelelilo-intro/' : o.base;
    var videoDir = o.videoDir == null ? base : o.videoDir;
    var stillDir = o.stillDir == null ? base : o.stillDir;
    var parent = o.container || document.body || document.documentElement;
    var reduced = !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);

    active = new Promise(function (resolve) {
      var overlay = document.createElement('div');
      overlay.id = 'lelelilo-intro';
      overlay.setAttribute('role', 'img');
      overlay.setAttribute('aria-label', 'Lelelilo-Studios, lelelilo.com');
      overlay.style.cssText =
        'position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;overflow:hidden;' +
        'background:' + BACKGROUND + ';opacity:1;transition:opacity .22s ease;' +
        'touch-action:none;user-select:none;-webkit-user-select:none;cursor:default';

      // the square: contain-fit, its edges feathered so no codec colour shift can show a seam
      var edge = 'transparent 0,#000 ' + FEATHER + '%,#000 ' + (100 - FEATHER) + '%,transparent 100%';
      var mask = 'linear-gradient(to right,' + edge + '),linear-gradient(to bottom,' + edge + ')';
      var squareCss =
        'display:block;width:min(100vw,100vh);height:min(100vw,100vh);object-fit:contain;background:' + BACKGROUND + ';' +
        'pointer-events:none;-webkit-mask-image:' + mask + ';mask-image:' + mask + ';' +
        '-webkit-mask-composite:source-in;mask-composite:intersect';

      var startedAt = 0;        // performance.now() when the picture first showed
      var finished = false;
      var videoEnded = false;
      var readyToLeave = !o.until;
      var video = null;
      var timers = [];
      var rafId = 0;

      function now() { return (global.performance && performance.now ? performance.now() : Date.now()); }
      function elapsed() {
        if (video && !video.paused && video.currentTime > 0) return video.currentTime;
        return startedAt ? (now() - startedAt) / 1000 : 0;
      }

      function finish(skipped) {
        if (finished) return;
        finished = true;
        timers.forEach(clearTimeout);
        if (rafId) cancelAnimationFrame(rafId);
        // keep swallowing input a moment longer, so the release and click of the skip press do not
        // land on the game
        setTimeout(function () {
          EVENTS.forEach(function (type) { global.removeEventListener(type, onInput, true); });
        }, 400);
        overlay.style.opacity = '0';
        if (video) fadeAudio(video);
        setTimeout(function () {
          if (video) { try { video.pause(); video.removeAttribute('src'); video.load(); } catch (e) { /* ignore */ } }
          if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
          var detail = { skipped: !!skipped, version: VERSION };
          try { global.dispatchEvent(new CustomEvent('lelelilo-intro-done', { detail: detail })); } catch (e) { /* ignore */ }
          resolve(detail);
        }, 240);
      }

      function fadeAudio(v) {
        var steps = 6, i = 0, from = v.volume;
        var id = setInterval(function () {
          i++;
          try { v.volume = Math.max(0, from * (1 - i / steps)); } catch (e) { /* ignore */ }
          if (i >= steps) clearInterval(id);
        }, 30);
      }

      // the picture is over: leave now, or hold the flat background until the game is ready
      function pictureOver() {
        videoEnded = true;
        if (readyToLeave) finish(false);
      }

      function onPress() {
        if (finished) return;
        if (o.onGesture) { try { o.onGesture(); } catch (e) { /* ignore */ } }
        if (elapsed() >= SKIPPABLE_AFTER) {
          if (readyToLeave) finish(true);
          else videoEnded = true;       // skip the rest; leave as soon as the game is ready
        } else if (video && video.muted && o.sound !== false) {
          video.muted = false;          // a gesture before the gate turns the sound on
          var p = video.play();
          if (p && p.catch) p.catch(function () { video.muted = true; video.play().catch(function () {}); });
        }
      }

      var DOWN = { keydown: 1, pointerdown: 1, mousedown: 1, touchstart: 1 };
      var EVENTS = ['keydown', 'keyup', 'keypress', 'pointerdown', 'pointerup', 'mousedown', 'mouseup',
        'touchstart', 'touchend', 'click', 'dblclick', 'contextmenu'];
      var lastPress = 0;
      function onInput(e) {
        // keep the game underneath from reacting to anything pressed during the intro
        e.stopImmediatePropagation();
        if (finished || !DOWN[e.type]) return;
        if (e.type === 'keydown' && (e.repeat || e.metaKey || e.ctrlKey || e.altKey)) return;
        var t = now();
        if (t - lastPress < 80) return;   // pointerdown + mousedown + touchstart are one press
        lastPress = t;
        onPress();
      }
      EVENTS.forEach(function (type) { global.addEventListener(type, onInput, true); });

      var padDown = false;
      function pollPads() {
        if (finished) return;
        var pads = navigator.getGamepads ? navigator.getGamepads() : [];
        var down = false;
        for (var i = 0; i < pads.length; i++) {
          var p = pads[i];
          if (!p) continue;
          for (var b = 0; b < p.buttons.length; b++) if (p.buttons[b].pressed) down = true;
        }
        if (down && !padDown) onPress();
        padDown = down;
        rafId = requestAnimationFrame(pollPads);
      }
      rafId = requestAnimationFrame(pollPads);

      var stillShown = false;
      function showStill() {
        if (finished || stillShown) return;
        stillShown = true;
        if (video && video.parentNode) video.parentNode.removeChild(video);
        video = null;
        var img = document.createElement('img');
        img.alt = 'Lelelilo-Studios, lelelilo.com';
        img.decoding = 'async';
        img.style.cssText = squareCss;
        img.src = stillDir + 'lelelilo-intro-still-1024.jpg';
        overlay.appendChild(img);
        startedAt = now() - (SKIPPABLE_AFTER - 1.0) * 1000;   // skippable after one second of the still
        timers.push(setTimeout(pictureOver, STILL_HOLD * 1000));
      }

      if (o.until && o.until.then) {
        var release = function () {
          readyToLeave = true;
          if (videoEnded) finish(false);
        };
        o.until.then(release, release);
      }

      parent.appendChild(overlay);

      if (reduced) {
        showStill();
        return;
      }

      video = document.createElement('video');
      video.style.cssText = squareCss;
      video.playsInline = true;
      video.setAttribute('playsinline', '');
      video.setAttribute('webkit-playsinline', '');
      video.preload = 'auto';
      video.disablePictureInPicture = true;
      video.setAttribute('aria-hidden', 'true');
      var big = Math.min(global.innerWidth || 0, global.innerHeight || 0) * (global.devicePixelRatio || 1) > 860;
      var size = o.size || (big ? 1024 : 720);
      [['webm', 'video/webm; codecs="vp9, opus"'], ['mp4', 'video/mp4']].forEach(function (f) {
        var s = document.createElement('source');
        s.src = videoDir + 'lelelilo-intro-' + size + '.' + f[0];
        s.type = f[1];
        video.appendChild(s);
      });
      video.addEventListener('playing', function () { if (!startedAt) startedAt = now(); });
      video.addEventListener('ended', pictureOver);
      video.addEventListener('error', showStill);
      video.lastElementChild.addEventListener('error', showStill);   // no source could be loaded
      overlay.appendChild(video);

      // sound on if the browser allows it, otherwise muted (a press before the gate unmutes)
      video.muted = o.sound === false;
      var attempt = video.play();
      if (attempt && attempt.catch) {
        attempt.catch(function () {
          if (finished || !video) return;
          video.muted = true;
          video.play().catch(showStill);
        });
      }
      // never trap the player: if the video has not started, fall back; if it overruns, leave
      timers.push(setTimeout(function () { if (!startedAt) showStill(); }, 4000));
      timers.push(setTimeout(function () { if (!videoEnded) pictureOver(); }, (DURATION + 6) * 1000));
    });
    return active;
  }

  global.LeleliloIntro = {
    version: VERSION,
    duration: DURATION,
    skippableAfter: SKIPPABLE_AFTER,
    background: BACKGROUND,
    url: 'https://lelelilo.com',
    play: play
  };
})(typeof window !== 'undefined' ? window : this);
