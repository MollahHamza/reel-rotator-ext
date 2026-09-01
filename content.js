(function () {
  'use strict';

  let currentRotation = 0;
  let rotatedVideo = null;
  let btn = null;
  let degreeBadge = null;
  let mutationObserver = null;
  let overflowModifiedElements = [];
  let scrollContainer = null;

  // ─── Focus Mode State ─────────────────────────────────────────
  let focusMode = false;
  let focusBackdrop = null;
  let focusedVideo = null;
  let focusSavedStyles = {};
  let focusOverflowMods = [];

  function createButton() {
    if (document.getElementById('reel-rotate-btn')) {
      btn = document.getElementById('reel-rotate-btn');
      degreeBadge = btn.querySelector('.degree-badge');
      return;
    }

    btn = document.createElement('button');
    btn.id = 'reel-rotate-btn';
    btn.title = 'Rotate (R) · Focus (F)';
    btn.innerHTML = '↻';

    degreeBadge = document.createElement('span');
    degreeBadge.className = 'degree-badge';
    degreeBadge.textContent = '90°';
    btn.appendChild(degreeBadge);

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleRotate();
    });

    document.body.appendChild(btn);
  }

  function findActiveVideo() {
    const videos = document.querySelectorAll('video');
    if (videos.length === 0) return null;

    // Strategy 1: Find a currently playing video
    for (const video of videos) {
      if (!video.paused && !video.ended && video.readyState > 2) {
        return video;
      }
    }

    let bestVideo = null;
    let bestScore = Infinity;
    const viewportCenter = window.innerHeight / 2;

    for (const video of videos) {
      const rect = video.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (rect.bottom < 0 || rect.top > window.innerHeight) continue;
      const videoCenter = rect.top + rect.height / 2;
      const distance = Math.abs(videoCenter - viewportCenter);
      if (distance < bestScore) {
        bestScore = distance;
        bestVideo = video;
      }
    }

    return bestVideo || videos[0] || null;
  }

  function handleRotate() {
    const video = findActiveVideo();
    if (!video) return;

    if (rotatedVideo && rotatedVideo !== video) {
      resetRotation(rotatedVideo);
    }

    currentRotation = currentRotation - 90;
    if (currentRotation <= -360) currentRotation = 0;

    if (currentRotation === 0) {
      resetRotation(video);
      return;
    }

    applyRotation(video, currentRotation);
    rotatedVideo = video;
    updateButtonState();
  }

  function applyRotation(video, degrees) {
    const container = getVideoContainer(video);
    const containerRect = container.getBoundingClientRect();

    let scale = 1;
    const absDeg = Math.abs(degrees);
    if (absDeg === 90 || absDeg === 270) {
      scale = containerRect.width / containerRect.height;
    }

    video.style.transform = `rotate(${degrees}deg) scale(${scale})`;
    video.style.transition = 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
    video.style.transformOrigin = 'center center';
    video.style.objectFit = 'contain';

    clearOverflowModifications();
    const mainScroll = findScrollContainer();
    let el = video.parentElement;
    while (el && el !== document.body) {
      // Don't touch the main scroll container or anything above it
      if (el === mainScroll) break;
      const computed = window.getComputedStyle(el);
      if (computed.overflow !== 'visible') {
        overflowModifiedElements.push({ el, orig: el.style.overflow });
        el.style.overflow = 'visible';
      }
      el = el.parentElement;
    }
  }

  function clearOverflowModifications() {
    for (const { el, orig } of overflowModifiedElements) {
      try { el.style.overflow = orig; } catch (e) { /* element may be gone */ }
    }
    overflowModifiedElements = [];
  }

  function resetRotation(video) {
    if (!video) return;
    video.style.transform = '';
    video.style.transition = '';
    video.style.transformOrigin = '';
    video.style.objectFit = '';
    clearOverflowModifications();
    currentRotation = 0;
    rotatedVideo = null;
    updateButtonState();
  }

  function resetIfActive() {
    if (focusMode) exitFocusMode();
    if (rotatedVideo) {
      resetRotation(rotatedVideo);
    }
  }

  // ─── Focus / Theater Mode ─────────────────────────────────────
  function toggleFocusMode() {
    if (focusMode) {
      exitFocusMode();
    } else {
      enterFocusMode();
    }
  }

  function enterFocusMode() {
    const video = rotatedVideo || findActiveVideo();
    if (!video) return;

    focusedVideo = video;
    focusMode = true;

    // Save original styles
    focusSavedStyles = {
      position: video.style.position,
      zIndex: video.style.zIndex,
      top: video.style.top,
      left: video.style.left,
      width: video.style.width,
      height: video.style.height,
      maxWidth: video.style.maxWidth,
      maxHeight: video.style.maxHeight,
      margin: video.style.margin,
      objectFit: video.style.objectFit,
      transform: video.style.transform,
      transition: video.style.transition,
      transformOrigin: video.style.transformOrigin,
    };

    // Save original DOM position so we can put it back
    focusSavedStyles._origParent = video.parentElement;
    focusSavedStyles._origNextSibling = video.nextSibling;

    // Create dark blurred backdrop
    focusBackdrop = document.createElement('div');
    focusBackdrop.id = 'reel-focus-backdrop';
    focusBackdrop.addEventListener('click', exitFocusMode);
    document.body.appendChild(focusBackdrop);

    // Move video to body so it's above the backdrop (escapes parent stacking contexts)
    document.body.appendChild(video);

    // Force-trigger the backdrop animation
    requestAnimationFrame(() => {
      focusBackdrop.classList.add('active');
    });

    // Calculate the video size to fill the screen with padding
    const padding = 24;
    const availW = window.innerWidth - padding * 2;
    const availH = window.innerHeight - padding * 2;

    // Apply focus styles to the video
    video.style.position = 'fixed';
    video.style.zIndex = '1000001';
    video.style.objectFit = 'contain';
    video.style.transition = 'all 0.35s cubic-bezier(0.4, 0, 0.2, 1)';
    video.style.transformOrigin = 'center center';

    const absRot = Math.abs(currentRotation);
    if (absRot === 90 || absRot === 270) {
      // Rotated: size the element so the rotated result fits in available area
      const elemW = Math.min(availH, availW);
      const elemH = Math.min(availW, availH);
      video.style.width = elemW + 'px';
      video.style.height = elemH + 'px';
      video.style.top = '50%';
      video.style.left = '50%';
      video.style.margin = '0';
      video.style.transform = `translate(-50%, -50%) rotate(${currentRotation}deg)`;
      video.style.maxWidth = 'none';
      video.style.maxHeight = 'none';
    } else {
      video.style.top = padding + 'px';
      video.style.left = padding + 'px';
      video.style.width = availW + 'px';
      video.style.height = availH + 'px';
      video.style.margin = '0';
      video.style.maxWidth = 'none';
      video.style.maxHeight = 'none';
      if (currentRotation === 180) {
        video.style.transform = 'rotate(180deg)';
      } else {
        video.style.transform = 'none';
      }
    }

    if (btn) btn.classList.add('focus-active');
  }

  function exitFocusMode() {
    if (!focusMode || !focusedVideo) return;

    const video = focusedVideo;

    // Restore original styles
    for (const [key, value] of Object.entries(focusSavedStyles)) {
      if (key.startsWith('_')) continue; // skip internal keys
      video.style[key] = value;
    }

    // Move video back to its original DOM position
    const origParent = focusSavedStyles._origParent;
    const origNext = focusSavedStyles._origNextSibling;
    if (origParent) {
      if (origNext && origNext.parentElement === origParent) {
        origParent.insertBefore(video, origNext);
      } else {
        origParent.appendChild(video);
      }
    }

    // Remove backdrop
    if (focusBackdrop) {
      focusBackdrop.classList.remove('active');
      setTimeout(() => {
        if (focusBackdrop && focusBackdrop.parentNode) {
          focusBackdrop.parentNode.removeChild(focusBackdrop);
        }
        focusBackdrop = null;
      }, 300);
    }

    focusMode = false;
    focusedVideo = null;
    focusSavedStyles = {};

    if (btn) btn.classList.remove('focus-active');
  }

  function getVideoContainer(video) {
    let el = video.parentElement;
    while (el && el !== document.body) {
      const rect = el.getBoundingClientRect();
      if (rect.height > window.innerHeight * 0.5 && rect.width > 200) {
        return el;
      }
      el = el.parentElement;
    }
    return video.parentElement;
  }

  function findScrollContainer() {
    if (scrollContainer && document.contains(scrollContainer)) {
      return scrollContainer;
    }
    // Look for the element with scroll-snap-type or the main scrollable area
    const candidates = document.querySelectorAll('div');
    for (const div of candidates) {
      const style = window.getComputedStyle(div);
      if (
        style.scrollSnapType && style.scrollSnapType !== 'none' &&
        div.scrollHeight > div.clientHeight
      ) {
        scrollContainer = div;
        return div;
      }
    }
    const main = document.querySelector('main, [role="main"]');
    if (main) {
      scrollContainer = main;
      return main;
    }
    return null;
  }

  function updateButtonState() {
    if (!btn) return;
    if (currentRotation !== 0) {
      btn.classList.add('rotated');
      degreeBadge.textContent = currentRotation + '°';
    } else {
      btn.classList.remove('rotated');
    }
  }

  function setupScrollReset() {
    const tryAttach = () => {
      const container = findScrollContainer();
      if (container) {
        let scrollTimer = null;
        container.addEventListener('scroll', () => {
          if (rotatedVideo) {
            if (scrollTimer) clearTimeout(scrollTimer);
            scrollTimer = setTimeout(resetIfActive, 100);
          }
        }, { passive: true });
        return true;
      }
      return false;
    };

    if (!tryAttach()) {
      const retryInterval = setInterval(() => {
        if (tryAttach()) clearInterval(retryInterval);
      }, 1000);
      setTimeout(() => clearInterval(retryInterval), 30000);
    }
  }

  function setupVideoPlayReset() {
    document.addEventListener('play', (e) => {
      if (e.target.tagName === 'VIDEO') {
        if (rotatedVideo && e.target !== rotatedVideo) {
          resetIfActive();
        }
      }
    }, true); // use capture to catch it before Instagram
  }

  function setupMutationObserver() {
    if (mutationObserver) mutationObserver.disconnect();

    let debounceTimer = null;

    mutationObserver = new MutationObserver(() => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const isReels = isReelsPage();
        toggleButton(isReels);
      }, 300);
    });

    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  function isReelsPage() {
    const path = window.location.pathname;
    return path.includes('/reels') || path.includes('/reel/');
  }

  function toggleButton(show) {
    if (!btn) return;
    if (show) {
      btn.classList.add('visible');
    } else {
      btn.classList.remove('visible');
      resetIfActive();
    }
  }

  function setupKeyboardShortcut() {
    document.addEventListener('keydown', (e) => {
      // Don't trigger when typing in inputs
      if (
        e.target.tagName === 'INPUT' ||
        e.target.tagName === 'TEXTAREA' ||
        e.target.isContentEditable
      ) {
        return;
      }

      if (!isReelsPage()) return;

      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        handleRotate();
      } else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        toggleFocusMode();
      } else if (e.key === 'Escape') {
        if (focusMode) {
          e.preventDefault();
          exitFocusMode();
        }
      }
    });
  }

  function setupUrlChangeDetection() {
    let lastUrl = window.location.href;

    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function (...args) {
      originalPushState.apply(this, args);
      handleUrlChange();
    };

    history.replaceState = function (...args) {
      originalReplaceState.apply(this, args);
      handleUrlChange();
    };

    window.addEventListener('popstate', handleUrlChange);

    function handleUrlChange() {
      const currentUrl = window.location.href;
      if (currentUrl !== lastUrl) {
        lastUrl = currentUrl;
        resetIfActive();
        const isReels = isReelsPage();
        toggleButton(isReels);
      }
    }
  }

  function init() {
    createButton();
    setupMutationObserver();
    setupKeyboardShortcut();
    setupUrlChangeDetection();
    setupScrollReset();
    setupVideoPlayReset();

    toggleButton(isReelsPage());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
