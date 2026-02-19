# OD Flow Dashboard

Interactive web dashboard to visualize origin-destination (OD) flows between geographic zones.

## Features

- Zone outlines rendered from the provided shape file
- Click-to-select zones on the map (multi-select supported)
- Directional arrows for inbound and outbound flows
- Arrow thickness scaled by trip count
- Filters for minimum trip threshold and max arrows per direction
- Min/max distance filter (km)
- Toggles for showing inbound and/or outbound arrows
- Multi-select hour filter (0-23)
- Mode filter (`All`, `Non Classified`, `Rail`, `Road`, `Air`)
- Multi-zone AND filter: with 2+ selected zones, only trips between selected zones are shown

## Run locally

Data files are not included in this repository. Place your data files in `/data`:

- `deldd-5-border-traffic-internal-use-1771493885661-shapes.json`
- `deldd-5-border-traffic-internal-use-1771493885661-counts.csv`

From this folder:

```bash
python3 -m http.server 8000
```

Then open:

- http://localhost:8000

Note: Use a local web server (not `file://`) so browser `fetch()` can load the CSV and JSON files.
