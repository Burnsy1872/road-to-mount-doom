# The Road to Mount Doom

A personal training ledger with a Middle-earth frame: every run and every ride
counted against the 2,863 km road from Hobbiton to the fires of Orodruin.

Static HTML, hand-written CSS, vanilla JavaScript. No build step, no framework,
no dependencies. Python is used only to pull activities from Strava and write a
single JSON file.

```
.
├── index.html                 markup shell (no data baked in)
├── css/style.css              all styling
├── js/
│   ├── journey.js             route geometry + waypoints (map coordinates)
│   └── app.js                 renders everything from data/data.json
├── data/data.json             generated — the only source of numbers
├── assets/
│   ├── map.webp / map.jpg     2000 px map (see licensing note)
│   ├── og.jpg                 1200×630 social card
│   └── icon.svg
├── .github/workflows/
│   └── update.yml             scheduled Strava refresh
└── scripts/
    ├── update_strava.py       builds data/data.json from the API
    ├── import_strava_csv.py   builds it from a bulk export (no credentials)
    └── authorize_strava.py    one-time: gets a refresh token
```

## Run it locally

ES modules need to be served over HTTP — opening `index.html` from disk will
fail on the `fetch` for the data file.

```powershell
python -m http.server 8123
# then open http://127.0.0.1:8123/
```

With no Strava credentials, generate demo data first:

```powershell
python scripts/update_strava.py --sample
```

## Connect Strava

Two ways in. The API is best for keeping the ledger current; the bulk export is
best for seeding your whole history without creating an API app.

### Option A — one-off import of your Strava archive

1. Strava → **Settings → My Account → Download or Delete Your Account → Request
   Your Archive**. The email can take a few hours.
2. Unzip it and point the importer at `activities.csv`:

   ```powershell
   python scripts/import_strava_csv.py "C:\path\to\activities.csv"
   ```

   No credentials are needed. Distance units are auto-detected (Strava writes
   metres), and the CSV is gitignored so your history stays local.
3. The importer prints the totals. They should match your all-time Strava
   figures — if they do, the whole ledger is real.

You can seed from a CSV now and switch to the API later; both go through the
same aggregation, so the numbers agree.

### Option B — the API

1. Create an API application at <https://www.strava.com/settings/api>.
   Set the "Authorization Callback Domain" to `localhost`.
2. Copy your Client ID and Client Secret into a `.env` file at the repo root:

   ```
   STRAVA_CLIENT_ID=12345
   STRAVA_CLIENT_SECRET=abcdef0123456789
   ```

3. Get a refresh token (one time only — it does not expire):

   ```powershell
   python scripts/authorize_strava.py
   ```

   It opens a Strava consent page, catches the redirect on localhost, and
   prints the refresh token to add to `.env`.

4. Build the real ledger:

   ```powershell
   python scripts/update_strava.py
   ```

## Keeping it current

`.github/workflows/update.yml` runs the script every morning and commits the new
`data/data.json`. Add the three values as repository secrets
(`STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `STRAVA_REFRESH_TOKEN`) and it runs
without you touching it.

To run it by hand: **Actions → Update ledger → Run workflow**.

## Deploy to GitHub Pages

```powershell
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/<you>/road-to-mount-doom.git
git push -u origin main
```

Then **Settings → Pages → Source: Deploy from a branch → main / (root)**.

Two things to update in `index.html` once you know the URL:

- `og:image` — social scrapers need an absolute URL
  (`https://<you>.github.io/road-to-mount-doom/assets/og.jpg`).
- Add a `<link rel="canonical">` if you attach a custom domain.

## How the data works

`data/data.json` is the only place numbers live. The page has no totals written
into the markup, so a failed update can never leave the site contradicting
itself — the worst case is that everything shows yesterday's figures.

```jsonc
{
  "generated_at": "2026-11-24T16:40:00+00:00",
  "source": "strava",              // or "sample"
  "journey": { "start": "2026-11-17", "goal_km": 2863, "km": 71.2 },
  "quote":   { "text": "Courage is found in unlikely places.", "author": "Gildor" },
  "totals":  { "foot": {…}, "wheel": {…}, "all": {…} },
  "periods": { "week": {…}, "month": {…} },
  "goals":   { "month": { "foot_km": 70, "wheel_km": 200 } },
  "records": [ { "label": "Longest run", "value": 32.1, "unit": "km", … } ],
  "streak":  { "current": 3, "longest": 9 },
  "weeks":   [ { "start": "2026-09-07", "foot_km": 18.2, … } ],  // 12, oldest first
  "activities": [ { "date": "2026-11-23", "sport": "foot", "km": 5.0, … } ]
}
```

`journey.km` is the sum of foot **and** wheel distance since `journey.start` —
the road counts both. Change `JOURNEY_START` in `scripts/update_strava.py` to
reset the challenge.

`totals.foot` counts every activity Strava classifies as foot-based — runs,
trail runs, virtual runs, walks and hikes. Strava's own `all_run_totals`
excludes walks, so a foot total here can be slightly higher than the run-only
figure. Remove `Walk`/`Hike` from `FOOT_TYPES` in the script if you want
run-only totals.

The weekly cards read `periods.week` (distance, ascent and moving time per
sport); the monthly oaths read `periods.month` against the two targets in
`goals.month`. Set `MONTHLY_FOOT_GOAL_KM` and `MONTHLY_WHEEL_GOAL_KM` at the top
of the script, not in the HTML, so the page and the ledger can never disagree.

The hero quote rotates by day of year through the `QUOTES` list in the same
script. The journal picks one of the twelve run / twelve ride / three walk
sentences in `js/app.js` from the activity id, so entries vary but stay stable
between refreshes.

### Two deliberate choices

**Kilometres are the unit; leagues are decoration.** The previous version
labelled kilometres as "leagues" and mixed the two in the same page. Here a
league is only ever shown as an explicit conversion (1 league ≈ 4.828 km), and
never as a unit on a distance that is really kilometres.

**The marker follows the road.** `js/journey.js` holds the route as a polyline
of map coordinates with a distance against each point. The marker is
interpolated *by distance*, so the dot is at Rivendell exactly when the ledger
reads 700 km. A straight line between two corners would drift off the map's own
geography as soon as you passed Bree.

## Accessibility

Lighthouse scores 100 for accessibility and best practice. Worth preserving:

- The journey bar is a real `progressbar` with `aria-valuenow`/`aria-valuetext`.
- The chart has a text summary in its `aria-label` and a full data table behind
  "View as a table".
- Map waymarks are `<button>`s with descriptive labels, so they are reachable by
  keyboard; the tooltip is `aria-hidden` to avoid duplicate announcements.
- `prefers-reduced-motion` disables every transition and the count-up.
- Text on parchment uses `#33271a` and `#6b4a2a` — both above 4.5:1.

## Licensing note on the map

`assets/map.jpg` and `assets/map.webp` are resized copies of a third-party
Middle-earth map scan (originally from the earlier site). It is **not** original
artwork and is almost certainly still under copyright. Fine for a private
ledger; if this repo is public, replace it with your own map or a stylised route
diagram. `js/journey.js` is the only file that needs the coordinates changed.
