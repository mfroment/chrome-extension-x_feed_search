(function () {
  const SEARCH_INTERVAL_MS = 1000;
  const RELOAD_TIMEOUT_MS = 60000;
  let searchQuery = '';
  let paused = false;
  let timerID = null;
  let resumeFromElement = null;
  let debounceTimeout = null;

  // 0. Check if the current path is allowed
  function isAllowedPath(pathname) {
    const allowedPaths = ['/home', '/i/bookmarks', '/notifications', '/notifications/mentions', '/notifications/verified'];
    if (allowedPaths.includes(pathname)) return true;

    // Detect if on current user's profile via "Profile" link
    const profileLink = document.querySelector('a[aria-label="Profile"][href^="/"]');
    if (profileLink && profileLink.getAttribute('href') === pathname) return true;

    // Detect if on someone else's profile via canonical link
    const canonicalLink = document.querySelector('link[rel="canonical"][href^="https://x.com"]');
    if (canonicalLink) {
      try {
        const canonicalPath = new URL(canonicalLink.href).pathname;
        if (canonicalPath === pathname) return true;
      } catch (e) {
        console.warn('[XFeedSearch] Error parsing canonical link href:', e);
      }
    }

    return false;
  }

  // 1. Insert a custom style rule for the custom height override
  function insertCustomHeightStyle() {
    const styleEl = document.createElement('style');
    styleEl.innerHTML = `
      .xfeedsearch-custom-height {
        height: 130px !important;
        min-height: 130px !important;
      }
      .xfeedsearch-btn {
        background-color: #1D9BF0;
        color: #fff;
        padding: 6px 12px;
        border: none;
        border-radius: 9999px;
        cursor: pointer;
        font-size: 14px;
        font-weight: bold;
        outline: none;
      }
      .xfeedsearch-btn:hover {
        background-color: #1A8CD8;
      }
    `;
    document.head.appendChild(styleEl);
  }

  // 2. Wait for the native search form to be present
  function waitForNativeSearch() {
    if (!isAllowedPath(location.pathname)) {
      console.log('[XFeedSearch] Current path not eligible. Skipping.');
      return;
    }
    const nativeSearchForm = document.querySelector('form[aria-label="Search"]');
    if (nativeSearchForm) {
      insertCustomHeightStyle();
      setTimeout(() => {
        console.log('[XFeedSearch v2] Native search form found. Inserting Search in feed.');
        insertSearchInFeed(nativeSearchForm);
      }, 500);
    } else {
      setTimeout(waitForNativeSearch, SEARCH_INTERVAL_MS);
    }
  }

  // 3. Clone the native search form, modify it, and insert it below the native search form
  function insertSearchInFeed(nativeSearchForm) {
    if (document.querySelector('form[aria-label="Search in feed"]')) {
      console.log('[XFeedSearch v2] Search in feed form already exists.');
      return;
    }

    const clonedForm = nativeSearchForm.cloneNode(true);
    clonedForm.setAttribute('aria-label', 'Search in feed');

    const clonedInput = clonedForm.querySelector('input[aria-label="Search query"]');
    if (clonedInput) {
      clonedInput.setAttribute('aria-label', 'Search in feed query');
      clonedInput.setAttribute('placeholder', 'Search in feed');
      clonedInput.value = '';
    }

    let clonedButton = clonedForm.querySelector('button');
    if (!clonedButton) {
      clonedButton = document.createElement('button');
      clonedButton.type = 'button';
      clonedForm.appendChild(clonedButton);
    }
    clonedButton.textContent = 'Search';
    clonedButton.setAttribute('aria-label', 'Search in feed');
    clonedButton.classList.add('xfeedsearch-btn');

    removeProblematicClassesRecursively(clonedForm, ['xcajam', '1867qdf']);
    clonedForm.style.position = 'static';

    const wrapper = document.createElement('div');
    wrapper.className = 'xfeedsearch-wrapper';
    wrapper.style.position = 'static';
    wrapper.style.marginTop = '8px';
    wrapper.appendChild(clonedForm);
    nativeSearchForm.insertAdjacentElement('afterend', wrapper);
    console.log('[XFeedSearch v2] Cloned Search in feed form inserted.');

    // 4. Find the five-level ancestor of the inserted form and apply custom height,
    // and also apply it to that element's next sibling.
    const searchFeedForm = document.querySelector('form[aria-label="Search in feed"]');
    if (searchFeedForm) {
      let ancestor = searchFeedForm;
      for (let i = 0; i < 5; i++) {
        if (ancestor.parentElement) {
          ancestor = ancestor.parentElement;
        }
      }
      ancestor.classList.add('xfeedsearch-custom-height');
      console.log('[XFeedSearch v2] Applied custom height class to ancestor:', ancestor);

      if (ancestor.nextElementSibling) {
        ancestor.nextElementSibling.classList.add('xfeedsearch-custom-height');
        console.log('[XFeedSearch v2] Applied custom height class to ancestor’s next sibling:', ancestor.nextElementSibling);
      }
    } else {
      console.error('[XFeedSearch v2] Could not find inserted Search in feed form for height override.');
    }

    // 5. Add event listeners.
    clonedForm.addEventListener('submit', e => e.preventDefault());
    clonedButton.addEventListener('click', e => {
      e.stopPropagation();
      handleSearch(clonedInput, clonedButton);
    });
  }

  // 6. Recursively remove classes that impose fixed/absolute positioning.
  function removeProblematicClassesRecursively(elem, badFragments) {
    if (elem.classList) {
      const newClasses = [...elem.classList].filter(
        cls => !badFragments.some(fragment => cls.includes(fragment))
      );
      elem.className = newClasses.join(' ');
    }
    if (elem.style && (elem.style.position === 'fixed' || elem.style.position === 'absolute')) {
      elem.style.position = 'static';
    }
    for (const child of elem.children) {
      removeProblematicClassesRecursively(child, badFragments);
    }
  }

  // 7. Toggle search logic (start, pause, resume) upon button click.
  function handleSearch(input, button) {
    if (!paused && !timerID) {
      searchQuery = input.value.trim();
      if (!searchQuery) {
        alert('Please enter a search term.');
        return;
      }
      button.textContent = 'Pause';
      startSearching();
    } else if (timerID) {
      clearInterval(timerID);
      timerID = null;
      button.textContent = 'Resume';
      paused = true;
    } else {
      searchQuery = input.value.trim();
      button.textContent = 'Pause';
      paused = false;
      startSearching();
    }
  }

  // 8. Start periodic tweet searching.
  function startSearching() {
    if (timerID) clearInterval(timerID);
    resumeFromElement = getFocusedTweet() || null;
    timerID = setInterval(() => {
      if (!paused) performSearch();
    }, SEARCH_INTERVAL_MS);
  }

  function getFocusedTweet() {
    const tweets = document.querySelectorAll('[data-testid="tweet"]');
    const viewportMid = window.innerHeight / 2;
    let candidate = null;
    tweets.forEach(tweet => {
      const rect = tweet.getBoundingClientRect();
      if (rect.top <= viewportMid && rect.bottom >= viewportMid) {
        candidate = tweet;
      }
    });
    return candidate;
  }

  // 9. Perform the tweet search.
  function performSearch() {
    const tweets = document.querySelectorAll('[data-testid="tweet"]');
    let found = false;
    let startProcessing = !resumeFromElement;
    for (const tweet of tweets) {
      if (!startProcessing) {
        if (resumeFromElement && tweet.isSameNode(resumeFromElement)) {
          startProcessing = true;
        }
        continue;
      }
      const textContent = tweet.innerText || '';
      if (textContent.toLowerCase().includes(searchQuery.toLowerCase())) {
        tweet.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => {
          highlightTweet(tweet, searchQuery);
        }, 150);

        clearInterval(timerID);
        timerID = null;
        found = true;

        const feedButton = document.querySelector('form[aria-label="Search in feed"] button.xfeedsearch-btn');
        if (feedButton) feedButton.textContent = 'Search';
        break;
      }
    }
    if (!found) {
      window.scrollBy(0, window.innerHeight * 2);
      setTimeout(() => {
        resumeFromElement = getFocusedTweet();
      }, 100);
    }
  }

  function highlightTweet(tweet, query) {
    const regex = new RegExp(`(${escapeRegExp(query)})`, 'i');
    tweet.innerHTML = tweet.innerHTML.replace(regex, '<mark>$1</mark>');
  }

  function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // 10. Monitor URL changes due to SPA navigation and re-run insertion logic
  function observeUrlAndDomChanges() {
    let lastUrl = location.href;
    const observer = new MutationObserver(() => {
      const currentUrl = location.href;
      if (currentUrl !== lastUrl) {
        lastUrl = currentUrl;
        console.log('[XFeedSearch v2] URL changed via SPA navigation.');
        if (debounceTimeout) clearTimeout(debounceTimeout);
        debounceTimeout = setTimeout(() => {
          waitForNativeSearch();
        }, 300);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  window.addEventListener('load', () => {
    setTimeout(() => {
      // Only resume search if the "Search in feed" input is focused.
      const searchInput = document.querySelector('form[aria-label="Search in feed"] input[aria-label="Search in feed query"]');
      if (searchInput && document.activeElement === searchInput) {
        if (searchQuery && !timerID && !paused) {
          startSearching();
        }
      }
    }, RELOAD_TIMEOUT_MS);
  });

  waitForNativeSearch();
  observeUrlAndDomChanges();
})();
