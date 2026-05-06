# FutureKeepers Website Assets

Static assets for **futurekeepers.world** homepage — served via [jsDelivr](https://www.jsdelivr.com/) CDN and loaded by Webflow Page Custom Code.

| File | Purpose |
|---|---|
| `fk-homepage.css` | Scoped styles for the `#fk-feed-host` injected homepage layout |
| `fk-homepage.html` | Reference: the HTML structure injected into Webflow's `main.body-content` |
| `futurekeepers-feed.js` | Federated feed engine — pulls YouTube long-form + Shorts, FK Signal Substack, ProElectrica Substack, Climate & Capital Asia RSS, Supabase events |

## CDN URLs (jsDelivr)

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/Talentlessai/futurekeepers-web@main/fk-homepage.css">
<script src="https://cdn.jsdelivr.net/gh/Talentlessai/futurekeepers-web@main/futurekeepers-feed.js"></script>
```

jsDelivr serves the latest commit on `main` via the `@main` tag. For pinned versions use a commit SHA: `@<sha>`.

## License

MIT — reuse the federation pattern freely.
