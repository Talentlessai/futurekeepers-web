#!/usr/bin/env node
/**
 * FK Feed Refresh — server-side bake.
 *
 * Run by GitHub Actions cron (daily) and committed to feed-cache/*.json.
 * The client (futurekeepers-feed.js) reads these JSON files via jsdelivr
 * and avoids the proxy + race + rate-limit dance entirely on first paint.
 *
 * Output:
 *   feed-cache/<locale>.json   — { generatedAt, locale, items: [...], counts: {...} }
 *   feed-cache/manifest.json   — { generatedAt, locales: {...} }
 *
 * No proxies needed because this runs server-side (Node) where CORS doesn't
 * apply — we hit YouTube/Substack/C&C directly.
 *
 * Run locally:  npm install && npm run refresh-feed
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { XMLParser } from 'fast-xml-parser';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const OUT_DIR = resolve(REPO_ROOT, 'feed-cache');

// -----------------------------------------------------------------------------
// CONFIG — mirror of futurekeepers-feed.js client config, kept in sync by hand.
// (When you add a new locale or rotate a channel ID, change BOTH files.)
// -----------------------------------------------------------------------------
const YOUTUBE_CHANNELS = {
  en: 'UCt-RNZMxKm5FpZITxHYEF3Q',
  id: 'UCOYDrFMDw0750hmsH3sTa8A',
  zh: 'UCuGMZ9sP3UQylrFQIQMZNzA',
  bn: 'UC23IKLcxVT9MtIvy4ivsDyQ',
  ur: 'UCWDjo1CRdJl66GcKH52by8g',
  th: 'UCqddPe00oaHHe_EMe5udlRQ',
  hi: 'UCo54PxsldKwPEHmlcRFAArA',
};

const LOCALES = Object.keys(YOUTUBE_CHANNELS);

const ENGLISH_ONLY_SOURCES = [
  {
    name: 'fkSignal',
    url: 'https://futurekeepers.substack.com/feed',
    feedType: 'rss',
    taxonomy: 'signal',
    format: 'newsletter',
    sourceLabel: 'FutureKeepers Signal',
  },
  {
    name: 'proElectrica',
    url: 'https://proelectrica.substack.com/feed',
    feedType: 'rss',
    taxonomy: 'voices',
    format: 'newsletter',
    sourceLabel: 'ProElectrica',
  },
  {
    name: 'ccAsia',
    url: 'https://www.climateandcapitalmedia.com/asia/feed/',
    feedType: 'rss',
    taxonomy: 'ccasia',
    format: 'article',
    sourceLabel: 'Climate & Capital Asia',
    proxyImages: true, // C&C blocks hotlinking; rewrite img URLs through weserv
  },
];

const FETCH_TIMEOUT_MS = 15000;
const USER_AGENT =
  'Mozilla/5.0 (compatible; FutureKeepersFeedRefresher/1.0; +https://futurekeepers.world)';

// -----------------------------------------------------------------------------
// XML parser (configured once, reused).
// -----------------------------------------------------------------------------
const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  removeNSPrefix: false,
  parseAttributeValue: false,
  // Turn repeated tags into arrays so we don't have to type-check on every access
  isArray: (name) => ['entry', 'item', 'enclosure', 'media:content', 'media:thumbnail'].includes(name),
});

// -----------------------------------------------------------------------------
// FETCH helpers.
// -----------------------------------------------------------------------------
async function fetchText(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'user-agent': USER_AGENT,
        accept: 'application/atom+xml, application/rss+xml, application/xml, text/xml, */*',
      },
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

// Best-effort: try the URL; if it 404s or returns HTML, return null instead of throwing.
async function tryFetch(url) {
  try {
    const text = await fetchText(url);
    // YouTube returns an HTML 404 page for missing playlists; reject anything not XML-ish.
    if (/^\s*(<!doctype html|<html)/i.test(text)) return null;
    if (text.length < 32) return null;
    return text;
  } catch (e) {
    return null;
  }
}

// rss2json fallback — used when direct fetch returns 404/HTML. YouTube's
// videos.xml endpoint is intermittently picky about IP/UA combinations
// (e.g. dev machines often get 404; GitHub Actions runners usually don't).
// rss2json gives us a consistent answer either way for ~10K free requests
// per day, which is way more than we need for a daily cron across 7 locales.
async function tryFetchViaRss2json(rssUrl, attempt = 0) {
  const url = 'https://api.rss2json.com/v1/api.json?rss_url=' + encodeURIComponent(rssUrl);
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': USER_AGENT },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data && data.status === 'ok' && Array.isArray(data.items)) return data;
    // Rate-limit message — retry once after backoff. The free tier throttles
    // when we issue many requests in quick succession; a 2s pause clears it.
    if (
      data?.message &&
      /short period|api key|too many requests/i.test(data.message) &&
      attempt < 4
    ) {
      // Backoff schedule: 3s → 6s → 12s → 24s. Total max wait 45s if all
      // four retries fire, well under the 10-minute job timeout. The free
      // rss2json tier rate-limits per IP, and GitHub Actions runners share
      // a busy pool, so we need to be patient.
      const wait = 3000 * Math.pow(2, attempt);
      console.warn(`  rss2json rate-limited; retry ${attempt + 1}/4 in ${wait}ms...`);
      await new Promise((r) => setTimeout(r, wait));
      return tryFetchViaRss2json(rssUrl, attempt + 1);
    }
    return null;
  } catch (e) {
    return null;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Convert rss2json's JSON shape into our normalized item array, mirroring
// what parseAtomEntries / parseRssItems would produce from raw XML.
function rss2jsonToItems(data, source) {
  return data.items.map((it) =>
    makeItem({
      source,
      title: it.title,
      link: it.link,
      publishDate: it.pubDate ? new Date(it.pubDate) : null,
      thumbnail: it.thumbnail || extractThumbFromHtml(it.content || it.description),
      description: it.description,
      author: it.author,
    })
  );
}

// -----------------------------------------------------------------------------
// PARSERS — mirror of the client. Output shape MUST match what the client
// expects so we can drop the proxy chain without touching renderers.
// -----------------------------------------------------------------------------

function stripHtml(s) {
  return String(s || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function pickText(node) {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (typeof node === 'object') {
    if ('#text' in node) return String(node['#text']);
    // Some Atom feeds use <title type="text">…</title> with attributes; fall through
  }
  return '';
}

function maybeProxyImage(url, proxyImages) {
  if (!proxyImages || !url) return url || null;
  if (/^data:/i.test(url)) return url;
  return 'https://images.weserv.nl/?url=' + url.replace(/^https?:\/\//i, '');
}

function extractThumbFromHtml(html) {
  if (!html) return null;
  const m = String(html).match(/<img[^>]+src=["']([^"']+)["']/i);
  if (m && m[1] && !/tracking|pixel|spacer|1x1/i.test(m[1])) return m[1];
  return null;
}

// Atom (YouTube channel + playlist feeds)
function parseAtomEntries(parsed, source) {
  const feed = parsed?.feed;
  if (!feed) return [];
  const entries = Array.isArray(feed.entry) ? feed.entry : feed.entry ? [feed.entry] : [];
  return entries.map((e) => {
    const linkArr = Array.isArray(e.link) ? e.link : [e.link].filter(Boolean);
    const link = linkArr.find((l) => l?.['@_rel'] === 'alternate' || !l?.['@_rel'])?.['@_href'] || '';
    const title = pickText(e.title);
    const published = pickText(e.published) || pickText(e.updated);
    const mg = e['media:group'] || {};
    const thumb = mg['media:thumbnail'];
    const thumbnail = Array.isArray(thumb)
      ? thumb[0]?.['@_url']
      : thumb?.['@_url'] || null;
    const description = pickText(mg['media:description'] || '');
    const author =
      pickText(e.author?.name) || pickText(e.author) || source.sourceLabel || '';
    return makeItem({
      source,
      title,
      link,
      publishDate: published ? new Date(published) : null,
      thumbnail,
      description,
      author,
    });
  });
}

// RSS 2.0 (Substack + C&C)
function parseRssItems(parsed, source) {
  const channel = parsed?.rss?.channel;
  if (!channel) return [];
  const items = Array.isArray(channel.item) ? channel.item : channel.item ? [channel.item] : [];
  return items.map((it) => {
    const title = pickText(it.title);
    const link = pickText(it.link);
    const pubDate = pickText(it.pubDate) || pickText(it['dc:date']);
    const description = pickText(it.description);
    const contentEncoded = pickText(it['content:encoded']) || description;
    const author = pickText(it['dc:creator']) || pickText(it.author);
    let thumbnail = extractRssItemThumbnail(it, contentEncoded, description);
    return makeItem({
      source,
      title,
      link,
      publishDate: pubDate ? new Date(pubDate) : null,
      thumbnail,
      description: stripHtml(description).slice(0, 220),
      author,
    });
  });
}

function extractRssItemThumbnail(it, contentEncoded, description) {
  // 1. <enclosure url=… type="image/*">
  const enc = it.enclosure;
  const encs = Array.isArray(enc) ? enc : enc ? [enc] : [];
  for (const e of encs) {
    const url = e['@_url'];
    const type = e['@_type'] || '';
    if (url && /^image\//i.test(type)) return url;
  }
  for (const e of encs) {
    const url = e['@_url'];
    if (url && /\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(url)) return url;
  }
  // 2. media:content / media:thumbnail
  const mc = it['media:content'];
  const mcs = Array.isArray(mc) ? mc : mc ? [mc] : [];
  for (const m of mcs) {
    const url = m['@_url'];
    const medium = m['@_medium'] || '';
    const type = m['@_type'] || '';
    if (
      url &&
      (/^image\//i.test(type) || /image/i.test(medium) || /\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(url))
    ) {
      return url;
    }
  }
  const mt = it['media:thumbnail'];
  const mts = Array.isArray(mt) ? mt : mt ? [mt] : [];
  for (const m of mts) {
    const url = m['@_url'];
    if (url) return url;
  }
  // 3. itunes:image href
  const itunesImage = it['itunes:image'];
  if (itunesImage?.['@_href']) return itunesImage['@_href'];
  // 4. img tag in content
  const haystack = (contentEncoded || '') + ' ' + (description || '');
  const m = haystack.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (m && m[1] && !/tracking|pixel|spacer|1x1/i.test(m[1])) return m[1];
  return null;
}

function makeItem({ source, title, link, publishDate, thumbnail, description, author }) {
  return {
    source: source.name,
    sourceLabel: source.sourceLabel,
    taxonomy: source.taxonomy,
    format: source.format,
    title: stripHtml(title || '').slice(0, 200),
    link: link || '',
    publishDate: publishDate && !isNaN(publishDate) ? publishDate.toISOString() : null,
    thumbnail: thumbnail ? maybeProxyImage(thumbnail, source.proxyImages) : null,
    description: stripHtml(description || '').slice(0, 220),
    author: author ? stripHtml(author) : null,
  };
}

// -----------------------------------------------------------------------------
// FETCHERS — one per logical source. Each returns an array of normalized items.
// -----------------------------------------------------------------------------

// Two-stage fetch: direct XML first, rss2json fallback when YouTube blocks
// the direct request (depends on runner IP / UA). Both paths produce the
// same normalized item shape via the source descriptor.
async function fetchYouTubeFeedNormalized(rssUrl, source, isAtom = true) {
  // Stage 1 — direct
  const xmlText = await tryFetch(rssUrl);
  if (xmlText) {
    const parsed = xml.parse(xmlText);
    return isAtom ? parseAtomEntries(parsed, source) : parseRssItems(parsed, source);
  }
  // Stage 2 — rss2json
  const json = await tryFetchViaRss2json(rssUrl);
  if (json) return rss2jsonToItems(json, source);
  return [];
}

// YouTube long-form: try UULF playlist, fall back to channel feed filtered NOT-shorts
async function fetchYtLongForm(channelId) {
  const playlistUrl = `https://www.youtube.com/feeds/videos.xml?playlist_id=UULF${channelId.slice(2)}`;
  const channelUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
  const source = {
    name: 'ytLongForm',
    feedType: 'atom',
    taxonomy: 'signal',
    format: 'video',
    sourceLabel: 'FutureKeepers Channel',
  };
  let items = await fetchYouTubeFeedNormalized(playlistUrl, source);
  if (items.length === 0) {
    items = (await fetchYouTubeFeedNormalized(channelUrl, source)).filter(
      (i) => !/#shorts\b/i.test(i.title || '')
    );
  }
  return items;
}

async function fetchYtShorts(channelId) {
  const playlistUrl = `https://www.youtube.com/feeds/videos.xml?playlist_id=UUSH${channelId.slice(2)}`;
  const channelUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
  const source = {
    name: 'ytShorts',
    feedType: 'atom',
    taxonomy: 'noise',
    format: 'short',
    sourceLabel: 'FutureKeepers Channel',
  };
  let items = await fetchYouTubeFeedNormalized(playlistUrl, source);
  if (items.length === 0) {
    items = (await fetchYouTubeFeedNormalized(channelUrl, source)).filter((i) =>
      /#shorts\b/i.test(i.title || '')
    );
  }
  return items;
}

async function fetchRssSource(source) {
  const xmlText = await tryFetch(source.url);
  if (xmlText) {
    return parseRssItems(xml.parse(xmlText), source);
  }
  // Substack / C&C — last resort rss2json fallback (rare, but bullet-proofs the cron)
  const json = await tryFetchViaRss2json(source.url);
  if (json) return rss2jsonToItems(json, source);
  return [];
}

// -----------------------------------------------------------------------------
// MAIN
// -----------------------------------------------------------------------------

async function buildLocale(locale) {
  const channelId = YOUTUBE_CHANNELS[locale];
  console.log(`\n=== ${locale.toUpperCase()} (${channelId}) ===`);

  const tasks = [
    fetchYtLongForm(channelId).then((r) => ['ytLongForm', r]),
    fetchYtShorts(channelId).then((r) => ['ytShorts', r]),
  ];

  // English-only sources
  if (locale === 'en') {
    for (const s of ENGLISH_ONLY_SOURCES) {
      tasks.push(fetchRssSource(s).then((r) => [s.name, r]));
    }
  }

  const settled = await Promise.allSettled(tasks);
  const counts = {};
  let merged = [];
  for (const result of settled) {
    if (result.status === 'fulfilled') {
      const [name, items] = result.value;
      counts[name] = items.length;
      console.log(`  ${name.padEnd(15)} ${items.length} items`);
      merged.push(...items);
    } else {
      console.error(`  source failed:`, result.reason?.message || result.reason);
    }
  }

  // Filter invalid dates, sort newest first
  merged = merged.filter((i) => i.publishDate);
  merged.sort((a, b) => new Date(b.publishDate) - new Date(a.publishDate));

  // Keep top ~80 per locale — plenty for hero/Watch/Shorts/Read across the page
  // and keeps the JSON file under ~80KB which jsdelivr serves quickly.
  if (merged.length > 80) merged = merged.slice(0, 80);

  return {
    generatedAt: new Date().toISOString(),
    locale,
    counts,
    items: merged,
  };
}

async function main() {
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  const manifest = {
    generatedAt: new Date().toISOString(),
    locales: {},
  };

  for (const locale of LOCALES) {
    const data = await buildLocale(locale);
    const outPath = resolve(OUT_DIR, `${locale}.json`);
    writeFileSync(outPath, JSON.stringify(data, null, 2));
    manifest.locales[locale] = {
      itemCount: data.items.length,
      counts: data.counts,
      bytes: Buffer.byteLength(JSON.stringify(data)),
    };
    console.log(`  → wrote ${outPath} (${data.items.length} items)`);
    // Pace ourselves between locales to stay under rss2json's free-tier
    // burst limit. GitHub Actions runners share an IP pool that's already
    // hammering rss2json, so 800ms wasn't enough. 3s gives the rate-limit
    // window time to drain. Cron is daily so the extra ~20s doesn't matter.
    await sleep(3000);
  }

  writeFileSync(resolve(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log('\n✓ refresh complete');
  console.log(`Manifest:`, JSON.stringify(manifest, null, 2));
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
