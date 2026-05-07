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
  // Block legacy bootstraps but NOT newer-version bootstraps — see
  // fk-bootstrap.js for the full explanation. The previous scheme had
  // a V2 guard that blocked any later category bootstrap from running
  // even if it was a newer version, which defeated the takeover.
  window.__fkCategoryV1Ran = true;

  // CDN base auto-detected from this script's own URL. Whatever SHA the
  // Webflow shim loaded fk-category.js from is the same SHA we use for
  // fk-homepage.css and futurekeepers-feed.js — so a single re-pin in
  // the Webflow shim updates everything atomically.
  var thisScript = document.currentScript;
  if (!thisScript) {
    var allScripts = document.getElementsByTagName('script');
    for (var k = allScripts.length - 1; k >= 0; k--) {
      if (allScripts[k].src && allScripts[k].src.indexOf('fk-category.js') >= 0) {
        thisScript = allScripts[k];
        break;
      }
    }
  }
  var src = thisScript ? thisScript.src : '';
  var CDN = src.replace(/\/fk-category\.js.*$/, '') ||
            'https://cdn.jsdelivr.net/gh/Talentlessai/futurekeepers-web@main';

  // Version derived from this bootstrap's CDN SHA. Every commit gets a
  // unique FK_CATEGORY_VERSION so older bootstraps' hosts always look
  // "stale" to newer ones and the in-place takeover kicks in.
  var FK_CATEGORY_VERSION = (CDN.split('@')[1] || 'main').substring(0, 12);

  // Re-entry guard tied to our specific SHA — same fix as fk-bootstrap.js.
  // Two instances of the same SHA short-circuit; different SHAs both run
  // and the newer one takes over the older one's host.
  if (window.__fkCategoryVer === FK_CATEGORY_VERSION) return;
  window.__fkCategoryVer = FK_CATEGORY_VERSION;

  // If a host with EXACTLY our SHA is already there, no-op.
  var __earlyHost = document.getElementById('fk-feed-host');
  if (__earlyHost && __earlyHost.dataset.fkVersion === FK_CATEGORY_VERSION) return;

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
  // C&C / Climate & Capital removed by Steve, May 6 2026 — we feature
  // Climate & Capital articles in the homepage Read mix but don't want
  // a dedicated category page anymore. The CMS category item is archived,
  // so /post-category/climate-capital 404s natively in Webflow now.
  var CATEGORIES = {
    'signal':  { color: '#bc1e75', label: 'Signal' },
    'noise':   { color: '#ed1c24', label: 'Noise' },
    'voices':  { color: '#e65100', label: 'Voices' },
  };

  // YouTube channel IDs per locale (mirrors the map inside futurekeepers-feed.js).
  // Used to build the "Watch all on YouTube" CTA at the bottom of Signal + Noise
  // category pages, so the link points to the right localized channel.
  var YT_CHANNELS = {
    en: 'UCt-RNZMxKm5FpZITxHYEF3Q',
    id: 'UCOYDrFMDw0750hmsH3sTa8A',
    zh: 'UCuGMZ9sP3UQylrFQIQMZNzA',
    bn: 'UC23IKLcxVT9MtIvy4ivsDyQ',
    ur: 'UCWDjo1CRdJl66GcKH52by8g',
    th: 'UCqddPe00oaHHe_EMe5udlRQ',
    hi: 'UCo54PxsldKwPEHmlcRFAArA',
  };

  // CTA copy. Steve, May 6 2026: YouTube RSS hard-caps at 15 items per channel
  // so to "go deeper than the homepage" each category page bottoms out with a
  // direct link to the canonical source. Signal/Noise → YouTube channel,
  // Voices → ProElectrica Substack.
  var CTA = {
    en: { videos: 'Watch all on YouTube',  shorts: 'Watch all Shorts on YouTube',  voices: "Read all on Danny Kennedy's ProElectrica" },
    id: { videos: 'Tonton semua di YouTube', shorts: 'Tonton semua Shorts di YouTube', voices: 'Baca semua di ProElectrica' },
    zh: { videos: '在 YouTube 上观看全部',     shorts: '在 YouTube 上观看全部短视频',      voices: '在 ProElectrica 上阅读全部' },
    bn: { videos: 'YouTube-এ সব ভিডিও',     shorts: 'YouTube-এ সব শর্টস',           voices: 'ProElectrica-এ সব পড়ুন' },
    ur: { videos: 'YouTube پر تمام دیکھیں', shorts: 'YouTube پر تمام شارٹس',         voices: 'ProElectrica پر تمام پڑھیں' },
    th: { videos: 'ดูทั้งหมดบน YouTube',     shorts: 'ดู Shorts ทั้งหมดบน YouTube',      voices: 'อ่านทั้งหมดบน ProElectrica' },
    hi: { videos: 'YouTube पर सभी देखें',    shorts: 'YouTube पर सभी शॉर्ट्स',        voices: 'ProElectrica पर सभी पढ़ें' },
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
      '<div id="fk-feed-host" data-fk-version="' + FK_CATEGORY_VERSION + '" data-fk-category="' + slug + '" data-fk-locale="' + locale + '">' +
        '<div class="container">' +
          '<h2 class="section-title" style="color:' + meta.color + ';">' +
            meta.label +
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

    loadFeedAndRender();
  }

  // Reload feed JS + re-render the category target. Idempotent — used by
  // both fresh inject() AND in-place takeover when a stale older host is
  // already in the DOM.
  function loadFeedAndRender() {
    Array.prototype.forEach.call(
      document.querySelectorAll('script[src*="futurekeepers-feed.js"]'),
      function (s) { s.remove(); }
    );
    if (window.FutureKeepersFeed) try { delete window.FutureKeepersFeed; } catch (e) {}

    var script = document.createElement('script');
    script.src = CDN + '/futurekeepers-feed.js';
    script.onload = function () {
      if (!window.FutureKeepersFeed) return;
      function doRender() {
        FutureKeepersFeed.renderInto('#fk-category-target', 'category-' + slug, 24);
        addBottomCTA();
      }
      doRender();
      // See fk-bootstrap.js: re-render after 7s to win the race against
      // an older bootstrap's late-resolving fetch.
      setTimeout(doRender, 7000);
    };
    document.body.appendChild(script);
  }

  // In-place takeover. If an older bootstrap already injected a host,
  // don't remove it (avoids the "shows up then disappears" flash). Just
  // refresh CSS, mark host as our version, and re-render the target.
  function takeoverInPlace(existingHost) {
    Array.prototype.forEach.call(
      document.querySelectorAll('link[href*="fk-homepage.css"]'),
      function (l) { l.remove(); }
    );
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = CDN + '/fk-homepage.css';
    document.head.appendChild(link);
    existingHost.dataset.fkVersion = FK_CATEGORY_VERSION;
    // Drop any previous CTA so addBottomCTA can re-add a fresh one.
    var oldCta = existingHost.querySelector('.fk-category-cta');
    if (oldCta) oldCta.remove();
    loadFeedAndRender();
  }

  // Append a "go deeper" CTA below the grid linking out to the canonical
  // source. Signal + Noise point at the right localized YouTube channel;
  // Voices points at Danny Kennedy's ProElectrica Substack.
  function addBottomCTA() {
    var host = document.getElementById('fk-feed-host');
    if (!host || host.querySelector('.fk-category-cta')) return;

    var ctaText, ctaHref;
    var copy = (CTA[locale] || CTA.en);
    if (slug === 'signal') {
      ctaText = copy.videos;
      ctaHref = 'https://www.youtube.com/channel/' + (YT_CHANNELS[locale] || YT_CHANNELS.en) + '/videos';
    } else if (slug === 'noise') {
      ctaText = copy.shorts;
      ctaHref = 'https://www.youtube.com/channel/' + (YT_CHANNELS[locale] || YT_CHANNELS.en) + '/shorts';
    } else if (slug === 'voices') {
      ctaText = copy.voices;
      ctaHref = 'https://proelectrica.substack.com/';
    } else {
      return;
    }

    var ctaWrapper = document.createElement('div');
    ctaWrapper.className = 'container fk-category-cta';
    ctaWrapper.style.cssText = 'text-align:center;padding-top:0;padding-bottom:60px;';
    ctaWrapper.innerHTML =
      '<a href="' + ctaHref + '" target="_blank" rel="noopener" ' +
      'style="display:inline-block;padding:14px 32px;background:' + meta.color + ';color:#fff;' +
      'font-weight:700;text-decoration:none;border-radius:999px;font-size:15px;letter-spacing:-0.01em;">' +
      ctaText + ' →</a>';
    host.appendChild(ctaWrapper);
  }

  function start() {
    var existingNow = document.getElementById('fk-feed-host');
    if (existingNow && existingNow.dataset.fkVersion !== FK_CATEGORY_VERSION) {
      takeoverInPlace(existingNow);
    } else {
      inject();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
