/**
 * FutureKeepers Homepage Bootstrap
 *
 * Loaded by a tiny inline shim registered in Webflow's Custom Code v2.
 * The Webflow shim looks roughly like:
 *
 *   <script>
 *     (function() {
 *       if (window.__fkHomepageInjected) return;
 *       window.__fkHomepageInjected = true;
 *       var s = document.createElement('script');
 *       s.src = 'https://cdn.jsdelivr.net/gh/Talentlessai/futurekeepers-web@<SHA>/fk-bootstrap.js';
 *       document.head.appendChild(s);
 *     })();
 *   </script>
 *
 * Keeping the shim ~4 lines means future tweaks don't require re-registering
 * a Webflow custom-code script — we just push a new SHA and re-pin the shim.
 *
 * What this file does, in order:
 *   1. Detects the active locale from the URL path (/, /id, /zh, /bn, /ur, /th, /hi)
 *   2. Picks localized strings for section titles, "See all" links, and the loading state
 *   3. Injects the homepage layout (#fk-feed-host) into Webflow's main.body-content
 *   4. Hides every other Mag Commerce template section (keeps only #footer-section visible)
 *   5. Loads the federated feed engine (futurekeepers-feed.js) from the same CDN
 *   6. Calls renderInto for hero / watch / shorts / read / events
 */
(function () {
  // Versioned guard. Newer guard name lets new bootstraps override old ones
  // when Webflow stacks multiple shim versions in the rendered HTML
  // (which it does — old applied scripts can't be cleanly deleted via the
  // public Custom Code v2 API).
  if (window.__fkBootstrapV3Ran) return;
  window.__fkBootstrapV3Ran = true;
  // Also clear V2 guard so an OLDER concurrent bootstrap doesn't bail out
  // if it happens to run after this one — but this is best-effort, the
  // takeover block below is the actual safety net.
  window.__fkBootstrapV2Ran = false;

  // Takeover: nuke whatever a prior bootstrap version might have injected
  // before we render. If we run AFTER an older bootstrap, this clears its
  // host + feed-script + global so we can re-inject fresh. If we run
  // BEFORE any older one (rare), this is a no-op.
  var existing = document.getElementById('fk-feed-host');
  if (existing) existing.remove();
  Array.prototype.forEach.call(
    document.querySelectorAll('script[src*="futurekeepers-feed.js"]'),
    function (s) { s.remove(); }
  );
  Array.prototype.forEach.call(
    document.querySelectorAll('link[href*="fk-homepage.css"]'),
    function (l) { l.remove(); }
  );
  if (window.FutureKeepersFeed) try { delete window.FutureKeepersFeed; } catch (e) {}
  // Restore Webflow's main.body-content children that older bootstraps hid,
  // so we can re-hide them cleanly below.
  var __mainEl = document.querySelector('main.body-content');
  if (__mainEl) Array.prototype.forEach.call(__mainEl.children, function (c) { c.style.display = ''; });

  // -----------------------------------------------------------
  // CDN base auto-detected from this script's own URL. Whatever SHA
  // the Webflow shim loaded fk-bootstrap.js from is the same SHA we
  // use for fk-homepage.css and futurekeepers-feed.js — so a single
  // re-pin in the Webflow shim updates everything atomically.
  // (Bug fixed May 6 2026 — was hardcoded SHA, drifted from the shim
  // and pinned the feed JS at a stale version.)
  // -----------------------------------------------------------
  var thisScript = document.currentScript;
  if (!thisScript) {
    var allScripts = document.getElementsByTagName('script');
    for (var k = allScripts.length - 1; k >= 0; k--) {
      if (allScripts[k].src && allScripts[k].src.indexOf('fk-bootstrap.js') >= 0) {
        thisScript = allScripts[k];
        break;
      }
    }
  }
  var bootSrc = thisScript ? thisScript.src : '';
  var CDN = bootSrc.replace(/\/fk-bootstrap\.js.*$/, '') ||
            'https://cdn.jsdelivr.net/gh/Talentlessai/futurekeepers-web@main';

  // -----------------------------------------------------------
  // Locale detection. Webflow Localization routes every non-English
  // locale under a subdirectory (/id, /zh, /bn, /ur, /th, /hi).
  // English is the primary locale and lives at the root.
  // -----------------------------------------------------------
  var SUPPORTED = ['id', 'zh', 'bn', 'ur', 'th', 'hi'];
  var firstSeg = (location.pathname.split('/')[1] || '').toLowerCase();
  var locale = SUPPORTED.indexOf(firstSeg) >= 0 ? firstSeg : 'en';

  // Locale prefix used when building "See all" links so they stay
  // in the same language. English uses no prefix.
  var localePath = locale === 'en' ? '' : '/' + locale;

  // -----------------------------------------------------------
  // Translations. Conservative set — only the labels that show
  // in the homepage chrome we inject. Article/video titles come
  // from each source's own RSS feed and are already locale-correct
  // (per-language YouTube channels, locale-routed Substack, etc.)
  // -----------------------------------------------------------
  var T = {
    en: {
      watch: 'Watch',
      shorts: 'Shorts',
      read: 'Read',
      upcoming: "What's Coming",
      seeAllVideos: 'See all videos on Signal',
      seeAllShorts: 'See all Shorts on Noise',
      seeAllArticles: 'See all articles',
      fullCalendar: 'Full calendar',
      liveFeed: '⚡ Live feed',
      loadingHero: 'Loading hero…',
    },
    id: {
      watch: 'Tonton',
      shorts: 'Singkat',
      read: 'Baca',
      upcoming: 'Akan Datang',
      seeAllVideos: 'Lihat semua video di Signal',
      seeAllShorts: 'Lihat semua Shorts di Noise',
      seeAllArticles: 'Lihat semua artikel',
      fullCalendar: 'Kalender lengkap',
      liveFeed: '⚡ Umpan langsung',
      loadingHero: 'Memuat…',
    },
    zh: {
      watch: '观看',
      shorts: '短视频',
      read: '阅读',
      upcoming: '即将到来',
      seeAllVideos: '查看 Signal 上所有视频',
      seeAllShorts: '查看 Noise 上所有短视频',
      seeAllArticles: '查看所有文章',
      fullCalendar: '完整日历',
      liveFeed: '⚡ 实时更新',
      loadingHero: '加载中…',
    },
    bn: {
      watch: 'দেখুন',
      shorts: 'শর্টস',
      read: 'পড়ুন',
      upcoming: 'আসছে যা',
      seeAllVideos: 'Signal-এ সব ভিডিও',
      seeAllShorts: 'Noise-এ সব শর্টস',
      seeAllArticles: 'সব নিবন্ধ',
      fullCalendar: 'পূর্ণ ক্যালেন্ডার',
      liveFeed: '⚡ লাইভ ফিড',
      loadingHero: 'লোড হচ্ছে…',
    },
    ur: {
      watch: 'دیکھیں',
      shorts: 'شارٹس',
      read: 'پڑھیں',
      upcoming: 'آنیوالا',
      seeAllVideos: 'سگنل پر تمام ویڈیوز',
      seeAllShorts: 'نوائز پر تمام شارٹس',
      seeAllArticles: 'تمام مضامین',
      fullCalendar: 'مکمل کیلنڈر',
      liveFeed: '⚡ لائو فیڈ',
      loadingHero: 'لوڈ ہو رہا ہے…',
    },
    th: {
      watch: 'ดู',
      shorts: 'ชอร์ตส์',
      read: 'อ่าน',
      upcoming: 'กำลังจะมา',
      seeAllVideos: 'ดูวิดีโอทั้งหมดบน Signal',
      seeAllShorts: 'ดู Shorts ทั้งหมดบน Noise',
      seeAllArticles: 'ดูบทความทั้งหมด',
      fullCalendar: 'ปฏิทินเต็ม',
      liveFeed: '⚡ ฟีดสด',
      loadingHero: 'กำลังโหลด…',
    },
    hi: {
      watch: 'देखें',
      shorts: 'शॉर्ट्स',
      read: 'पढ़ें',
      upcoming: 'आने वाले',
      seeAllVideos: 'Signal पर सभी वीडियो',
      seeAllShorts: 'Noise पर सभी शॉर्ट्स',
      seeAllArticles: 'सभी लेख',
      fullCalendar: 'पूरा कैलेंडर',
      liveFeed: '⚡ लाइव फ़ीड',
      loadingHero: 'लोड हो रहा है…',
    },
  };
  var t = T[locale] || T.en;
  var arrow = ' →';

  // -----------------------------------------------------------
  // Inject layout into Webflow's main.body-content. Bail if the
  // host is already there (idempotent against double-injection).
  // -----------------------------------------------------------
  function inject() {
    if (document.getElementById('fk-feed-host')) return;
    var main = document.querySelector('main.body-content');
    if (!main) return;

    // Stylesheet
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = CDN + '/fk-homepage.css';
    document.head.appendChild(link);

    // Layout
    var html =
      '<div id="fk-feed-host" data-fk-version="2.0.0" data-fk-locale="' + locale + '">' +
        '<section class="hero">' +
          '<div id="fk-hero-target" style="position:absolute;inset:0;display:flex;align-items:flex-end;color:#fff;">' +
            '<div style="padding:48px;color:#fff;opacity:0.6;">' + t.loadingHero + '</div>' +
          '</div>' +
          '<div class="hero-arrows" style="z-index:4;">' +
            '<span data-hero-prev>‹</span><span data-hero-next>›</span>' +
          '</div>' +
          '<div class="hero-dots" style="z-index:4;"></div>' +
        '</section>' +
        '<div class="container">' +
          '<h2 class="section-title">' + t.watch +
            ' <a class="more" href="' + localePath + '/post-category/signal">' + t.seeAllVideos + arrow + '</a>' +
            ' <span class="live-tag">' + t.liveFeed + '</span>' +
          '</h2>' +
          '<div class="grid-4" id="fk-watch-target"></div>' +
        '</div>' +
        '<div class="container">' +
          '<h2 class="section-title">' + t.shorts +
            ' <a class="more" href="' + localePath + '/post-category/noise">' + t.seeAllShorts + arrow + '</a>' +
            ' <span class="live-tag">' + t.liveFeed + '</span>' +
          '</h2>' +
          '<div class="shorts-grid" id="fk-shorts-target"></div>' +
        '</div>' +
        '<div class="container">' +
          '<h2 class="section-title">' + t.read +
            ' <a class="more" href="' + localePath + '/post-category/signal">' + t.seeAllArticles + arrow + '</a>' +
            ' <span class="live-tag">' + t.liveFeed + '</span>' +
          '</h2>' +
          '<div class="grid-3" id="fk-read-target"></div>' +
        '</div>' +
        '<div class="container">' +
          '<h2 class="section-title">' + t.upcoming +
            ' <a class="more" href="#">' + t.fullCalendar + arrow + '</a>' +
            ' <span class="live-tag">' + t.liveFeed + '</span>' +
          '</h2>' +
          '<div class="event-grid" id="fk-events-target"></div>' +
        '</div>' +
      '</div>';

    main.insertAdjacentHTML('afterbegin', html);

    // Hide the rest of main.body-content (Mag Commerce template
    // sections) while keeping the original footer-section visible.
    var host = document.getElementById('fk-feed-host');
    var footer = document.getElementById('footer-section');
    Array.prototype.forEach.call(main.children, function (child) {
      if (child !== host && child !== footer) child.style.display = 'none';
    });

    // Load federated feed engine and wire up the targets
    var script = document.createElement('script');
    script.src = CDN + '/futurekeepers-feed.js';
    script.onload = function () {
      if (!window.FutureKeepersFeed) return;
      FutureKeepersFeed.renderInto('#fk-hero-target',   'hero',   3);
      FutureKeepersFeed.renderInto('#fk-watch-target',  'watch',  8);
      FutureKeepersFeed.renderInto('#fk-shorts-target', 'shorts', 6);
      FutureKeepersFeed.renderInto('#fk-read-target',   'read',   6);
      FutureKeepersFeed.renderInto('#fk-events-target', 'events', 6);
    };
    document.body.appendChild(script);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }
})();
