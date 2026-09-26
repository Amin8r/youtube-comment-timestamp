// ==UserScript==
// @name         YouTube Comment Timestamps Without Scrolling
// @namespace    https://github.com/Amin8r/youtube-comment-timestamp
// @version      1.1.0
// @description  Clicking a timestamp in the comments jumps the video to that time without scrolling back up to the player, and keeps the video playing in a mini-player in the corner while you read.
// @author       Amin8r
// @homepageURL  https://github.com/Amin8r/youtube-comment-timestamp
// @supportURL   https://github.com/Amin8r/youtube-comment-timestamp/issues
// @match        https://www.youtube.com/*
// @icon         https://www.youtube.com/favicon.ico
// @grant        GM_addStyle
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
    { key: 'miniPlayer', label: 'Mini-player when the player is off-screen', initial: true },
    { key: 'usePip', label: 'Use a Picture-in-Picture window instead of the in-page mini-player', initial: false },
    { key: 'returnToPlayer', label: 'Put the video back when you scroll up to the player', initial: true },
    { key: 'description', label: 'Also handle timestamps in the description', initial: false },
  ];

  // Where timestamp clicks are taken over. ytd-comment-view-model is the current comment
  // renderer and ytd-comment-renderer the older one; the thread renderer also covers
  // comments shown in the side panel.
  const COMMENTS = 'ytd-comments, ytd-comment-thread-renderer, ytd-comment-view-model, ytd-comment-renderer';
  const DESCRIPTION = 'ytd-watch-metadata #description, ytd-text-inline-expander, ytd-structured-description-content-renderer';

  // Set on #movie_player while it floats. An attribute rather than a class, so YouTube's
  // own class changes on the player can't remove it.
  const MINI = 'data-ytct-mini';
  const CLOSE_ID = 'ytct-mini-close';
  const MINI_CSS = `
    :root {
      --ytct-mini-width: min(400px, calc(100vw - 32px));
      --ytct-mini-height: calc(var(--ytct-mini-width) * 9 / 16);
    }
    #movie_player[${MINI}] {
      display: block !important;
      position: fixed !important;
      inset: auto 16px 16px auto !important;
      width: var(--ytct-mini-width) !important;
      height: var(--ytct-mini-height) !important;
      min-width: 0 !important;
      min-height: 0 !important;
      max-width: none !important;
      max-height: none !important;
      margin: 0 !important;
      padding: 0 !important;
      border: 0 !important;
      border-radius: 12px !important;
      overflow: hidden !important;
      background: #000 !important;
      box-shadow: 0 8px 28px rgba(0, 0, 0, 0.45) !important;
      z-index: 2147483000 !important;
    }
    /* Fit the video to the mini-player even before YouTube lays the player out again. */
    #movie_player[${MINI}] .html5-video-container {
      width: 100% !important;
      height: 100% !important;
    }
    #movie_player[${MINI}] video {
      width: 100% !important;
      height: 100% !important;
      left: 0 !important;
      top: 0 !important;
      object-fit: contain !important;
    }
    /* YouTube didn't lay its controls out for the smaller size: show just the video. */
    #movie_player[${MINI}="bare"] :is(.ytp-chrome-top, .ytp-chrome-bottom, .ytp-gradient-top,
      .ytp-gradient-bottom, .ytp-caption-window-container) {
      display: none !important;
    }
    #${CLOSE_ID} {
      position: fixed !important;
      inset: auto 16px calc(16px + var(--ytct-mini-height) + 8px) auto !important;
      box-sizing: border-box !important;
      width: 32px !important;
      height: 32px !important;
      margin: 0 !important;
      padding: 6px !important;
      border: 0 !important;
      border-radius: 50% !important;
      background: rgba(15, 15, 15, 0.9) !important;
      color: #fff !important;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4) !important;
      cursor: pointer !important;
      overflow: visible !important;
      z-index: 2147483001 !important;
    }
    #${CLOSE_ID}:hover {
      background: #3f3f3f !important;
    }
    #${CLOSE_ID}:focus-visible {
      outline: 2px solid #3ea6ff !important;
      outline-offset: 2px !important;
    }
    #${CLOSE_ID} svg {
      display: block;
      width: 20px;
      height: 20px;
    }
  `;

  const LOG_PREFIX = '[YouTube comment timestamps]';

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
  let menuIds = [];
  let mini = null; // { player, video, slot, restoreSlot, keeper } while the player floats
  let closeButton = null;
  let stylesAdded = false;
  let pipRequest = null;
  let returnWatcher = null;
  let toastBox = null;
  let toastTimer = 0;

  // Capturing on window runs before any listener YouTube has on the page, so a click we
  // take over never reaches the code that scrolls up to the player.
  window.addEventListener('click', onClick, true);
  window.addEventListener('keydown', onKeyDown, true);
  // Leaving the page or going fullscreen puts the player back where YouTube expects it.
  document.addEventListener('yt-navigate-start', () => closeMiniPlayer());
  window.addEventListener('popstate', () => closeMiniPlayer());
  document.addEventListener('fullscreenchange', () => closeMiniPlayer());
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
    // Picture-in-Picture only opens during a user gesture, so pop out before anything else.
    const poppedOut = shouldPopOut(player, video) ? popOut(player, video) : Promise.resolve(isPoppedOut(video));
    seek(video, api, seconds);
    poppedOut.then((shown) => {
      // Only confirm the jump when the video isn't visible anywhere.
      if (!shown && visibleShare(player) < ON_SCREEN) toast(`Jumped to ${formatTime(seconds)}`);
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

  function pause(player, video) {
    const api = playerApi(player);
    try {
      if (typeof api?.pauseVideo === 'function') {
        api.pauseVideo();
        return;
      }
    } catch {
      // Fall back to the <video> element.
    }
    video.pause();
  }

  function shouldPopOut(player, video) {
    return settings.miniPlayer && !document.fullscreenElement && !isPoppedOut(video) && visibleShare(player) < ON_SCREEN;
  }

  function isPoppedOut(video) {
    return Boolean(mini) || isInPip(video);
  }

  async function popOut(player, video) {
    if (settings.usePip && (await enterPip(video))) return true;
    return openMiniPlayer(player, video);
  }

  /* ---------------------------------------------------------------------------------- */
  /* In-page mini-player: YouTube's own player, floated into the corner.                 */

  function openMiniPlayer(player, video) {
    if (mini) return true; // Two clicks can both fall back here from one failed PiP request.
    const slot = player.parentElement;
    if (!slot) return false;
    addStyles();
    const slotSize = slot.getBoundingClientRect();
    player.setAttribute(MINI, '');
    showInTopLayer(player);
    const session = { player, video, slot, restoreSlot: null, keeper: 0 };
    mini = session;
    keepSlotSize(slotSize);
    showCloseButton();
    relayout();
    setTimeout(() => {
      if (mini !== session) return;
      keepSlotSize(slotSize);
      checkControlsFit();
    }, 700);
    session.keeper = setInterval(keepOnTop, 1000);
    watchForReturn(slot, () => closeMiniPlayer());
    return true;
  }

  function closeMiniPlayer(pauseVideo = false) {
    if (!mini) return;
    const { player, video, restoreSlot, keeper } = mini;
    mini = null;
    clearInterval(keeper);
    stopWatchingForReturn();
    removeFromTopLayer(player);
    player.removeAttribute(MINI);
    restoreSlot?.();
    if (closeButton) {
      removeFromTopLayer(closeButton);
      closeButton.remove();
    }
    relayout();
    if (pauseVideo) pause(player, video);
  }

  // With the player floating, its spot in the page would collapse if YouTube sized it by
  // its content; hold it at its size so the comments you're reading don't move.
  function keepSlotSize(size) {
    if (!mini || mini.restoreSlot) return;
    const { slot } = mini;
    const now = slot.getBoundingClientRect();
    if (now.width >= size.width - 1 && now.height >= size.height - 1) return;
    const { minWidth, minHeight } = slot.style;
    slot.style.minWidth = `${size.width}px`;
    slot.style.minHeight = `${size.height}px`;
    mini.restoreSlot = () => Object.assign(slot.style, { minWidth, minHeight });
  }

  function checkControlsFit() {
    const bar = mini.player.querySelector('.ytp-chrome-bottom');
    if (bar && bar.getBoundingClientRect().width > mini.player.getBoundingClientRect().width + 1) {
      mini.player.setAttribute(MINI, 'bare');
    }
  }

  // YouTube lays out the video and its controls for the player's size on window resize.
  function relayout() {
    window.dispatchEvent(new Event('resize'));
  }

  // Popovers render in the top layer: above the whole page, whatever the player's
  // ancestors do with z-index, transforms or overflow.
  function showInTopLayer(element) {
    if (typeof element.showPopover !== 'function') return;
    if (!element.hasAttribute('popover')) element.setAttribute('popover', 'manual');
    if (element.matches(':popover-open')) return;
    try {
      element.showPopover();
    } catch {
      element.removeAttribute('popover');
    }
  }

  function removeFromTopLayer(element) {
    if (!element.hasAttribute('popover')) return;
    try {
      element.hidePopover();
    } catch {
      // Already hidden.
    }
    element.removeAttribute('popover');
  }

  // Moving an element in the DOM takes it out of the top layer, and YouTube moves the
  // player around, e.g. for theater mode.
  function keepOnTop() {
    if (mini?.player.hasAttribute('popover') && !mini.player.matches(':popover-open')) showInTopLayer(mini.player);
  }

  function addStyles() {
    if (stylesAdded) return;
    stylesAdded = true;
    if (typeof GM_addStyle === 'function') {
      try {
        GM_addStyle(MINI_CSS);
        return;
      } catch {
        // Fall back to a plain <style> element.
      }
    }
    const style = document.createElement('style');
    style.textContent = MINI_CSS;
    (document.head ?? document.documentElement).append(style);
  }

  function showCloseButton() {
    closeButton ??= createCloseButton();
    document.body.append(closeButton);
    showInTopLayer(closeButton);
  }

  function createCloseButton() {
    const button = document.createElement('button');
    button.id = CLOSE_ID;
    button.type = 'button';
    button.title = 'Close mini-player';
    button.setAttribute('aria-label', 'Close mini-player');
    const svgNs = 'http://www.w3.org/2000/svg';
    const icon = document.createElementNS(svgNs, 'svg');
    icon.setAttribute('viewBox', '0 0 24 24');
    const cross = document.createElementNS(svgNs, 'path');
    cross.setAttribute('d', 'M6 6l12 12M18 6L6 18');
    cross.setAttribute('stroke', 'currentColor');
    cross.setAttribute('stroke-width', '2');
    cross.setAttribute('stroke-linecap', 'round');
    icon.append(cross);
    button.append(icon);
    button.addEventListener('click', () => closeMiniPlayer(true));
    return button;
  }

  /* ---------------------------------------------------------------------------------- */
  /* Picture-in-Picture window (opt-in).                                                  */

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
      console.warn(LOG_PREFIX, 'Could not open Picture-in-Picture, using the mini-player instead:', error);
      return false;
    }
    watchForReturn(video.closest('#movie_player') ?? video, () => {
      if (isInPip(video)) document.exitPictureInPicture().catch(() => {});
    });
    video.addEventListener('leavepictureinpicture', stopWatchingForReturn, { once: true });
    return true;
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

  /* ---------------------------------------------------------------------------------- */

  // Call onReturn once the player's place in the page is scrolled back into view.
  function watchForReturn(target, onReturn) {
    stopWatchingForReturn();
    let wasOnScreen = null;
    returnWatcher = new IntersectionObserver((entries) => {
      const onScreen = entries[entries.length - 1].intersectionRatio >= ON_SCREEN;
      if (onScreen && wasOnScreen === false && settings.returnToPlayer) onReturn();
      wasOnScreen = onScreen;
    }, { threshold: ON_SCREEN });
    returnWatcher.observe(target);
  }

  function stopWatchingForReturn() {
    returnWatcher?.disconnect();
    returnWatcher = null;
  }

  function visibleShare(element) {
    const rect = element.getBoundingClientRect();
    const width = Math.min(rect.right, document.documentElement.clientWidth) - Math.max(rect.left, 0);
    const height = Math.min(rect.bottom, document.documentElement.clientHeight) - Math.max(rect.top, 0);
    return width > 0 && height > 0 ? (width * height) / (rect.width * rect.height) : 0;
  }

  function formatTime(totalSeconds) {
    const s = Math.floor(totalSeconds);
    const pad = (n) => String(n).padStart(2, '0');
    const hours = Math.floor(s / 3600);
    const minutes = Math.floor(s / 60) % 60;
    return hours ? `${hours}:${pad(minutes)}:${pad(s % 60)}` : `${minutes}:${pad(s % 60)}`;
  }

  function toast(text) {
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
    toastBox.textContent = text;
    if (!toastBox.isConnected) parent.append(toastBox);
    void toastBox.offsetWidth; // Start from the current opacity so the fade-in runs.
    toastBox.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastBox.style.opacity = '0';
    }, 1800);
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
    if (key === 'miniPlayer' || key === 'usePip') closeMiniPlayer();
    const { label } = SETTINGS.find((setting) => setting.key === key);
    toast(`${label}: ${settings[key] ? 'on' : 'off'}`);
  }
})();
