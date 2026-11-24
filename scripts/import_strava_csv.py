#!/usr/bin/env python3
"""
Build data/data.json from Strava's bulk export, with no API credentials.

    python scripts/import_strava_csv.py path/to/activities.csv

Get the export from Strava: Settings -> My Account -> Download or Delete Your
Account -> Request Your Archive. The email can take a few hours; unzip it and
point this script at activities.csv.

Strava exports distance in metres, but some tools re-export in kilometres, so
the unit is auto-detected and can be forced with --distance-unit.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from datetime import date, datetime
from pathlib import Path

from update_strava import FOOT_TYPES, WHEEL_TYPES, build_payload, OUT_PATH

DATE_FORMATS = (
    "%b %d, %Y, %I:%M:%S %p",
    "%b %d, %Y %I:%M:%S %p",
    "%b %d, %Y",
    "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%dT%H:%M:%S",
    "%Y-%m-%d",
    "%d/%m/%Y %H:%M:%S",
    "%d/%m/%Y",
)


def normalise_key(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (value or "").lower())


def pick(fieldnames, *candidates):
    """Find a column by any of its likely names, ignoring case/punctuation."""
    lookup = {normalise_key(f): f for f in fieldnames if f}
    for name in candidates:
        key = normalise_key(name)
        if key in lookup:
            return lookup[key]
    return None


def parse_date(value: str) -> date | None:
    text = (value or "").strip()
    if not text:
        return None
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})", text)
    if m:
        return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    return None


def parse_seconds(value: str) -> int:
    text = (value or "").strip()
    if not text:
        return 0
    if ":" in text:
        try:
            parts = [float(p) for p in text.split(":")]
        except ValueError:
            return 0
        total = 0.0
        for part in parts:
            total = total * 60 + part
        return int(total)
    try:
        return int(float(text))
    except ValueError:
        return 0


def main() -> None:
    parser = argparse.ArgumentParser(description="Build data/data.json from a Strava CSV export")
    parser.add_argument("csv", help="path to activities.csv from the Strava archive")
    parser.add_argument("--out", default=str(OUT_PATH), help="output path")
    parser.add_argument("--distance-unit", choices=("auto", "m", "km"), default="auto",
                        help="unit of the Distance column (default: auto)")
    args = parser.parse_args()

    path = Path(args.csv)
    if not path.exists():
        sys.exit(f"No such file: {path}")

    with path.open(newline="", encoding="utf-8-sig") as fh:
        reader = csv.DictReader(fh)
        if not reader.fieldnames:
            sys.exit("The CSV has no header row.")

        col = {
            "id": pick(reader.fieldnames, "Activity ID", "id"),
            "date": pick(reader.fieldnames, "Activity Date", "date"),
            "name": pick(reader.fieldnames, "Activity Name", "name"),
            "type": pick(reader.fieldnames, "Activity Type", "type"),
            "distance": pick(reader.fieldnames, "Distance", "distance"),
            "elev": pick(reader.fieldnames, "Elevation Gain", "total elevation gain", "elevation"),
            "time": pick(reader.fieldnames, "Moving Time", "Elapsed Time", "moving time"),
        }
        missing = [k for k in ("date", "type", "distance") if not col[k]]
        if missing:
            sys.exit(f"Missing expected columns: {', '.join(missing)}. "
                     f"Found: {', '.join(reader.fieldnames)}")

        rows = []
        raw_distances = []
        for row in reader:
            sport_type = (row.get(col["type"]) or "").strip()
            if sport_type not in FOOT_TYPES and sport_type not in WHEEL_TYPES:
                continue
            try:
                distance = float((row.get(col["distance"]) or "0").replace(",", ""))
            except ValueError:
                continue
            if distance <= 0:
                continue
            when = parse_date(row.get(col["date"]) or "")
            if not when:
                continue
            raw_distances.append(distance)
            rows.append((row, sport_type, distance, when))

    if not rows:
        sys.exit("No run/ride rows found. Is this the right CSV?")

    unit = args.distance_unit
    if unit == "auto":
        # Strava writes metres. A real activity over 1000 units is metres;
        # a kilometre export tops out in the low hundreds.
        unit = "m" if max(raw_distances) > 1000 else "km"

    acts = []
    for row, sport_type, distance, when in rows:
        km = distance / 1000.0 if unit == "m" else distance
        if km <= 0 or km > 1000:
            continue
        try:
            elev = int(round(float((row.get(col["elev"]) or "0").replace(",", "") or 0)))
        except ValueError:
            elev = 0
        raw_id = (row.get(col["id"]) or "").strip()
        try:
            ident = int(raw_id)
        except ValueError:
            ident = raw_id or f"{when.isoformat()}-{len(acts)}"
        acts.append({
            "id": ident,
            "name": (row.get(col["name"]) or "Untitled").strip(),
            "type": sport_type,
            "sport": "foot" if sport_type in FOOT_TYPES else "wheel",
            "date": when.isoformat(),
            "km": round(km, 3),
            "elev_m": max(0, elev),
            "time_s": parse_seconds(row.get(col["time"]) or ""),
        })

    if not acts:
        sys.exit("Every row was filtered out — check the Distance column.")

    payload = build_payload(acts, source="strava")
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    t = payload["totals"]
    print(f"read {len(rows)} rows as {unit} (Distance column)")
    print(f"wrote {out}")
    print(f"  {payload['source']}: {t['all']['activities']} activities, "
          f"{t['foot']['km']:.1f} km foot, {t['wheel']['km']:.1f} km wheel")
    print(f"  journey: {payload['journey']['km']:.1f} / {payload['journey']['goal_km']:.0f} km")


if __name__ == "__main__":
    main()
