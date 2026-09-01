(function () {
  'use strict';

  let currentRotation = 0;
  let rotatedVideo = null;
  let btn = null;
  let degreeBadge = null;
  let mutationObserver = null;
  let overflowModifiedElements = [];
  let scrollContainer = null;

  function createButton() {
    if (document.getElementById('reel-rotate-btn')) {
      btn = document.getElementById('reel-rotate-btn');
      degreeBadge = btn.querySelector('.degree-badge');
      return;
    }

    btn = document.createElement('button');
    btn.id = 'reel-rotate-btn';
    btn.title = 'Rotate Reel (R)';
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

    currentRotation = (currentRotation + 90) % 360;

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
    if (degrees === 90 || degrees === 270) {
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
    if (rotatedVideo) {
      resetRotation(rotatedVideo);
    }
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
      if (
        e.target.tagName === 'INPUT' ||
        e.target.tagName === 'TEXTAREA' ||
        e.target.isContentEditable
      ) {
        return;
      }
      if (e.key === 'r' || e.key === 'R') {
        if (isReelsPage()) {
          e.preventDefault();
          handleRotate();
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
