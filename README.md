# What to Wear

A simple web app that tells you what to wear based on the weather in your current city — or any city you're traveling to.

## Features

- Auto-detects your location (with permission), or search any city
- Live weather + 5-day forecast (powered by [Open-Meteo](https://open-meteo.com))
- Outfit recommendation tuned to:
  - **Gender** styling preference (neutral / masc / femme)
  - **Temperature preference** — overdresser / average / underdresser
  - **Style context** — casual / business / outdoor
  - **Units** — metric or imperial
- Multi-day packing list when planning a trip
- Settings saved per-browser via `localStorage`

## Run locally

It's a static site — just open `index.html` in a browser, or serve the folder:

```bash
cd "CODE/what-to-wear"
python3 -m http.server 8080
# then visit http://localhost:8080
```

## Deploy

Drop the folder onto any static host. No build step, no env vars, no API keys.

- **Netlify:** drag-and-drop the folder at https://app.netlify.com/drop
- **Vercel:** `vercel` from the folder, or import the repo
- **Cloudflare Pages:** create a project, point at the folder
- **GitHub Pages:** push to a repo, enable Pages from the root

## APIs used

- Open-Meteo Forecast — weather + 5-day forecast (no API key)
- Open-Meteo Geocoding — city search (no API key)
- BigDataCloud reverse-geocoding-client — converts coords → city name (free, no key)
- Browser `navigator.geolocation` — current position

All API calls are client-side. No server required.

## Analytics (visit tracking)

Open `index.html`, scroll to the bottom — there's a comment block with four
privacy-friendly providers, all commented out. **Uncomment one and fill in your code/domain/token.**

### Quick start: GoatCounter (recommended)

Free, ~3 KB, no cookies, no GDPR banner needed.

1. Go to https://www.goatcounter.com/ and sign up (pick a subdomain — e.g. `whattowear`).
2. In `index.html` find this block and replace `YOURCODE`:

   ```html
   <script
     data-goatcounter="https://YOURCODE.goatcounter.com/count"
     async src="//gc.zgo.at/count.js"></script>
   ```

3. Uncomment it (remove the surrounding `<!-- -->`).
4. Deploy. Visit your dashboard at `https://YOURCODE.goatcounter.com/` to see hits.

### Other options (also pre-wired in the HTML)

- **Plausible** — €9/mo, very polished. Just set `data-domain`.
- **Cloudflare Web Analytics** — free if your domain is on Cloudflare DNS (you don't need to host there). Set `data-cf-beacon` token.
- **Umami** — free self-hosted, or use cloud.umami.is. Set `data-website-id`.

### Local visit counter

There's also a tiny built-in counter that increments in `localStorage` on every page load. Open the browser console and type `visits` to see `{ count, first, last }`. Useful for testing — not visible to other users.
