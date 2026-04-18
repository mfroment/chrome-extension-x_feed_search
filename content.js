(function () {
  const SEARCH_INTERVAL_MS = 1000;
  const RELOAD_TIMEOUT_MS = 60000;
  const ALLOWED_PATHS = ['/home', '/i/bookmarks', '/notifications', '/notifications/mentions', '/notifications/verified'];
  const ALLOWED_PREFIXES = ['/i/trending'];
  let searchQuery = '';
  let paused = false;
  let timerID = null;
  let resumeFromElement = null;
  let debounceTimeout = null;

  // Permalink-based tweet numbering:
  // X virtualizes the timeline — only ~15 cellInnerDiv elements exist at once, recycled
  // as you scroll. We use each tweet's permalink (/user/status/ID) as a stable unique key.
  // As new tweets scroll into view, they get the next sequential number.
  // An ordered array tracks the sequence, and a Map provides O(1) lookup.
  // A MutationObserver re-stamps badges whenever the DOM recycles.
  let tweetOrder = [];            // permalinks in order of first appearance (scrolling down)
  let tweetNumberMap = new Map(); // permalink → assigned number
  let numberingObserver = null;

  // Extract the main tweet's permalink from its timestamp link
  function getTweetPermalink(tweet) {
    // The main tweet's timestamp is an <a> with href containing /status/ and a <time> child.
    // Quoted tweets use a <div> for the date, so this selector is safe.
    const timeLink = tweet.querySelector('a[href*="/status/"] > time');
    if (!timeLink) return null;
    return timeLink.parentElement.getAttribute('href');
  }

  // Assign a number to a tweet if it hasn't been seen before
  function registerTweet(tweet) {
    const permalink = getTweetPermalink(tweet);
    if (!permalink) return null;
    if (!tweetNumberMap.has(permalink)) {
      const num = tweetOrder.length + 1;
      tweetOrder.push(permalink);
      tweetNumberMap.set(permalink, num);
    }
    return tweetNumberMap.get(permalink);
  }

  // Stamp (or update) the badge on a tweet's avatar column
  function stampTweetNumber(tweet, number) {
    const existing = tweet.querySelector('.xfeedsearch-tweet-number');
    if (existing) {
      if (existing.textContent == number) return;
      existing.textContent = number;
      return;
    }

    // Target the main tweet's avatar only (first one; quoted tweet avatars come later)
    const allAvatars = tweet.querySelectorAll('[data-testid="Tweet-User-Avatar"]');
    if (allAvatars.length === 0) return;
    const mainAvatar = allAvatars[0];

    let avatarColumn = mainAvatar.closest('[class*="r-18kxxzh"][class*="r-1wron08"]');
    if (!avatarColumn) avatarColumn = mainAvatar;

    const badge = document.createElement('div');
    badge.className = 'xfeedsearch-tweet-number';
    badge.textContent = number;
    // Insert right after the avatar div (before the thread connector line)
    mainAvatar.insertAdjacentElement('afterend', badge);
  }

  // Register and stamp all currently visible tweets
  function numberVisibleTweets() {
    const tweets = document.querySelectorAll('[data-testid="tweet"]');
    for (const tweet of tweets) {
      const num = registerTweet(tweet);
      if (num !== null) stampTweetNumber(tweet, num);
    }
  }

  // Start the always-on numbering observer
  function startNumberingObserver() {
    if (numberingObserver) return;
    const timeline = document.querySelector('[data-testid="primaryColumn"]') || document.body;
    let rafPending = null;
    numberingObserver = new MutationObserver(() => {
      if (rafPending) return;
      rafPending = requestAnimationFrame(() => {
        rafPending = null;
        numberVisibleTweets();
      });
    });
    numberingObserver.observe(timeline, { childList: true, subtree: true });
    // Initial stamp
    numberVisibleTweets();
  }

  // Reset numbering (e.g. on SPA navigation to a different page)
  function resetNumbering() {
    tweetOrder = [];
    tweetNumberMap.clear();
    document.querySelectorAll('.xfeedsearch-tweet-number').forEach(el => el.remove());
  }

  // 0. Check if the current path is an allowed timeline and return it, or null
  function getBasePath(pathname) {
    if (ALLOWED_PATHS.includes(pathname)) return pathname;

    // Check prefix-based paths (e.g. /i/trending/123456)
    const prefixMatch = ALLOWED_PREFIXES.find(p => pathname === p || pathname.startsWith(p + '/'));
    if (prefixMatch) return prefixMatch;

    const title = document.title;
    const match = title.match(/\(@([^\)]+)\) \/ X$/);
    if (match && pathname === `/${match[1]}`) return pathname;

    return null;
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
      .xfeedsearch-tweet-number {
        display: flex;
        justify-content: center;
        align-items: center;
        margin-top: 4px;
        font-size: 11px;
        font-weight: bold;
        color: #1D9BF0;
        background-color: rgba(29, 155, 240, 0.1);
        border-radius: 9999px;
        padding: 2px 6px;
        min-width: 24px;
        line-height: 1.2;
      }
    `;
    document.head.appendChild(styleEl);
  }

  // 2. Wait for the native search form to be present
  function waitForNativeSearch() {
    if (!getBasePath(location.pathname)) {
      console.log('[XFeedSearch] Current path not eligible. Skipping.');
      return;
    }
    const nativeSearchForm = document.querySelector('form[aria-label="Search"]');
    if (nativeSearchForm) {
      insertCustomHeightStyle();
      setTimeout(() => {
        console.log('[XFeedSearch v2] Native search form found. Inserting Search in feed.');
        insertSearchInFeed(nativeSearchForm);
        numberingBasePath = getBasePath(location.pathname);
        startNumberingObserver();
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
      updateButtonLabel(button, 'Pause')
      startSearching();
    } else if (timerID) {
      clearInterval(timerID);
      timerID = null;
      updateButtonLabel(button, 'Resume')
      paused = true;
    } else {
      searchQuery = input.value.trim();
      updateButtonLabel(button, 'Pause')
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

      const feedButton = document.querySelector('form[aria-label="Search in feed"] button.xfeedsearch-btn');
      if (feedButton) updateButtonLabel(feedButton, 'Pause');

      const textContent = tweet.innerText || '';
      if (textContent.toLowerCase().includes(searchQuery.toLowerCase())) {
        tweet.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => {
          highlightTweet(tweet, searchQuery);
        }, 150);

        clearInterval(timerID);
        timerID = null;
        found = true;

        if (feedButton) updateButtonLabel(feedButton, 'Search');
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

  function updateButtonLabel(button, baseLabel) {
    button.textContent = baseLabel;
  }

  function highlightTweet(tweet, query) {
    const regex = new RegExp(`(${escapeRegExp(query)})`, 'i');
    tweet.innerHTML = tweet.innerHTML.replace(regex, '<mark>$1</mark>');
  }

  function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // 10. Monitor URL changes due to SPA navigation and re-run insertion logic.
  // Track which timeline the numbering belongs to, so clicking into a tweet
  // and pressing back preserves the numbers.
  let numberingBasePath = null; // the allowed path where current numbering started

  function observeUrlAndDomChanges() {
    let lastUrl = location.href;
    const observer = new MutationObserver(() => {
      const currentUrl = location.href;
      if (currentUrl !== lastUrl) {
        lastUrl = currentUrl;
        console.log('[XFeedSearch v2] URL changed via SPA navigation.');
        if (debounceTimeout) clearTimeout(debounceTimeout);
        debounceTimeout = setTimeout(() => {
          const currentBasePath = getBasePath(location.pathname);

          if (currentBasePath && currentBasePath !== numberingBasePath) {
            // Navigated to a different timeline — reset numbering
            resetNumbering();
            numberingBasePath = currentBasePath;
            if (numberingObserver) {
              numberingObserver.disconnect();
              numberingObserver = null;
            }
          } else if (currentBasePath && currentBasePath === numberingBasePath) {
            // Returned to the same timeline (e.g. back from a tweet detail) — keep numbering,
            // just restart the observer if needed
            if (!numberingObserver) {
              // Small delay to let the DOM settle before re-observing
              setTimeout(() => startNumberingObserver(), 300);
            }
          } else {
            // Navigated to a non-allowed page (e.g. tweet detail) — stop observer
            // but keep the numbering data so it's there when we come back
            if (numberingObserver) {
              numberingObserver.disconnect();
              numberingObserver = null;
            }
          }

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
