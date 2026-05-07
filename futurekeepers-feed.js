/**
 * FutureKeepers Federated Feed v1.1
 * ==================================
 * Pulls recent items from YouTube + 3 Substacks + C&C Asia, merges by date,
 * exposes a clean API for rendering hero / Watch / Shorts / Read sections.
 *
 * Per Steve's content taxonomy:
 *   - Signal = long-form videos (UULF playlist) + FutureKeepers Signal Substack
 *   - Noise  = YouTube Shorts (UUSH playlist) — excluded from hero
 *   - Voices = Danny Kennedy's ProElectrica Substack
 *   - C&C    = Climate & Capital Asia (own brand, own pill)
 *
 * Architecture:
 *   1. YouTube auto-generates magic playlist IDs per channel:
 *        UU<id>   = all uploads (mixed)
 *        UULF<id> = long-form videos ONLY
 *        UUSH<id> = Shorts ONLY
 *      We use UULF for Watch and UUSH for Shorts. Zero manual playlist work.
 *   2. RSS feeds are fetched through corsproxy.io (free, no API key, raw XML pass-through).
 *   3. Atom (YouTube) and RSS 2.0 (Substack/C&C) are parsed client-side via DOMParser.
 *   4. Items are normalized into a single shape, merged, sorted by date desc.
 *   5. Public API: FutureKeepersFeed.getHero(), .getLatestVideos(), .getLatestShorts(), .getLatestArticles()
 *   6. Render helpers turn an item into a card HTML string ready to inject.
 *
 * Usage in Webflow:
 *   <script src="https://your-cdn/futurekeepers-feed.js"></script>
 *   <script>
 *     FutureKeepersFeed.renderInto('#hero-target',   'hero',   3);
 *     FutureKeepersFeed.renderInto('#watch-target',  'watch',  8);
 *     FutureKeepersFeed.renderInto('#shorts-target', 'shorts', 6);
 *     FutureKeepersFeed.renderInto('#read-target',   'read',   6);
 *   </script>
 *
 * Per-locale: locale is auto-detected from URL prefix; the appropriate per-locale
 * YouTube channel ID is used. Substacks/C&C are English-only and hidden on
 * non-English locales.
 */

(function (window) {
  'use strict';

  // ============================================================
  // CONFIG
  // ============================================================

  // YouTube channel IDs per locale (verified 2026-05-06)
  const YOUTUBE_CHANNELS = {
    en: 'UCt-RNZMxKm5FpZITxHYEF3Q', // FutureKeepers (main)
    id: 'UCOYDrFMDw0750hmsH3sTa8A', // FutureKeepers Indonesian
    zh: 'UCuGMZ9sP3UQylrFQIQMZNzA', // Future Keepers Mandarin
    bn: 'UC23IKLcxVT9MtIvy4ivsDyQ', // Future Keepers Bengali
    ur: 'UCWDjo1CRdJl66GcKH52by8g', // FutureKeepers Urdu
    th: 'UCqddPe00oaHHe_EMe5udlRQ', // FutureKeepers Thai
    hi: 'UCo54PxsldKwPEHmlcRFAArA', // Future Keepers Hindi
    tl: 'UCX2ZuZ8pVSWPdQDk2jH1KDQ', // Future Keepers Tagalog (channel exists)
  };

  // CORS proxy chain — tried in order, first one returning a non-empty body wins.
  // Different proxies have different per-source blind spots:
  //   - codetabs: fast for YouTube + C&C, silently returns 0 bytes for Substack
  //   - allorigins /raw: works for futurekeepers.substack, intermittent 522 on proelectrica
  //   - allorigins /get: JSON-wrapped, most resilient (works for proelectrica when /raw fails)
  // Each entry is { name, build(url), unwrap(body) } — unwrap exists for JSON-wrapped proxies.
  // Long-term upgrade: replace this with a Cloudflare Worker on FK's own infra
  // for full control + zero third-party dependency.
  const CORS_PROXIES = [
    {
      name: 'codetabs',
      build: function (url) { return 'https://api.codetabs.com/v1/proxy/?quest=' + url; },
      unwrap: function (body) { return body; },
    },
    {
      name: 'allorigins-raw',
      build: function (url) { return 'https://api.allorigins.win/raw?url=' + encodeURIComponent(url); },
      unwrap: function (body) { return body; },
    },
    {
      name: 'allorigins-get',
      build: function (url) { return 'https://api.allorigins.win/get?url=' + encodeURIComponent(url) + '&charset=UTF-8'; },
      unwrap: function (body) {
        try { return JSON.parse(body).contents || ''; } catch (e) { return ''; }
      },
    },
  ];
  // Backwards-compat alias for the diagnostic info object emitted from getStatus().
  const CORS_PROXY = 'codetabs+allorigins-raw+allorigins-get (chain)';

  // FK Brain (Supabase) — events_public REST endpoint.
  // The anon key is the public read-only key, safe to ship in client code.
  // Find/replace it in the Supabase dashboard → Settings → API → "anon public".
  const EVENTS_CONFIG = {
    url: 'https://gnfpboncbmmwzhawiicm.supabase.co/rest/v1/events_public',
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImduZnBib25jYm1td3poYXdpaWNtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY4MDE4NDksImV4cCI6MjA5MjM3Nzg0OX0.ilvG8dgm5f0bsDaYdHMHKasxDQA4mf54LJjIjecpQMc',
    // Order spec from Steve: featured items first, then by start_date ascending.
    order: 'featured.desc,start_date.asc',
    // Auto-prune happens server-side; we can also defensively filter past dates.
    filterPast: true,
  };

  function detectLocale() {
    // BUG fixed May 6 2026 (Steve caught this): the previous regex required
    // a trailing slash — /^\/(id|...)\// — which failed when Webflow
    // normalized the URL to /hi (no slash). Result: locale fell back to
    // 'en', and the Hindi page pulled English YouTube channel content
    // even though the bootstrap correctly translated section titles.
    // The (\/|$|\?) suffix matches /hi, /hi/, /hi?foo, /hi/?foo, etc.
    const m = window.location.pathname.match(/^\/(id|zh|bn|ur|th|hi|tl)(\/|$)/);
    return m ? m[1] : 'en';
  }

  const CURRENT_LOCALE = detectLocale();

  // Convert a YouTube channel ID into the magic playlist IDs.
  // YouTube auto-generates these per channel — no manual playlist setup needed.
  function ytPlaylistId(prefix, channelId) {
    return prefix + channelId.slice(2); // drop the leading "UC"
  }

  function buildSources() {
    const ytChannel = YOUTUBE_CHANNELS[CURRENT_LOCALE] || YOUTUBE_CHANNELS.en;
    const ytLongForm = ytPlaylistId('UULF', ytChannel); // long-form only
    const ytShorts = ytPlaylistId('UUSH', ytChannel);   // shorts only

    return {
      ytLongForm: {
        rss: 'https://www.youtube.com/feeds/videos.xml?playlist_id=' + ytLongForm,
        feedType: 'atom',
        taxonomy: 'signal',
        format: 'video',
        sourceLabel: 'FutureKeepers Channel',
      },
      ytShorts: {
        rss: 'https://www.youtube.com/feeds/videos.xml?playlist_id=' + ytShorts,
        feedType: 'atom',
        taxonomy: 'noise',
        format: 'short',
        sourceLabel: 'FutureKeepers Channel',
      },
      fkSignal: {
        rss: 'https://futurekeepers.substack.com/feed',
        feedType: 'rss',
        taxonomy: 'signal',
        format: 'newsletter',
        sourceLabel: 'FutureKeepers Signal',
        localesOnly: ['en'], // English-only source
      },
      proElectrica: {
        rss: 'https://proelectrica.substack.com/feed',
        feedType: 'rss',
        taxonomy: 'voices',
        format: 'newsletter',
        sourceLabel: 'ProElectrica',
        localesOnly: ['en'],
        // Every raw-XML proxy (codetabs/allorigins/raw/get) currently
        // times out for proelectrica.substack.com specifically. Skip
        // the chain and go straight to rss2json — works reliably and
        // is fast enough to come in under our 6.5s fetchAll deadline.
        useRss2jsonOnly: true,
      },
      ccAsia: {
        rss: 'https://www.climateandcapitalmedia.com/asia/feed/',
        feedType: 'rss',
        taxonomy: 'ccasia',
        format: 'article',
        sourceLabel: 'Climate & Capital Asia',
        localesOnly: ['en'],
        // C&C blocks hotlinking — return 403 when referer isn't theirs.
        // Route their image URLs through images.weserv.nl which proxies them cleanly.
        proxyImages: true,
      },
    };
  }

  // ============================================================
  // CACHE — localStorage with TTL
  // ============================================================
  const CACHE_KEY = 'fk_feed_v16_' + CURRENT_LOCALE; // bumped: reject HTML error pages from proxies, fall through to rss2json on XML parse fail
  const CACHE_TTL_MS = 30 * 60 * 1000;

  function readCache() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const { ts, data } = JSON.parse(raw);
      if (Date.now() - ts > CACHE_TTL_MS) return null;
      data.forEach((i) => { i.publishDate = new Date(i.publishDate); });
      return data;
    } catch (e) { return null; }
  }
  function writeCache(data) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data })); } catch (e) {}
  }

  // ============================================================
  // FETCH + PARSE (XML)
  // ============================================================
  // Per-proxy timeout: 3s. Tightened from 5s (May 6 2026) — at 5s a failing
  // source wedged the page for ~15s before bailing through all 3 proxies,
  // which is what made the homepage feel slow on first load. 3s is enough
  // for healthy proxies (typical 200–1500 ms) and bails 6s sooner on bad ones.
  const PROXY_TIMEOUT_MS = 3000;

  // Hard deadline on the whole fetchAll Promise.allSettled call. After this,
  // we resolve with whatever sources have responded so far and let the late
  // ones drop on the floor. Bumped from 6.5s to 10s May 6 2026 — at 6.5s
  // YouTube channels for several locales (zh/bn/ur) were being dropped
  // because the proxy chain + rss2json fallback didn't fit. 10s is still
  // fast on a warm cache (most loads bypass the deadline entirely).
  const FETCH_DEADLINE_MS = 10000;

  function fetchWithTimeout(url, ms) {
    if (typeof AbortController === 'undefined') return fetch(url);
    const ctrl = new AbortController();
    const t = setTimeout(function () { ctrl.abort(); }, ms);
    return fetch(url, { signal: ctrl.signal }).finally(function () { clearTimeout(t); });
  }

  // rss2json fallback: hits api.rss2json.com and converts JSON items into
  // our normalized item shape. Used as a last-resort fallback for sources
  // where every raw-XML proxy fails, and as the ONLY path for sources flagged
  // useRss2jsonOnly:true (proelectrica today).
  async function fetchViaRss2json(name, config) {
    const url = 'https://api.rss2json.com/v1/api.json?rss_url=' + encodeURIComponent(config.rss);
    const res = await fetchWithTimeout(url, PROXY_TIMEOUT_MS);
    if (!res.ok) throw new Error('rss2json HTTP ' + res.status);
    const data = await res.json();
    if (!data || data.status !== 'ok' || !Array.isArray(data.items)) {
      throw new Error('rss2json bad response');
    }
    return data.items.map(function (it) {
      return makeItem({
        sourceName: name,
        config: config,
        title: it.title,
        link: it.link,
        publishDate: it.pubDate ? new Date(it.pubDate) : null,
        thumbnail: it.thumbnail || extractThumbFromHtml(it.content || it.description),
        description: it.description,
        author: it.author,
      });
    });
  }

  async function fetchSource(name, config) {
    // Sources that ALWAYS fail the raw-XML proxy chain — skip the chain
    // and go straight to rss2json. Saves the 9-second timeout cycle and
    // gets actual content in under the fetchAll deadline.
    if (config.useRss2jsonOnly) {
      return await fetchViaRss2json(name, config);
    }
    let xmlText = null;
    let lastErr = null;
    // Walk the proxy chain. First success (non-empty XML body after unwrap) wins.
    for (let i = 0; i < CORS_PROXIES.length; i++) {
      const proxy = CORS_PROXIES[i];
      const proxyUrl = proxy.build(config.rss);
      try {
        const res = await fetchWithTimeout(proxyUrl, PROXY_TIMEOUT_MS);
        if (!res.ok) { lastErr = new Error(proxy.name + ' HTTP ' + res.status); continue; }
        const rawBody = await res.text();
        const body = proxy.unwrap(rawBody);
        if (!body || body.length < 32) { lastErr = new Error('empty body from ' + proxy.name); continue; }
        // Reject HTML error pages — codetabs sometimes returns a 200 with
        // an HTML rate-limit body instead of forwarding the XML feed,
        // which we used to accept and then choke on in DOMParser.
        if (/^\s*(<!doctype html|<html)/i.test(body)) {
          lastErr = new Error(proxy.name + ' returned HTML not XML');
          continue;
        }
        xmlText = body;
        break;
      } catch (e) {
        const msg = e && e.name === 'AbortError' ? 'timeout' : (e.message || e);
        lastErr = new Error(proxy.name + ': ' + msg);
      }
    }
    if (xmlText === null) {
      // Last-resort fallback: try rss2json. Same as useRss2jsonOnly path
      // but only after the raw-XML chain has exhausted itself.
      try { return await fetchViaRss2json(name, config); } catch (e) { /* throw lastErr below */ }
      throw lastErr || new Error('All proxies failed');
    }
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(xmlText, 'application/xml');
      // Defensive: detect parse errors
      if (doc.querySelector('parsererror')) throw new Error('XML parse error');
      const items = (config.feedType === 'atom')
        ? parseAtomEntries(doc, name, config)
        : parseRssItems(doc, name, config);
      return items;
    } catch (e) {
      console.warn('[FK Feed] Source XML parse failed, trying rss2json:', name, e.message);
      // Final retry: rss2json. The proxy returned content but it didn't
      // parse as XML — could be a CDN edge case or a rate-limit HTML
      // wrapper that snuck through our HTML check above.
      try { return await fetchViaRss2json(name, config); } catch (e2) { return []; }
    }
  }

  function extractThumbFromHtml(html) {
    if (!html) return null;
    const m = String(html).match(/<img[^>]+src=["']([^"']+)["']/i);
    if (m && m[1] && !/tracking|pixel|spacer|1x1/i.test(m[1])) return m[1];
    return null;
  }

  function parseAtomEntries(doc, sourceName, config) {
    const entries = doc.getElementsByTagName('entry');
    const out = [];
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const title = textOf(e, 'title');
      const link = e.getElementsByTagName('link')[0]?.getAttribute('href') || '';
      const published = textOf(e, 'published') || textOf(e, 'updated');
      // YouTube media:thumbnail
      const mediaGroup = e.getElementsByTagName('media:group')[0] || e.getElementsByTagNameNS('*', 'group')[0];
      let thumbnail = null;
      let description = '';
      if (mediaGroup) {
        const thumb = mediaGroup.getElementsByTagName('media:thumbnail')[0]
          || mediaGroup.getElementsByTagNameNS('*', 'thumbnail')[0];
        thumbnail = thumb?.getAttribute('url') || null;
        const descEl = mediaGroup.getElementsByTagName('media:description')[0]
          || mediaGroup.getElementsByTagNameNS('*', 'description')[0];
        description = descEl?.textContent || '';
      }
      out.push(makeItem({
        sourceName, config, title, link,
        publishDate: new Date(published),
        thumbnail, description,
        author: textOf(e, 'name'),
      }));
    }
    return out;
  }

  function parseRssItems(doc, sourceName, config) {
    const items = doc.getElementsByTagName('item');
    const out = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const title = textOf(it, 'title');
      const link = textOf(it, 'link');
      const pubDate = textOf(it, 'pubDate') || textOf(it, 'dc:date');
      const description = textOf(it, 'description');
      const contentEncoded = textOf(it, 'content:encoded') || description;
      const author = textOf(it, 'dc:creator') || textOf(it, 'author');
      const thumbnail = extractRssItemThumbnail(it, contentEncoded, description);
      out.push(makeItem({
        sourceName, config, title, link,
        publishDate: new Date(pubDate),
        thumbnail,
        description: stripHtml(description),
        author,
      }));
    }
    return out;
  }

  // Bulletproof thumbnail extraction. Tries multiple strategies in order:
  //   1. <enclosure type="image/*" url="…">       (C&C Asia uses this)
  //   2. <media:content medium="image" url="…">   (C&C Asia also uses this)
  //   3. <media:thumbnail url="…">                (some Substacks)
  //   4. <itunes:image href="…">                  (podcast feeds)
  //   5. <img src="…"> in content:encoded         (Substack body images)
  //   6. <img src="…"> in description             (last resort)
  // Children are walked via getElementsByTagName('*') with localName matching
  // because XML namespaces are handled inconsistently across browsers.
  function extractRssItemThumbnail(itemEl, contentEncoded, description) {
    // Strategy 1: enclosure with image type
    const enclosures = itemEl.getElementsByTagName('enclosure');
    for (let i = 0; i < enclosures.length; i++) {
      const url = enclosures[i].getAttribute('url');
      const type = enclosures[i].getAttribute('type') || '';
      if (url && /^image\//i.test(type)) return url;
    }
    // If type wasn't set, take any enclosure with a URL ending in image extension
    for (let i = 0; i < enclosures.length; i++) {
      const url = enclosures[i].getAttribute('url');
      if (url && /\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(url)) return url;
    }

    // Strategies 2-4: walk all child elements, match by localName
    const all = itemEl.getElementsByTagName('*');
    for (let i = 0; i < all.length; i++) {
      const el = all[i];
      const local = el.localName || (el.nodeName || '').split(':').pop();
      const lower = (local || '').toLowerCase();
      if (lower === 'content' || lower === 'thumbnail') {
        // media:content / media:thumbnail
        const url = el.getAttribute('url');
        const medium = el.getAttribute('medium') || '';
        const type = el.getAttribute('type') || '';
        // For media:content prefer image medium/type; for media:thumbnail any url is fine
        if (url && (lower === 'thumbnail'
          || /^image\//i.test(type)
          || /image/i.test(medium)
          || /\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(url))) {
          return url;
        }
      }
      if (lower === 'image') {
        // itunes:image href, or generic <image><url>...</url></image>
        const href = el.getAttribute('href');
        if (href) return href;
      }
    }

    // Strategies 5-6: regex img out of content
    const haystack = (contentEncoded || '') + ' ' + (description || '');
    const m = haystack.match(/<img[^>]+src=["']([^"']+)["']/i);
    if (m && m[1] && !/tracking|pixel|spacer|1x1/i.test(m[1])) return m[1];

    return null;
  }

  function makeItem({ sourceName, config, title, link, publishDate, thumbnail, description, author }) {
    return {
      source: sourceName,
      sourceLabel: config.sourceLabel,
      taxonomy: config.taxonomy,
      format: config.format,
      title: stripHtml(title || '').slice(0, 200),
      link: link || '',
      publishDate,
      thumbnail: thumbnail ? maybeProxyImage(thumbnail, config) : null,
      description: stripHtml(description || '').slice(0, 220),
      author: author ? stripHtml(author) : null,
    };
  }

  // Some sources (e.g. C&C) block hotlinking. Route their image URLs through
  // images.weserv.nl, a free Cloudflare-backed image proxy that fetches the
  // image server-side and serves it with permissive CORS / caching.
  function maybeProxyImage(url, config) {
    if (!config.proxyImages) return url;
    if (!url || /^data:/i.test(url)) return url;
    return 'https://images.weserv.nl/?url=' + url.replace(/^https?:\/\//i, '');
  }

  function textOf(parent, tag) {
    const el = parent.getElementsByTagName(tag)[0];
    return el ? (el.textContent || '').trim() : '';
  }

  function stripHtml(html) {
    return String(html || '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&[a-z#0-9]+;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // ============================================================
  // CORE: fetch and merge
  // ============================================================
  // In-flight de-dup: 5 renderInto calls fire ~simultaneously on page load
  // and each previously triggered its own full network fetch. Now we share
  // one in-flight Promise across all callers in the same tick so each source
  // is hit exactly once per page load.
  let _inflightFetchAll = null;

  async function fetchAll(opts) {
    opts = opts || {};
    if (!opts.skipCache) {
      const cached = readCache();
      if (cached) return cached;
    }
    if (_inflightFetchAll && !opts.forceRefresh) return _inflightFetchAll;

    _inflightFetchAll = (async () => {
      try {
        const sources = buildSources();
        const entries = Object.entries(sources)
          .filter(([_, cfg]) => !cfg.localesOnly || cfg.localesOnly.includes(CURRENT_LOCALE));

        // Race the per-source promises against a wall-clock deadline so the
        // page doesn't wait for the slowest dead-proxy chain. Sources that
        // miss the deadline get dropped just like ones that fail outright.
        const sourcePromises = entries.map(([name, cfg]) => fetchSource(name, cfg));
        const deadline = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('deadline')), FETCH_DEADLINE_MS)
        );
        const racedSettled = await Promise.allSettled(
          sourcePromises.map((p) => Promise.race([p, deadline]))
        );

        const results = racedSettled.map((s, idx) => {
          if (s.status === 'fulfilled') return s.value;
          console.warn('[FK Feed] Source dropped: ' + entries[idx][0] + ' — ' + (s.reason && s.reason.message || s.reason));
          return [];
        });
        const merged = results.flat().filter((i) => i.publishDate && !isNaN(i.publishDate));
        merged.sort((a, b) => b.publishDate - a.publishDate);
        writeCache(merged);
        return merged;
      } finally {
        _inflightFetchAll = null;
      }
    })();
    return _inflightFetchAll;
  }

  // ============================================================
  // EVENTS — FutureKeepers Brain (Supabase events_public)
  // ============================================================
  const EVENTS_CACHE_KEY = 'fk_events_v2_' + CURRENT_LOCALE; // bumped: normalize now uses real schema fields

  function readEventsCache() {
    try {
      const raw = localStorage.getItem(EVENTS_CACHE_KEY);
      if (!raw) return null;
      const { ts, data } = JSON.parse(raw);
      if (Date.now() - ts > CACHE_TTL_MS) return null;
      data.forEach((e) => {
        e.startDate = new Date(e.startDate);
        e.endDate = e.endDate ? new Date(e.endDate) : null;
      });
      return data;
    } catch (e) { return null; }
  }

  function writeEventsCache(data) {
    try { localStorage.setItem(EVENTS_CACHE_KEY, JSON.stringify({ ts: Date.now(), data })); } catch (e) {}
  }

  async function fetchEvents(opts) {
    opts = opts || {};
    if (!opts.skipCache) {
      const cached = readEventsCache();
      if (cached) return cached;
    }
    if (EVENTS_CONFIG.anonKey === '__PASTE_SUPABASE_ANON_KEY_HERE__') {
      console.warn('[FK Feed] Events: Supabase anon key not configured — paste it into EVENTS_CONFIG.anonKey in futurekeepers-feed.js');
      return [];
    }
    const limit = opts.limit || 20;
    const url = EVENTS_CONFIG.url + '?order=' + EVENTS_CONFIG.order + '&limit=' + limit;
    try {
      const res = await fetch(url, {
        headers: {
          'apikey': EVENTS_CONFIG.anonKey,
          'Authorization': 'Bearer ' + EVENTS_CONFIG.anonKey,
        },
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      let events = data.map(normalizeEvent);
      if (EVENTS_CONFIG.filterPast) {
        const now = Date.now();
        events = events.filter((e) => {
          const cutoff = (e.endDate || e.startDate || new Date(0)).getTime();
          return cutoff >= now;
        });
      }
      writeEventsCache(events);
      return events;
    } catch (e) {
      console.warn('[FK Feed] Events fetch failed:', e.message);
      return [];
    }
  }

  // Schema (verified 2026-05-06 against events_public):
  //   id, title, organizer, description, start_date, end_date, timezone,
  //   city, country, region, is_virtual, is_hybrid,
  //   registration_url, url, cost_tier, event_type, topics, why_attend, featured
  function normalizeEvent(raw) {
    const start = raw.start_date || raw.starts_at || raw.date;
    const end = raw.end_date || raw.ends_at;
    // Compose location from city + country (schema splits these)
    const locationParts = [raw.city, raw.country].filter(Boolean);
    const location = raw.location || raw.venue || (locationParts.length ? locationParts.join(', ') : null);
    return {
      id: raw.id,
      title: raw.title || raw.name || '(untitled)',
      organizer: raw.organizer || raw.host || null,
      description: raw.description || null,
      startDate: start ? new Date(start) : null,
      endDate: end ? new Date(end) : null,
      timezone: raw.timezone || null,
      location: location,
      city: raw.city || null,
      country: raw.country || null,
      region: raw.region || null,
      isVirtual: !!(raw.is_virtual || raw.virtual),
      isHybrid: !!(raw.is_hybrid || raw.hybrid),
      registrationUrl: raw.registration_url || raw.url || raw.link || null,
      whyItMatters: raw.why_attend || raw.why_it_matters || null,
      eventType: raw.event_type || null,
      costTier: raw.cost_tier || null,
      topics: Array.isArray(raw.topics) ? raw.topics : [],
      featured: !!raw.featured,
      thumbnail: raw.thumbnail_url || raw.image_url || raw.image || raw.thumbnail || null,
      raw,
    };
  }

  function renderEventCard(event) {
    if (!event.startDate) return '';
    const startMonth = event.startDate.toLocaleString('en-US', { month: 'short' }).toUpperCase();
    const startDay = event.startDate.getDate();
    let range = '';
    if (event.endDate) {
      const endDay = event.endDate.getDate();
      const endMonth = event.endDate.toLocaleString('en-US', { month: 'short' }).toUpperCase();
      const endYear = event.endDate.getFullYear();
      const startYear = event.startDate.getFullYear();
      if (endYear !== startYear) {
        range = "'" + String(endYear).slice(-2) + ' → ' + endDay;
      } else if (endMonth !== startMonth) {
        range = endMonth + ' ' + endDay;
      } else if (endDay !== startDay) {
        range = '→ ' + endDay;
      }
    }

    let locationLine = '';
    if (event.isVirtual && !event.isHybrid) {
      locationLine = '<div class="virt">Virtual' + (event.region && event.region !== 'Global' ? ' · ' + escapeHtml(event.region) : '') + '</div>';
    } else if (event.location) {
      locationLine = '<div class="loc">' + escapeHtml(event.location) + (event.isHybrid ? ' — hybrid' : '') + '</div>';
    } else if (event.region) {
      locationLine = '<div class="loc">' + escapeHtml(event.region) + '</div>';
    }

    // Prefer the event_type from the schema (e.g. "policy", "summit", "conference")
    // — falls back to virtual/hybrid/in-person if no type is set.
    let formatLabel;
    if (event.eventType) {
      formatLabel = event.eventType.charAt(0).toUpperCase() + event.eventType.slice(1);
    } else {
      formatLabel = event.isHybrid ? 'Hybrid' : event.isVirtual ? 'Virtual' : 'In-person';
    }
    const cta = event.registrationUrl
      ? '<a class="event-add" href="' + escapeHtml(event.registrationUrl) + '" target="_blank" rel="noopener">Register</a>'
      : '';

    return (
      '<article class="event-card">' +
        '<div class="event-date">' +
          '<div class="month">' + startMonth + '</div>' +
          '<div class="day">' + startDay + '</div>' +
          (range ? '<div class="range">' + escapeHtml(range) + '</div>' : '') +
        '</div>' +
        '<div class="event-body">' +
          '<h3>' + escapeHtml(event.title) + '</h3>' +
          locationLine +
          '<div class="event-meta">' +
            '<span class="pill event">' + escapeHtml(formatLabel) + '</span>' +
            cta +
          '</div>' +
        '</div>' +
      '</article>'
    );
  }

  // ============================================================
  // PUBLIC SELECTORS
  // ============================================================
  async function getAll() { return fetchAll(); }

  async function getHero(n) {
    n = n || 3;
    const all = await fetchAll();
    // Hero / masthead rules (Steve, May 6 2026):
    //   - No shorts (Steve's earlier rule — shorts read awkwardly large)
    //   - No C&C Asia. C&C is news (good and bad). FutureKeepers is hope and
    //     inspiration — the masthead should reflect FK's voice, not the news
    //     cycle. C&C still appears in Read, just not as the hero feature.
    return all
      .filter((i) => i.format !== 'short' && i.source !== 'ccAsia')
      .slice(0, n);
  }
  async function getLatestVideos(n) {
    n = n || 8;
    const all = await fetchAll();
    return all.filter((i) => i.format === 'video').slice(0, n);
  }
  async function getLatestShorts(n) {
    n = n || 6;
    const all = await fetchAll();
    return all.filter((i) => i.format === 'short').slice(0, n);
  }
  // ============================================================
  // CATEGORY PAGES — used by /post-category/<slug> renderer.
  //
  // The Webflow CMS that used to drive the category pages was being
  // fed by a broken n8n Substack→CMS automation, which means the post
  // grid on /post-category/signal etc. was stale (some posts pre-2020).
  // We replace it the same way we replaced the homepage: federate at
  // render time directly from each source.
  // ============================================================
  const CATEGORY_SOURCES = {
    'signal':           ['ytLongForm', 'fkSignal'],
    'noise':            ['ytShorts'],
    'voices':           ['proElectrica'],
    'climate-capital':  ['ccAsia'],
    // legacy slug — homepage doesn't link here, but old external links + 301s
    'cc-asia':          ['ccAsia'],
  };

  async function getCategoryItems(categorySlug, n) {
    n = n || 24;
    const sources = CATEGORY_SOURCES[(categorySlug || '').toLowerCase()];
    if (!sources) return [];
    const all = await fetchAll();
    return all.filter((i) => sources.indexOf(i.source) >= 0).slice(0, n);
  }

  // Picks the right card renderer based on each item's format. Used by
  // the category pages so a Signal page (which mixes long-form videos
  // with Substack articles) renders each as its native card type.
  function renderItemAuto(item) {
    if (item.format === 'video') return renderVideoCard(item);
    if (item.format === 'short') return renderShortCard(item);
    return renderArticleCard(item);
  }

  async function getLatestArticles(n) {
    n = n || 6;
    const all = await fetchAll();
    // Articles only — exclude YouTube videos and shorts
    const articles = all.filter((i) => i.format !== 'video' && i.format !== 'short');

    // Editorial rule (Steve, May 6 2026, refined): FutureKeepers is the brand voice
    // (hope, inspiration, original FK editorial). C&C Asia is partner content (news,
    // capital-and-policy news cycle). Voices is Danny Kennedy on ProElectrica
    // (FK-aligned but his own voice). The Read mix should reflect that:
    //
    //   - FK Signal leads, gets most slots
    //   - Voices (Danny) gets one slot when available
    //   - C&C Asia is capped at 1 slot, treated as a partner-content nod
    //
    // Default n=6 produces: 4 Signal + 1 Voices + 1 C&C when all 3 sources are healthy.
    // If a source is empty (proElectrica when its proxy is down), the freed slot goes
    // back to Signal, so Read never feels light when FK has fresh content.
    const buckets = { fkSignal: [], proElectrica: [], ccAsia: [] };
    articles.forEach((item) => {
      const bucket = buckets[item.source];
      if (bucket) bucket.push(item);
    });
    // CAPS — max items per source. When FK Signal has content, partner
    // content (C&C / Voices) is capped at 1 each so Signal dominates.
    // When FK Signal is empty (proxy outage etc.), the C&C cap relaxes so
    // Read still shows useful content rather than 1 lone card. Voices
    // stays capped at 1 because it's a guest voice, not a backfill source.
    const fkAvailable = buckets.fkSignal.length > 0;
    const caps = {
      fkSignal: n,
      proElectrica: 1,
      ccAsia: fkAvailable ? 1 : n,
    };
    const picked = [];
    function countSource(src) { return picked.filter((x) => x.source === src).length; }
    function tryTake(src) {
      if (picked.length >= n) return false;
      if (!buckets[src].length) return false;
      if (countSource(src) >= caps[src]) return false;
      picked.push(buckets[src].shift());
      return true;
    }
    // Selection order: 1 Voices first (Danny prominent), 1 C&C (partner nod),
    // then fill remaining slots with Signal.
    tryTake('proElectrica');
    tryTake('ccAsia');
    while (picked.length < n) { if (!tryTake('fkSignal')) break; }
    // Final backfill — only happens when Signal ran out before n. The
    // "progress" guard prevents an infinite loop if every remaining
    // bucket is at cap (e.g. only ccAsia has items and it's already used).
    while (picked.length < n) {
      let progress = false;
      for (const src of ['proElectrica', 'ccAsia', 'fkSignal']) {
        if (tryTake(src)) { progress = true; break; }
      }
      if (!progress) break;
    }
    return picked;
  }

  // ============================================================
  // RENDER HELPERS
  // ============================================================
  function relativeTime(date) {
    const diff = Date.now() - date.getTime();
    const mins = Math.round(diff / 60000);
    const hours = Math.round(mins / 60);
    const days = Math.round(hours / 24);
    if (mins < 60) return mins + 'm ago';
    if (hours < 24) return hours + 'h ago';
    if (days < 7) return days + 'd ago';
    if (days < 30) return Math.round(days / 7) + 'w ago';
    return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  }

  function pillClass(taxonomy) {
    return ({ signal: 'pill signal', voices: 'pill voices', noise: 'pill noise', ccasia: 'pill ccasia' })[taxonomy] || 'pill signal';
  }
  function pillLabel(taxonomy) {
    return ({ signal: 'Signal', voices: 'Voices', noise: 'Noise', ccasia: 'C&amp;C Asia' })[taxonomy] || 'Signal';
  }
  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  function renderVideoCard(item) {
    // Absolute position the thumbnail to fill .card-img regardless of the
    // parent's flex layout. Without `position:absolute;inset:0`, a flex
    // .card-img with align-items:flex-end shrinks the img to its intrinsic
    // size and parks it bottom-left — bug Steve caught on category pages.
    const thumb = item.thumbnail
      ? '<img src="' + escapeHtml(item.thumbnail) + '" alt="" loading="lazy" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;">'
      : '';
    return (
      '<a class="card" href="' + escapeHtml(item.link) + '" target="_blank" rel="noopener" style="text-decoration:none;color:inherit;">' +
        '<div class="card-img" style="background:#000;">' + thumb +
          '<div class="play-overlay"></div>' +
        '</div>' +
        '<div class="card-body">' +
          '<div class="card-meta">' +
            '<span class="' + pillClass(item.taxonomy) + '">' + pillLabel(item.taxonomy) + '</span>' +
            '<span class="pill-date">' + escapeHtml(relativeTime(item.publishDate)) + '</span>' +
          '</div>' +
          '<h3>' + escapeHtml(item.title) + '</h3>' +
        '</div>' +
      '</a>'
    );
  }

  function renderShortCard(item) {
    const thumb = item.thumbnail
      ? '<img src="' + escapeHtml(item.thumbnail) + '" alt="" loading="lazy" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;">'
      : '';
    return (
      '<a class="short-card" href="' + escapeHtml(item.link) + '" target="_blank" rel="noopener" style="text-decoration:none;color:inherit;">' +
        '<div class="short-img">' + thumb +
          '<span class="short-tag">Noise</span>' +
          '<div class="play-overlay-small"></div>' +
        '</div>' +
        '<div class="short-body"><h4>' + escapeHtml(item.title) + '</h4></div>' +
      '</a>'
    );
  }

  function renderArticleCard(item) {
    const thumb = item.thumbnail
      ? '<img src="' + escapeHtml(item.thumbnail) + '" alt="" loading="lazy" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;">'
      : '<span class="card-img-label">' + pillLabel(item.taxonomy) + '</span>';
    const author = item.author ? '<p class="by">by ' + escapeHtml(item.author) + '</p>' : '';
    const attribution = item.format !== 'video' && item.format !== 'short'
      ? ' <span style="color:#888;font-size:12px;">via ' + escapeHtml(item.sourceLabel) + '</span>'
      : '';
    const desc = item.description ? '<p>' + escapeHtml(item.description) + attribution + '</p>' : '';
    return (
      '<a class="card" href="' + escapeHtml(item.link) + '" target="_blank" rel="noopener" style="text-decoration:none;color:inherit;">' +
        '<div class="card-img ' + item.taxonomy + '-bg">' + thumb + '</div>' +
        '<div class="card-body">' +
          '<div class="card-meta">' +
            '<span class="' + pillClass(item.taxonomy) + '">' + pillLabel(item.taxonomy) + '</span>' +
            '<span class="pill-date">' + escapeHtml(relativeTime(item.publishDate)) + '</span>' +
          '</div>' +
          '<h3>' + escapeHtml(item.title) + '</h3>' +
          author +
          desc +
        '</div>' +
      '</a>'
    );
  }

  function renderHeroSlide(item) {
    const isVideo = item.format === 'video';
    const thumb = item.thumbnail ? '<img src="' + escapeHtml(item.thumbnail) + '" alt="" style="width:100%;height:100%;object-fit:cover;opacity:0.9;">' : '';
    return (
      '<a class="fk-hero-slide" href="' + escapeHtml(item.link) + '" target="_blank" rel="noopener" style="position:absolute;inset:0;display:block;text-decoration:none;color:inherit;">' +
        '<div style="position:absolute;inset:0;">' + thumb + '</div>' +
        '<div style="position:absolute;inset:0;background:linear-gradient(to top,rgba(0,0,0,0.88) 0%,rgba(0,0,0,0.55) 35%,rgba(0,0,0,0.15) 60%,transparent 80%);"></div>' +
        (isVideo ? '<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:96px;height:96px;background:rgba(0,0,0,0.7);border-radius:50%;display:flex;align-items:center;justify-content:center;border:3px solid rgba(255,255,255,0.95);z-index:2;"><span style="color:#fff;font-size:36px;margin-left:6px;">▶</span></div>' : '') +
        '<div class="hero-content" style="position:absolute;left:0;right:0;bottom:0;padding:48px;z-index:3;color:#fff;">' +
          '<span class="' + pillClass(item.taxonomy) + '" style="margin-right:8px;">' + pillLabel(item.taxonomy) + (isVideo ? ' · Watch' : '') + '</span>' +
          '<span class="hero-date">' + escapeHtml(relativeTime(item.publishDate)) + '</span>' +
          '<h1 style="margin-top:12px;">' + escapeHtml(item.title) + '</h1>' +
          '<p style="margin-top:8px;max-width:720px;">' + escapeHtml(item.description.slice(0, 180)) +
            ' <span style="opacity:0.85;font-size:13px;">via ' + escapeHtml(item.sourceLabel) + '</span>' +
          '</p>' +
        '</div>' +
      '</a>'
    );
  }

  // ============================================================
  // MOUNT
  // ============================================================
  async function renderInto(selector, slot, n) {
    const target = document.querySelector(selector);
    if (!target) {
      console.warn('[FK Feed] Mount target not found:', selector);
      return;
    }
    target.innerHTML = '<div style="padding:40px;text-align:center;color:#888;font-size:14px;">Loading…</div>';

    // Hero gets special treatment: it's a rotating carousel of N items.
    if (slot === 'hero') {
      try {
        const items = await getHero(n || 3);
        if (!items.length) {
          target.innerHTML = '<div style="padding:40px;color:#888;">No items.</div>';
          return;
        }
        target.innerHTML = items.map((item, i) =>
          '<div class="fk-slide" data-slide="' + i + '" style="position:absolute;inset:0;opacity:' +
          (i === 0 ? '1' : '0') +
          ';transition:opacity 0.6s ease;pointer-events:' +
          (i === 0 ? 'auto' : 'none') + ';">' +
          renderHeroSlide(item) +
          '</div>'
        ).join('');
        initHeroCarousel(target, items.length);
      } catch (e) {
        console.error('[FK Feed] Hero render failed', e);
        target.innerHTML = '<div style="padding:40px;color:#888;">Couldn\'t load hero.</div>';
      }
      return;
    }

    try {
      let items, renderer;
      if (false) { // placeholder for the now-handled hero branch
        items = []; renderer = renderHeroSlide;
      } else if (slot === 'watch') {
        items = await getLatestVideos(n || 8);
        renderer = renderVideoCard;
      } else if (slot === 'shorts') {
        items = await getLatestShorts(n || 6);
        renderer = renderShortCard;
      } else if (slot === 'read') {
        items = await getLatestArticles(n || 6);
        renderer = renderArticleCard;
      } else if (slot === 'events') {
        items = await fetchEvents({ limit: n || 6 });
        renderer = renderEventCard;
      } else if (slot && slot.indexOf('category-') === 0) {
        // category-<slug>: pulls items federated from the category's
        // configured sources, renders each with its native card type
        // (video / short / article). Used by /post-category/<slug>.
        const cat = slot.substring('category-'.length);
        items = await getCategoryItems(cat, n || 24);
        if (!items.length) {
          target.innerHTML = '<div style="padding:40px;text-align:center;color:#888;font-size:14px;">No items available right now.</div>';
          return;
        }
        target.innerHTML = items.map(renderItemAuto).join('');
        return;
      } else {
        items = (await fetchAll()).slice(0, n || 10);
        renderer = renderArticleCard;
      }
      if (!items.length) {
        target.innerHTML = '<div style="padding:40px;text-align:center;color:#888;font-size:14px;">No recent items.</div>';
        return;
      }
      target.innerHTML = items.map(renderer).join('');
    } catch (e) {
      console.error('[FK Feed]', e);
      target.innerHTML = '<div style="padding:40px;text-align:center;color:#888;font-size:14px;">Couldn\'t load feed. <a href="javascript:location.reload()" style="color:#f75327;">Retry</a></div>';
    }
  }

  // ============================================================
  // HERO CAROUSEL — wires the existing arrows + dots to slide rotation
  // ============================================================
  function initHeroCarousel(target, slideCount) {
    // Find the hero <section> wrapping the target so we can locate the
    // mockup's existing .hero-arrows and .hero-dots controls.
    const heroSection = target.closest('.hero') || target.parentElement;
    if (!heroSection) return;

    const slides = target.querySelectorAll('.fk-slide');
    const arrows = heroSection.querySelectorAll('.hero-arrows span');
    const prevBtn = arrows[0];
    const nextBtn = arrows[1];
    const dotsContainer = heroSection.querySelector('.hero-dots');

    // Regenerate dots to match actual slide count
    if (dotsContainer) {
      let html = '';
      for (let i = 0; i < slideCount; i++) html += '<span' + (i === 0 ? ' class="on"' : '') + '></span>';
      dotsContainer.innerHTML = html;
    }
    const dots = dotsContainer ? dotsContainer.querySelectorAll('span') : [];

    let current = 0;
    function show(idx) {
      current = ((idx % slideCount) + slideCount) % slideCount;
      slides.forEach((s, i) => {
        s.style.opacity = i === current ? '1' : '0';
        s.style.pointerEvents = i === current ? 'auto' : 'none';
      });
      dots.forEach((d, i) => d.classList.toggle('on', i === current));
    }

    if (prevBtn) prevBtn.style.cursor = 'pointer';
    if (nextBtn) nextBtn.style.cursor = 'pointer';
    if (prevBtn) prevBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); show(current - 1); });
    if (nextBtn) nextBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); show(current + 1); });
    dots.forEach((d, i) => {
      d.style.cursor = 'pointer';
      d.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); show(i); });
    });

    // Auto-advance every 7s; pause on hover
    let timer = setInterval(() => show(current + 1), 7000);
    heroSection.addEventListener('mouseenter', () => clearInterval(timer));
    heroSection.addEventListener('mouseleave', () => { timer = setInterval(() => show(current + 1), 7000); });
  }

  // ============================================================
  // EXPOSE
  // ============================================================
  window.FutureKeepersFeed = {
    version: '1.2.0',
    locale: CURRENT_LOCALE,
    config: {
      youtubeChannels: YOUTUBE_CHANNELS,
      corsProxy: CORS_PROXY,
      cacheKey: CACHE_KEY,
      cacheTtlMs: CACHE_TTL_MS,
      eventsConfig: EVENTS_CONFIG,
    },
    fetchAll, getAll, getHero, getLatestVideos, getLatestShorts, getLatestArticles, getCategoryItems,
    fetchEvents,
    renderInto, renderVideoCard, renderShortCard, renderArticleCard, renderHeroSlide, renderEventCard,
    clearCache: () => {
      try {
        localStorage.removeItem(CACHE_KEY);
        localStorage.removeItem(EVENTS_CACHE_KEY);
      } catch (e) {}
    },
    setSupabaseKey: (key) => { EVENTS_CONFIG.anonKey = key; },
  };

  console.log('[FK Feed] v1.16.0 loaded · locale=' + CURRENT_LOCALE);
})(window);
