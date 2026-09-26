// ==UserScript==
// @name         YouTube Comment Timestamps: Picture-in-Picture, No Scroll
// @namespace    https://github.com/Amin8r/youtube-comment-timestamp
// @version      1.0.0
// @description  Clicking a timestamp in the comments jumps the video to that time without scrolling back up to the player, and pops the video out into an always-on-top Picture-in-Picture window.
// @author       Amin8r
// @homepageURL  https://github.com/Amin8r/youtube-comment-timestamp
// @supportURL   https://github.com/Amin8r/youtube-comment-timestamp/issues
// @match        https://www.youtube.com/*
// @icon         https://www.youtube.com/favicon.ico
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @inject-into  auto
// @run-at       document-start
// @noframes
// ==/UserScript==

(() => {
  'use strict';

  // The player counts as on screen while at least this share of it is inside the viewport.
  const ON_SCREEN = 0.5;

  // Toggled from the userscript manager's menu and remembered between visits.
  const SETTINGS = [
    { key: 'pip', label: 'Picture-in-Picture when the player is off-screen', initial: true },
    { key: 'exitPip', label: 'Leave Picture-in-Picture when back at the player', initial: true },
    { key: 'description', label: 'Also handle timestamps in the description', initial: false },
  ];

  // Where timestamp clicks are taken over. ytd-comment-view-model is the current comment
  // renderer and ytd-comment-renderer the older one; the thread renderer also covers
  // comments shown in the side panel.
  const COMMENTS = 'ytd-comments, ytd-comment-thread-renderer, ytd-comment-view-model, ytd-comment-renderer';
  const DESCRIPTION = 'ytd-watch-metadata #description, ytd-text-inline-expander, ytd-structured-description-content-renderer';

  const LOG_PREFIX = '[YouTube timestamp PiP]';

  const store = {
    get(key, fallback) {
      try {
        return typeof GM_getValue === 'function' ? GM_getValue(key, fallback) : fallback;
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        if (typeof GM_setValue === 'function') GM_setValue(key, value);
      } catch {
        // Not saved; the value still applies to this tab.
      }
    },
  };

  const settings = Object.fromEntries(SETTINGS.map(({ key, initial }) => [key, store.get(key, initial)]));
  let firefoxHintShown = store.get('firefoxHintShown', false);
  let menuIds = [];
  let pipRequest = null;
  let returnWatcher = null;
  let toastBox = null;
  let toastTimer = 0;

  // Capturing on window runs before any listener YouTube has on the page, so a click we
  // take over never reaches the code that scrolls up to the player.
  window.addEventListener('click', onClick, true);
  window.addEventListener('keydown', onKeyDown, true);
  buildMenu();

  function onClick(event) {
    if (event.button === 0 && !hasModifier(event)) handle(event);
  }

  function onKeyDown(event) {
    if (event.key === 'Enter' && !event.repeat && !event.isComposing && !hasModifier(event)) handle(event);
  }

  // Ctrl/Cmd/Shift/Alt-clicks keep their usual meaning (new tab, new window, download).
  function hasModifier(event) {
    return event.ctrlKey || event.metaKey || event.shiftKey || event.altKey;
  }

  function handle(event) {
    if (event.defaultPrevented || !isWatchPage()) return;
    const link = findScopedLink(event);
    const seconds = link ? timestampOf(link) : null;
    if (seconds === null) return;

    const player = document.getElementById('movie_player');
    const video = player?.querySelector('video');
    if (!video) return; // Nothing to control, so leave the click to YouTube.
    const api = playerApi(player);
    // Without YouTube's API we seek the <video> itself, which during an ad is the ad.
    if (!api && player.classList.contains('ad-showing')) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    jump(player, video, api, seconds);
  }

  // The link the event went through, if that link sits in a comment (or the description).
  function findScopedLink(event) {
    const scope = settings.description ? `${COMMENTS}, ${DESCRIPTION}` : COMMENTS;
    let link = null;
    for (const node of event.composedPath()) {
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      if (!link) {
        if (node.localName === 'a' && node.hasAttribute('href') && !node.isContentEditable) link = node;
      } else if (node.matches(scope)) {
        return link;
      }
    }
    return null;
  }

  // Start time in seconds if the link points at the video on this page, otherwise null.
  function timestampOf(link) {
    const href = link.getAttribute('href');
    // An empty or "#..." href would resolve to this page's URL, which can carry its own &t=.
    if (!href || href.startsWith('#')) return null;
    let url;
    try {
      url = new URL(href, location.href);
    } catch {
      return null;
    }
    if (!/^((www|m)\.)?youtube\.com$|^youtu\.be$/.test(url.hostname)) return null;
    const id = videoIdOf(url);
    if (!id || id !== currentVideoId()) return null;
    const hashParams = new URLSearchParams(url.hash.slice(1));
    return parseTime(url.searchParams.get('t') ?? url.searchParams.get('start') ?? hashParams.get('t'));
  }

  // Accepts 83, 83s, 1m23s, 1h2m3s, 1:23 and 1:02:03.
  function parseTime(value) {
    const text = String(value ?? '').trim().toLowerCase();
    let m = /^(\d+(?:\.\d+)?)s?$/.exec(text);
    if (m) return Number(m[1]);
    m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s?)?$/.exec(text);
    if (m && (m[1] || m[2])) return (Number(m[1]) || 0) * 3600 + (Number(m[2]) || 0) * 60 + (Number(m[3]) || 0);
    m = /^(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/.exec(text);
    if (m) return (Number(m[1]) || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
    return null;
  }

  function isWatchPage() {
    return location.pathname === '/watch' || location.pathname.startsWith('/live/');
  }

  function currentVideoId() {
    return videoIdOf(new URL(location.href)) || document.querySelector('ytd-watch-flexy')?.getAttribute('video-id') || null;
  }

  function videoIdOf(url) {
    if (url.hostname === 'youtu.be') return url.pathname.split('/')[1] || null;
    if (url.pathname === '/watch') return url.searchParams.get('v');
    return /^\/(?:live|shorts|embed|v)\/([\w-]+)/.exec(url.pathname)?.[1] ?? null;
  }

  // YouTube's player methods live on the #movie_player element. In the page context they
  // are right there; in a Firefox content script they are behind wrappedJSObject; in a
  // Chrome content script they are out of reach and we fall back to the <video> element.
  function playerApi(player) {
    for (const candidate of [player, player.wrappedJSObject]) {
      if (candidate && typeof candidate.seekTo === 'function' && typeof candidate.playVideo === 'function') {
        return candidate;
      }
    }
    return null;
  }

  function jump(player, video, api, seconds) {
    // The browser only opens Picture-in-Picture during a user gesture, so ask before anything else.
    const inPip = shouldEnterPip(player, video) ? enterPip(video) : Promise.resolve(isInPip(video));
    seek(video, api, seconds);
    inPip.then((pip) => {
      // Only confirm the jump when the video isn't visible anywhere.
      if (!pip && visibleShare(player) < ON_SCREEN) toast(`Jumped to ${formatTime(seconds)}`, pipHint());
    });
  }

  function seek(video, api, seconds) {
    if (api) {
      try {
        api.seekTo(seconds, true);
        api.playVideo(); // Clicking a timestamp on YouTube also starts a paused video.
        return;
      } catch (error) {
        console.warn(LOG_PREFIX, 'Player API failed, seeking the <video> directly:', error);
      }
    }
    video.currentTime = seconds;
    video.play()?.catch(() => {});
  }

  function shouldEnterPip(player, video) {
    return settings.pip && !document.fullscreenElement && !isInPip(video) && visibleShare(player) < ON_SCREEN;
  }

  function isInPip(video) {
    return document.pictureInPictureElement === video;
  }

  function enterPip(video) {
    pipRequest ??= requestPip(video).finally(() => {
      pipRequest = null;
    });
    return pipRequest;
  }

  async function requestPip(video) {
    if (!document.pictureInPictureEnabled || video.disablePictureInPicture) return false;
    try {
      if (video.readyState < HTMLMediaElement.HAVE_METADATA) await nextEvent(video, 'loadedmetadata', 3000);
      await video.requestPictureInPicture();
    } catch (error) {
      console.warn(LOG_PREFIX, 'Could not open Picture-in-Picture:', error);
      return false;
    }
    exitWhenPlayerReturns(video);
    return true;
  }

  // Put the video back into the page once the player is scrolled back into view.
  function exitWhenPlayerReturns(video) {
    returnWatcher?.disconnect();
    const player = video.closest('#movie_player') ?? video;
    let wasOnScreen = null;
    const watcher = new IntersectionObserver((entries) => {
      const onScreen = entries[entries.length - 1].intersectionRatio >= ON_SCREEN;
      if (onScreen && wasOnScreen === false && settings.exitPip && isInPip(video)) {
        document.exitPictureInPicture().catch(() => {});
      }
      wasOnScreen = onScreen;
    }, { threshold: ON_SCREEN });
    watcher.observe(player);
    returnWatcher = watcher;
    video.addEventListener('leavepictureinpicture', () => {
      watcher.disconnect();
      if (returnWatcher === watcher) returnWatcher = null;
    }, { once: true });
  }

  function nextEvent(target, type, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        target.removeEventListener(type, done);
        reject(new Error(`No ${type} event within ${timeoutMs} ms`));
      }, timeoutMs);
      function done() {
        clearTimeout(timer);
        resolve();
      }
      target.addEventListener(type, done, { once: true });
    });
  }

  function visibleShare(element) {
    const rect = element.getBoundingClientRect();
    const width = Math.min(rect.right, document.documentElement.clientWidth) - Math.max(rect.left, 0);
    const height = Math.min(rect.bottom, document.documentElement.clientHeight) - Math.max(rect.top, 0);
    return width > 0 && height > 0 ? (width * height) / (rect.width * rect.height) : 0;
  }

  function pipHint() {
    if (!settings.pip) return '';
    if ('pictureInPictureEnabled' in document) return "Couldn't open Picture-in-Picture.";
    // Firefox has no API for pages or userscripts to open its Picture-in-Picture window.
    if (firefoxHintShown || !/Firefox\//.test(navigator.userAgent)) return '';
    firefoxHintShown = true;
    store.set('firefoxHintShown', true);
    const keys = /Mac/.test(navigator.platform) ? '⌘ ⌥ ⇧ ]' : 'Ctrl+Shift+]';
    return `Firefox doesn't let scripts open Picture-in-Picture. Open it yourself once (${keys}, or the Picture-in-Picture button on the video) and the timestamps you click will play there.`;
  }

  function formatTime(totalSeconds) {
    const s = Math.floor(totalSeconds);
    const pad = (n) => String(n).padStart(2, '0');
    const hours = Math.floor(s / 3600);
    const minutes = Math.floor(s / 60) % 60;
    return hours ? `${hours}:${pad(minutes)}:${pad(s % 60)}` : `${minutes}:${pad(s % 60)}`;
  }

  function toast(text, hint = '') {
    const parent = document.body ?? document.documentElement;
    if (!parent) return;
    if (!toastBox) {
      toastBox = document.createElement('div');
      toastBox.setAttribute('role', 'status');
      Object.assign(toastBox.style, {
        position: 'fixed',
        left: '50%',
        bottom: '24px',
        transform: 'translateX(-50%)',
        zIndex: '2147483647',
        boxSizing: 'border-box',
        maxWidth: 'min(480px, calc(100vw - 32px))',
        padding: '10px 16px',
        borderRadius: '8px',
        background: 'var(--yt-spec-inverted-background, #0f0f0f)',
        color: 'var(--yt-spec-text-primary-inverse, #fff)',
        font: '500 14px/20px Roboto, Arial, sans-serif',
        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.3)',
        pointerEvents: 'none',
        opacity: '0',
        transition: 'opacity 150ms ease',
      });
    }
    const line = document.createElement('div');
    line.textContent = text;
    toastBox.replaceChildren(line);
    if (hint) {
      const detail = document.createElement('div');
      detail.textContent = hint;
      Object.assign(detail.style, { marginTop: '4px', fontWeight: '400', opacity: '0.85' });
      toastBox.append(detail);
    }
    if (!toastBox.isConnected) parent.append(toastBox);
    void toastBox.offsetWidth; // Start from the current opacity so the fade-in runs.
    toastBox.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastBox.style.opacity = '0';
    }, hint ? 9000 : 1800);
  }

  function buildMenu() {
    if (typeof GM_registerMenuCommand !== 'function') return;
    if (menuIds.length) {
      if (typeof GM_unregisterMenuCommand !== 'function') return;
      for (const id of menuIds) {
        try {
          GM_unregisterMenuCommand(id);
        } catch {
          // Already gone.
        }
      }
    }
    menuIds = SETTINGS.map(({ key, label }) =>
      GM_registerMenuCommand(`${settings[key] ? '✅' : '⬜'} ${label}`, () => toggleSetting(key)));
  }

  function toggleSetting(key) {
    settings[key] = !settings[key];
    store.set(key, settings[key]);
    buildMenu();
    const { label } = SETTINGS.find((setting) => setting.key === key);
    toast(`${label}: ${settings[key] ? 'on' : 'off'}`);
  }
})();
