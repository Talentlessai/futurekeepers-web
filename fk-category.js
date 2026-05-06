/**
 * FutureKeepers Category Page Bootstrap
 *
 * Loaded by an inline shim registered in Webflow's Custom Code v2 on
 * the "Post Categories Template" page (id detail_post-category). Same
 * approach as fk-bootstrap.js for the homepage.
 *
 * The Webflow CMS post grid that used to drive these pages was being
 * filled by a broken n8n Substack→CMS automation, so the displayed
 * articles are months / years stale. We replace the grid with a
 * real-time federated feed pulled from each category's actual sources.
 *
 * Routes handled (covers every locale: /xx/post-category/<slug> too):
 *   /post-category/signal           → YouTube long-form + FK Signal Substack
 *   /post-category/noise            → YouTube Shorts
 *   /post-category/voices           → ProElectrica (Danny's Substack)
 *   /post-category/climate-capital  → Climate & Capital Asia RSS
 *   /post-category/cc-asia          → same as climate-capital (legacy slug)
 *
 * Anything else falls through and the page renders unchanged.
 */
(function () {
  if (window.__fkCategoryV1Ran) return;
  window.__fkCategoryV1Ran = true;

  // Pinned to a specific futurekeepers-feed.js commit so cache busts
  // are deterministic. Keep this in sync with fk-bootstrap.js's CDN const.
  var CDN = 'https://cdn.jsdelivr.net/gh/Talentlessai/futurekeepers-web@__SHA__';

  // -----------------------------------------------------------
  // Parse the URL: pull the category slug out of /post-category/<slug>
  // wherever it sits in the path (locale subdirs may prefix it).
  // -----------------------------------------------------------
  var match = location.pathname.match(/\/post-category\/([^\/?#]+)/);
  if (!match) return;
  var slug = decodeURIComponent(match[1]).toLowerCase();

  // Pick locale (same logic as the homepage bootstrap)
  var SUPPORTED = ['id', 'zh', 'bn', 'ur', 'th', 'hi'];
  var firstSeg = (location.pathname.split('/')[1] || '').toLowerCase();
  var locale = SUPPORTED.indexOf(firstSeg) >= 0 ? firstSeg : 'en';

  // -----------------------------------------------------------
  // Category metadata. Color picks up Webflow's category brand color
  // so the new grid still feels like the page it replaces. The "live"
  // string is the localized "live feed" badge — we lean on a small
  // subset of the homepage translation table.
  // -----------------------------------------------------------
  var CATEGORIES = {
    'signal':           { color: '#bc1e75', label: 'Signal' },
    'noise':            { color: '#ed1c24', label: 'Noise' },
    'voices':           { color: '#e65100', label: 'Voices' },
    'climate-capital':  { color: '#00897b', label: 'Climate & Capital' },
    'cc-asia':          { color: '#00897b', label: 'Climate & Capital' },
  };
  var meta = CATEGORIES[slug];
  if (!meta) return; // unknown slug — leave the page alone

  var LIVE = {
    en: '⚡ Live feed',
    id: '⚡ Umpan langsung',
    zh: '⚡ 实时更新',
    bn: '⚡ লাইভ ফিড',
    ur: '⚡ لائو فیڈ',
    th: '⚡ ฟีดสด',
    hi: '⚡ लाइव फ़ीड',
  };
  var LOADING = {
    en: 'Loading…',
    id: 'Memuat…',
    zh: '加载中…',
    bn: 'লোড হচ্ছে…',
    ur: 'لوڈ ہو رہا ہے…',
    th: 'กำลังโหลด…',
    hi: 'लोड हो रहा है…',
  };

  function inject() {
    if (document.getElementById('fk-category-host')) return;

    // Webflow's category page renders inside `div.body-content` (note
    // the missing `main` tag — different from the home page). The page
    // structure is roughly:
    //   div.body-content
    //     div.navigation-bottom
    //     header.navigation-top-part.<color>-bg-color   ← keep
    //     div.section                                    ← REPLACE (CMS post grid)
    //     div.section.footer                             ← keep
    var bodyContent = document.querySelector('div.body-content');
    if (!bodyContent) return;

    // Stylesheet (reuses the homepage CSS — all the .grid-3 / .card / .pill
    // styles are scoped under #fk-feed-host, so we add that class as a
    // wrapper on our category host too to inherit them).
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = CDN + '/fk-homepage.css';
    document.head.appendChild(link);

    // Build the federated grid container. The wrapper carries id
    // "fk-feed-host" so the homepage CSS selectors apply (.container,
    // .grid-3, .card, etc. are all scoped under that id). The id
    // "fk-category-host" is added separately as a marker so we can
    // detect duplicate injection without colliding with the homepage's
    // own host element.
    var html =
      '<div id="fk-feed-host" data-fk-category="' + slug + '" data-fk-locale="' + locale + '">' +
        '<div class="container">' +
          '<h2 class="section-title" style="color:' + meta.color + ';">' +
            meta.label +
            ' <span class="live-tag" style="margin-left:auto;">' + LIVE[locale] + '</span>' +
          '</h2>' +
          '<div class="grid-3" id="fk-category-target">' +
            '<div style="grid-column:1/-1;padding:40px;text-align:center;color:#888;">' + LOADING[locale] + '</div>' +
          '</div>' +
        '</div>' +
      '</div>';

    // Find the post-grid section (first .section that isn't .footer) and
    // replace it. If we can't find one, append our host before the footer
    // section as a safe fallback.
    var sections = bodyContent.querySelectorAll('div.section');
    var inserted = false;
    for (var i = 0; i < sections.length; i++) {
      var s = sections[i];
      if (s.classList.contains('footer')) continue;
      // Hide it instead of removing so any inline scripts still find their anchors
      s.style.display = 'none';
      if (!inserted) {
        s.insertAdjacentHTML('afterend', html);
        inserted = true;
      }
    }
    if (!inserted) bodyContent.insertAdjacentHTML('beforeend', html);

    // Add an id-only marker for idempotency check on the wrapper itself
    var host = document.getElementById('fk-feed-host');
    if (host) host.id = 'fk-feed-host'; // keep id stable
    var marker = document.createElement('div');
    marker.id = 'fk-category-host';
    marker.style.display = 'none';
    document.body.appendChild(marker);

    // Load federated feed engine and render
    var script = document.createElement('script');
    script.src = CDN + '/futurekeepers-feed.js';
    script.onload = function () {
      if (!window.FutureKeepersFeed) return;
      // 24 items per category — plenty for a category page; the feed
      // engine will fetch up to 15 per source per page, so most
      // categories will have between 6 and 21 items in practice.
      FutureKeepersFeed.renderInto('#fk-category-target', 'category-' + slug, 24);
    };
    document.body.appendChild(script);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }
})();
