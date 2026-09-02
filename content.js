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

  // ─── Focus-Mode Scrolling State ───────────────────────────────────
  let focusNavigating = false;      // a reel change is in flight
  let wheelAccum = 0;               // trackpad deltas pile up here
  let wheelResetTimer = null;
  let lastNavTime = 0;
  const WHEEL_THRESHOLD = 40;       // deltaY units before we commit to a move
  const NAV_COOLDOWN = 550;         // ms between reel changes

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

    focusMode = true;

    // Create dark blurred backdrop
    focusBackdrop = document.createElement('div');
    focusBackdrop.id = 'reel-focus-backdrop';
    focusBackdrop.addEventListener('click', exitFocusMode);
    document.body.appendChild(focusBackdrop);

    // Force-trigger the backdrop animation
    requestAnimationFrame(() => {
      if (focusBackdrop) focusBackdrop.classList.add('active');
    });

    applyFocusStyles(video);

    if (btn) btn.classList.add('focus-active');
  }

  // Lifts one video out of the feed and centers it over the backdrop.
  function applyFocusStyles(video) {
    focusedVideo = video;

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
      borderRadius: video.style.borderRadius,
      boxShadow: video.style.boxShadow,
    };

    // Save original DOM position so we can put it back
    focusSavedStyles._origParent = video.parentElement;
    focusSavedStyles._origNextSibling = video.nextSibling;

    // Move video to body so it's above the backdrop (escapes parent stacking contexts)
    document.body.appendChild(video);

    // Calculate nice margins so the video has comfortable padding all around
    const marginRatio = 0.85; // takes ~85% of screen
    const maxW = window.innerWidth * marginRatio;
    const maxH = window.innerHeight * marginRatio;

    // Apply focus styles to the video
    video.style.position = 'fixed';
    video.style.zIndex = '1000001';
    video.style.objectFit = 'contain';
    video.style.transition = 'all 0.35s cubic-bezier(0.4, 0, 0.2, 1)';
    video.style.transformOrigin = 'center center';
    video.style.margin = '0';
    video.style.maxWidth = 'none';
    video.style.maxHeight = 'none';
    video.style.borderRadius = '12px';
    video.style.boxShadow = '0 20px 50px rgba(0, 0, 0, 0.5)';

    const absRot = Math.abs(currentRotation);
    if (absRot === 90 || absRot === 270) {
      // Swapped dimensions constrained to 85% viewport box
      video.style.width = maxH + 'px';
      video.style.height = maxW + 'px';
      video.style.top = '50%';
      video.style.left = '50%';
      video.style.transform = `translate(-50%, -50%) rotate(${currentRotation}deg)`;
    } else {
      video.style.top = '50%';
      video.style.left = '50%';
      video.style.width = maxW + 'px';
      video.style.height = maxH + 'px';
      if (currentRotation === 180 || currentRotation === -180) {
        video.style.transform = `translate(-50%, -50%) rotate(${currentRotation}deg)`;
      } else {
        video.style.transform = 'translate(-50%, -50%)';
      }
    }
  }

  // Puts the focused video back where it came from, styles and all.
  // Leaves focusMode/backdrop untouched so navigation can reuse them.
  function restoreVideoFromFocus() {
    const video = focusedVideo;
    if (!video) return;

    // Restore original styles
    for (const [key, value] of Object.entries(focusSavedStyles)) {
      if (key.startsWith('_')) continue; // skip internal keys
      video.style[key] = value;
    }

    // Move video back to its original DOM position — but only if that spot
    // still exists; Instagram recycles reel nodes while we hold the video.
    const origParent = focusSavedStyles._origParent;
    const origNext = focusSavedStyles._origNextSibling;
    if (origParent && document.contains(origParent)) {
      if (origNext && origNext.parentElement === origParent) {
        origParent.insertBefore(video, origNext);
      } else {
        origParent.appendChild(video);
      }
    } else if (video.parentElement === document.body) {
      video.remove();
    }

    focusedVideo = null;
    focusSavedStyles = {};
  }

  function exitFocusMode() {
    // No focusedVideo check: mid-navigation the video is already back in the
    // feed, and the backdrop still needs tearing down.
    if (!focusMode) return;

    const video = focusedVideo;

    restoreVideoFromFocus();

    // A reel we rotated by inheritance never went through applyRotation, so
    // its restored transform is empty. Re-apply so the feed matches the badge.
    if (video && video === rotatedVideo && currentRotation !== 0 && !video.style.transform) {
      applyRotation(video, currentRotation);
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
    focusNavigating = false;
    wheelAccum = 0;

    if (btn) btn.classList.remove('focus-active');
  }

  // ─── Scrolling Inside Focus Mode ──────────────────────────────────

  // direction: 1 = next reel (down/S), -1 = previous reel (up/W)
  function focusNavigate(direction) {
    if (!focusMode || focusNavigating) return;

    const now = Date.now();
    if (now - lastNavTime < NAV_COOLDOWN) return;
    lastNavTime = now;

    focusNavigating = true;

    const prevVideo = focusedVideo;

    // Remember how the user is holding the video; the next reel inherits it.
    const keptRotation = currentRotation;

    // Drop the video back into the feed so the page can scroll normally, and
    // strip the rotation off it — the rotation travels with us, not with it.
    restoreVideoFromFocus();
    if (rotatedVideo) {
      resetRotation(rotatedVideo);
    } else if (prevVideo) {
      prevVideo.style.transform = '';
      prevVideo.style.transformOrigin = '';
      prevVideo.style.objectFit = '';
    }

    const container = findScrollContainer();
    const step = (container ? container.clientHeight : window.innerHeight) * direction;

    if (container) {
      container.scrollBy({ top: step, behavior: 'smooth' });
    } else {
      window.scrollBy({ top: step, behavior: 'smooth' });
    }

    waitForNextVideo(prevVideo, (video) => {
      focusNavigating = false;
      if (!focusMode || !video) return;

      // Re-arm the rotation before focusing: applyFocusStyles builds its
      // transform from currentRotation.
      if (keptRotation !== 0) {
        currentRotation = keptRotation;
        rotatedVideo = video;
        updateButtonState();
      }

      applyFocusStyles(video);
    });
  }

  // Polls for the reel that scrolling landed on, then hands it back.
  function waitForNextVideo(prevVideo, done) {
    const deadline = Date.now() + 1600;

    const poll = () => {
      if (!focusMode) {
        done(null);
        return;
      }

      const video = findActiveVideo();
      if (video && video !== prevVideo && document.contains(video)) {
        const rect = video.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          done(video);
          return;
        }
      }

      if (Date.now() > deadline) {
        // Nothing new showed up (end of feed, slow load) — re-focus whatever
        // is on screen so the user is not left staring at a blank backdrop.
        done(findActiveVideo());
        return;
      }

      setTimeout(poll, 100);
    };

    setTimeout(poll, 250); // let the smooth scroll get going first
  }

  function handleFocusWheel(e) {
    if (!focusMode) return;

    // Stop the page from scrolling underneath us; focusNavigate moves it
    // by exactly one reel instead.
    e.preventDefault();
    e.stopPropagation();

    if (focusNavigating) return;

    wheelAccum += e.deltaY;

    // Trackpads fire a long tail of small deltas; forget stale ones so a
    // slow drift never adds up into an unwanted jump.
    if (wheelResetTimer) clearTimeout(wheelResetTimer);
    wheelResetTimer = setTimeout(() => { wheelAccum = 0; }, 200);

    if (Math.abs(wheelAccum) >= WHEEL_THRESHOLD) {
      const direction = wheelAccum > 0 ? 1 : -1;
      wheelAccum = 0;
      focusNavigate(direction);
    }
  }

  function setupFocusScroll() {
    // Capture phase on the document: the backdrop covers the screen, but the
    // focused video sits above it and would otherwise swallow the event.
    document.addEventListener('wheel', handleFocusWheel, {
      capture: true,
      passive: false,
    });
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
          if (focusMode) return; // focus mode drives its own navigation
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
        if (focusMode) return; // focus mode drives its own navigation
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
      } else if (focusMode && (e.key === 'w' || e.key === 'W')) {
        e.preventDefault();
        focusNavigate(-1);
      } else if (focusMode && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        focusNavigate(1);
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
    setupFocusScroll();

    toggleButton(isReelsPage());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
