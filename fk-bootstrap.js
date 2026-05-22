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
  // Block the LEGACY pre-takeover bootstraps (d2f3988 era) so they don't
  // race with us. Note we do NOT use a generic V3 guard here — that
  // earlier scheme blocked newer bootstraps from running once an older
  // bootstrap had set the flag, defeating the in-place takeover. Each
  // bootstrap version now manages its own re-entry via the FK_VERSION
  // host-attribute check (set up below, after CDN detect).
  window.__fkBootstrapV2Ran = true;

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

  // Use the CDN's SHA portion as our version — guarantees every git commit
  // gets a unique FK_VERSION, so an older bootstrap's host always looks
  // "stale" to a newer bootstrap and the in-place takeover kicks in.
  var FK_VERSION = (CDN.split('@')[1] || 'main').substring(0, 12);

  // Re-entry guard tied to OUR specific SHA. Two instances of the SAME
  // bootstrap version short-circuit; different versions both run (the
  // newer one's host-version check will then take over the older one's
  // host in place). This is what prevents the V3-guard bug where any
  // bootstrap blocked all later ones regardless of version.
  if (window.__fkBootstrapVer === FK_VERSION) return;
  window.__fkBootstrapVer = FK_VERSION;

  // If a host with EXACTLY our SHA is already there, no-op.
  // Different SHA → fall through to the start() dispatcher and take over.
  var existing = document.getElementById('fk-feed-host');
  if (existing && existing.dataset.fkVersion === FK_VERSION) return;

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
      subscribe: 'Subscribe',
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
      subscribe: 'Berlangganan',
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
      subscribe: '订阅',
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
      subscribe: 'সাবস্ক্রাইব করুন',
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
      subscribe: 'سبسکرائب کریں',
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
      subscribe: 'ติดตาม',
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
      subscribe: 'सदस्यता लें',
    },
  };
  var t = T[locale] || T.en;
  var arrow = ' →';

  // -----------------------------------------------------------
  // Reload feed JS + re-render every target in the host. Used by
  // both fresh inject() AND in-place takeover. Idempotent — calling
  // it multiple times just overwrites the targets each time.
  // -----------------------------------------------------------
  function loadFeedAndRender() {
    // Drop any prior feed JS instances + global so we load the current
    // SHA's logic, not a leftover from an older bootstrap.
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
        FutureKeepersFeed.renderInto('#fk-hero-target',   'hero',   3);
        FutureKeepersFeed.renderInto('#fk-watch-target',  'watch',  8);
        FutureKeepersFeed.renderInto('#fk-shorts-target', 'shorts', 6);
        FutureKeepersFeed.renderInto('#fk-read-target',   'read',   6);
        FutureKeepersFeed.renderInto('#fk-events-target', 'events', 6);
      }
      doRender();
      // Render-race fix: an older bootstrap version (still in the page
      // because Webflow stacks every applied shim version) may have an
      // in-flight fetchAll that resolves AFTER our takeover and
      // overwrites our targets with stale data (e.g. English content
      // on the Hindi homepage). Re-rendering 7s later — after the
      // older bootstrap's 6.5s deadline has fired — guarantees the
      // newer locale-correct content is what the user ends up seeing.
      // Cache is already warm by then so the second render is instant.
      setTimeout(doRender, 7000);
    };
    document.body.appendChild(script);
  }

  // -----------------------------------------------------------
  // In-place takeover: an older-version host is already in the
  // DOM. Don't remove it (avoids the "content shows up then
  // disappears" flash Steve saw). Instead, refresh CSS, swap the
  // version marker, and re-render targets via current feed logic.
  // -----------------------------------------------------------
  function takeoverInPlace(existingHost) {
    Array.prototype.forEach.call(
      document.querySelectorAll('link[href*="fk-homepage.css"]'),
      function (l) { l.remove(); }
    );
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = CDN + '/fk-homepage.css';
    document.head.appendChild(link);
    existingHost.dataset.fkVersion = FK_VERSION;
    loadFeedAndRender();
  }

  // -----------------------------------------------------------
  // Fresh inject — host not yet in the DOM. Builds the layout
  // and hides Webflow's Mag Commerce sections.
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
      '<div id="fk-feed-host" data-fk-version="' + FK_VERSION + '" data-fk-locale="' + locale + '">' +
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
          '</h2>' +
          '<div class="grid-4" id="fk-watch-target"></div>' +
        '</div>' +
        '<div class="container">' +
          '<h2 class="section-title">' + t.shorts +
            ' <a class="more" href="' + localePath + '/post-category/noise">' + t.seeAllShorts + arrow + '</a>' +
          '</h2>' +
          '<div class="shorts-grid" id="fk-shorts-target"></div>' +
        '</div>' +
        '<div class="container">' +
          '<h2 class="section-title">' + t.read +
            ' <a class="more" href="' + localePath + '/post-category/signal">' + t.seeAllArticles + arrow + '</a>' +
          '</h2>' +
          '<div class="grid-3" id="fk-read-target"></div>' +
        '</div>' +
        '<div class="container">' +
          '<h2 class="section-title">' + t.upcoming +
            ' <a class="more" href="#">' + t.fullCalendar + arrow + '</a>' +
          '</h2>' +
          '<div class="event-grid" id="fk-events-target"></div>' +
        '</div>' +
        // No mid-page Subscribe section. FK Signal signup lives in the
        // site footer's Subscribe column (Webflow-native form swapped to
        // the Substack embed by the fk_subscribe_embed site script) — one
        // consistent subscribe spot on every page. Steve, May 22 2026.
      '</div>';

    main.insertAdjacentHTML('afterbegin', html);

    // Hide the rest of main.body-content (Mag Commerce template
    // sections) while keeping the original footer-section visible.
    var host = document.getElementById('fk-feed-host');
    var footer = document.getElementById('footer-section');
    Array.prototype.forEach.call(main.children, function (child) {
      if (child !== host && child !== footer) child.style.display = 'none';
    });

    loadFeedAndRender();
  }

  // Dispatcher — pick takeover or fresh inject based on what's in DOM
  function start() {
    var existingNow = document.getElementById('fk-feed-host');
    if (existingNow && existingNow.dataset.fkVersion !== FK_VERSION) {
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
