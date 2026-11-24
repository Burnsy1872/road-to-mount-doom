#!/usr/bin/env python3
"""
Build data/data.json for The Road to Mount Doom.

Two modes:

    python scripts/update_strava.py            # pull real activities from Strava
    python scripts/update_strava.py --sample   # write deterministic demo data

Strava credentials are read from the environment, or from a .env file next to
the repo root:

    STRAVA_CLIENT_ID=12345
    STRAVA_CLIENT_SECRET=abcdef...
    STRAVA_REFRESH_TOKEN=...

Get a refresh token once with scripts/authorize_strava.py, then reuse it
forever — it does not expire.

Only the standard library is used, so there is nothing to pip install.
"""

from __future__ import annotations

import argparse
import json
import os
import random
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT_PATH = ROOT / "data" / "data.json"

API = "https://www.strava.com/api/v3"
TOKEN_URL = "https://www.strava.com/oauth/token"

# --- the challenge ---------------------------------------------------------
JOURNEY_START = date(2026, 11, 17)   # first day that counts toward the journey
GOAL_KM = 2863.0                     # Hobbiton → Mount Doom
ATHLETE_NAME = ""                    # optional, shows nowhere yet

# Monthly oaths: a distance target for each pair of legs, reset on the 1st.
MONTHLY_FOOT_GOAL_KM = 70.0
MONTHLY_WHEEL_GOAL_KM = 200.0

# A quote for the day, rotated by date so the page changes without a rebuild.
QUOTES = [
    ("Not all those who wander are lost.", "J.R.R. Tolkien"),
    ("You shall not pass!", "Gandalf"),
    ("The road goes ever on and on.", "Bilbo Baggins"),
    ("There's some good in this world, Mr. Frodo, and it's worth fighting for.", "Samwise Gamgee"),
    ("I will not say: do not weep; for not all tears are an evil.", "Gandalf"),
    ("A wizard is never late, nor is he early, he arrives precisely when he means to.", "Gandalf"),
    ("Courage is found in unlikely places.", "Gildor"),
    ("Even the smallest person can change the course of the future.", "Galadriel"),
    ("There is nothing like looking, if you want to find something.", "Bilbo Baggins"),
    ("It's a dangerous business, Frodo, going out your door.", "Bilbo Baggins"),
    ("Faithless is he that says farewell when the road darkens.", "Gimli"),
    ("I am no man!", "Éowyn"),
    ("For Frodo.", "Samwise Gamgee"),
    ("The world is indeed full of peril, and in it there are many dark places.", "Haldir"),
]

FOOT_TYPES = {"Run", "TrailRun", "VirtualRun", "Walk", "Hike"}
WHEEL_TYPES = {"Ride", "VirtualRide", "EBikeRide", "MountainBikeRide",
               "GravelRide", "Handcycle"}


# --------------------------------------------------------------------------
# environment
# --------------------------------------------------------------------------

def load_dotenv(path: Path = ROOT / ".env") -> None:
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def require_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        sys.exit(
            f"Missing {name}.\n"
            "Put it in .env (see README) or run with --sample to build demo data."
        )
    return value


# --------------------------------------------------------------------------
# Strava
# --------------------------------------------------------------------------

def get_access_token() -> str:
    payload = urllib.parse.urlencode({
        "client_id": require_env("STRAVA_CLIENT_ID"),
        "client_secret": require_env("STRAVA_CLIENT_SECRET"),
        "grant_type": "refresh_token",
        "refresh_token": require_env("STRAVA_REFRESH_TOKEN"),
    }).encode()

    req = urllib.request.Request(
        TOKEN_URL, data=payload,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        body = json.load(resp)

    if "access_token" not in body:
        sys.exit(f"Strava rejected the refresh token: {body}")
    return body["access_token"]


def api_get(path: str, token: str, params: dict | None = None):
    url = f"{API}{path}"
    if params:
        url += "?" + urllib.parse.urlencode(params)

    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                return json.load(resp)
        except urllib.error.HTTPError as exc:
            if exc.code == 429 and attempt < 2:      # rate limited: wait it out
                reset = int(exc.headers.get("X-RateLimit-Reset", "60"))
                time.sleep(min(60, max(5, reset)))
                continue
            if exc.code == 401:
                sys.exit("Strava said the token is not valid (401). Re-run the script.")
            sys.exit(f"Strava API error {exc.code}: {exc.read()[:300]!r}")
        except urllib.error.URLError as exc:
            sys.exit(f"Could not reach Strava: {exc.reason}")
    sys.exit("Gave up after three attempts.")


def fetch_activities(token: str, max_pages: int = 40) -> list[dict]:
    """Every activity Strava will give us, newest first."""
    activities: list[dict] = []
    page = 1
    while page <= max_pages:
        batch = api_get("/athlete/activities", token,
                        {"per_page": 200, "page": page})
        if not batch:
            break
        activities.extend(batch)
        if len(batch) < 200:
            break
        page += 1
    return activities


def fetch_stats(token: str) -> dict:
    """Strava's own all-time totals for this athlete."""
    athlete = api_get("/athlete", token) or {}
    if not athlete.get("id"):
        return {}
    return api_get(f"/athletes/{athlete['id']}/stats", token) or {}


# --------------------------------------------------------------------------
# normalising
# --------------------------------------------------------------------------

def sport_of(activity: dict) -> str | None:
    kind = activity.get("sport_type") or activity.get("type") or ""
    if kind in FOOT_TYPES:
        return "foot"
    if kind in WHEEL_TYPES:
        return "wheel"
    return None


def activity_date(activity: dict) -> date:
    raw = activity.get("start_date_local") or activity.get("start_date") or ""
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00")).date()
    except ValueError:
        return date.today()


def normalise(activity: dict) -> dict:
    return {
        "id": activity.get("id"),
        "name": activity.get("name") or "Untitled",
        "type": activity.get("sport_type") or activity.get("type") or "Workout",
        "sport": sport_of(activity) or "other",
        "date": activity_date(activity).isoformat(),
        "km": round((activity.get("distance") or 0) / 1000, 3),
        "elev_m": round(activity.get("total_elevation_gain") or 0),
        "time_s": int(activity.get("moving_time") or 0),
    }


def blank_bucket() -> dict:
    return {"activities": 0, "km": 0.0, "elev_m": 0.0, "time_s": 0}


def add(bucket: dict, act: dict) -> None:
    bucket["activities"] += 1
    bucket["km"] += act["km"]
    bucket["elev_m"] += act["elev_m"]
    bucket["time_s"] += act["time_s"]


def round_bucket(bucket: dict) -> dict:
    return {
        "activities": bucket["activities"],
        "km": round(bucket["km"], 1),
        "elev_m": round(bucket["elev_m"]),
        "time_s": bucket["time_s"],
    }


def apply_stats(payload: dict, stats: dict, acts: list[dict]) -> None:
    """Reconcile the all-time cards with Strava's own totals endpoint.

    The activity feed and /athlete/stats can disagree slightly (Strava keeps
    its own rounding), so the official totals win for the ledger. Walks and
    hikes are added back because Strava's run totals exclude them.
    """
    def bucket(total: dict, extra: list[dict]) -> dict:
        return {
            "activities": int(total.get("count") or 0) + len(extra),
            "km": round((total.get("distance") or 0) / 1000
                        + sum(a["km"] for a in extra), 1),
            "elev_m": round((total.get("elevation_gain") or 0)
                            + sum(a["elev_m"] for a in extra)),
            "time_s": int(total.get("moving_time") or 0)
                      + sum(a["time_s"] for a in extra),
        }

    walks = [a for a in acts if a["type"] in ("Walk", "Hike")]
    foot = bucket(stats.get("all_run_totals") or {}, walks)
    wheel = bucket(stats.get("all_ride_totals") or {}, [])

    if not foot["activities"] and not wheel["activities"]:
        return

    payload["totals"] = {
        "foot": foot,
        "wheel": wheel,
        "all": {
            "activities": foot["activities"] + wheel["activities"],
            "km": round(foot["km"] + wheel["km"], 1),
            "elev_m": foot["elev_m"] + wheel["elev_m"],
            "time_s": foot["time_s"] + wheel["time_s"],
            "active_days": len({a["date"] for a in acts}),
        },
    }


def monday_of(d: date) -> date:
    return d - timedelta(days=d.weekday())


# --------------------------------------------------------------------------
# aggregation
# --------------------------------------------------------------------------

def build_payload(activities: list[dict], source: str) -> dict:
    acts = [a for a in activities if a["sport"] in ("foot", "wheel")]
    acts.sort(key=lambda a: a["date"])

    today = date.today()
    week_start = monday_of(today)
    month_start = today.replace(day=1)

    totals = {"foot": blank_bucket(), "wheel": blank_bucket(), "all": blank_bucket()}
    week = {"start": week_start.isoformat(), "foot_km": 0.0, "wheel_km": 0.0,
            "foot_elev_m": 0.0, "wheel_elev_m": 0.0, "foot_time_s": 0, "wheel_time_s": 0}
    month = {"start": month_start.isoformat(), "foot_km": 0.0, "wheel_km": 0.0}

    journey_km = 0.0
    weekly: dict[date, dict] = {}

    for act in acts:
        d = date.fromisoformat(act["date"])
        sport = act["sport"]

        add(totals[sport], act)
        add(totals["all"], act)

        if d >= week_start:
            week[f"{sport}_km"] += act["km"]
            week[f"{sport}_elev_m"] += act["elev_m"]
            week[f"{sport}_time_s"] += act["time_s"]
        if d >= month_start:
            month[f"{sport}_km"] += act["km"]
        if d >= JOURNEY_START:
            journey_km += act["km"]

        wk = monday_of(d)
        bucket = weekly.setdefault(wk, {"start": wk.isoformat(), "foot_km": 0.0,
                                        "wheel_km": 0.0, "elev_m": 0.0, "time_s": 0})
        bucket[f"{sport}_km"] += act["km"]
        bucket["elev_m"] += act["elev_m"]
        bucket["time_s"] += act["time_s"]

    # last twelve weeks, oldest first, including empty ones
    weeks = []
    for i in range(11, -1, -1):
        start = week_start - timedelta(weeks=i)
        bucket = weekly.get(start) or {"start": start.isoformat(), "foot_km": 0.0,
                                       "wheel_km": 0.0, "elev_m": 0.0, "time_s": 0}
        weeks.append({
            "start": start.isoformat(),
            "foot_km": round(bucket["foot_km"], 1),
            "wheel_km": round(bucket["wheel_km"], 1),
            "elev_m": round(bucket["elev_m"]),
            "time_s": int(bucket["time_s"]),
        })

    for key in ("foot_km", "wheel_km", "foot_elev_m", "wheel_elev_m"):
        week[key] = round(week[key], 1)
    for key in ("foot_time_s", "wheel_time_s"):
        week[key] = int(week[key])
    month["foot_km"] = round(month["foot_km"], 1)
    month["wheel_km"] = round(month["wheel_km"], 1)

    records = build_records(acts, weekly)
    streak = build_streak(acts)
    quote = QUOTES[today.timetuple().tm_yday % len(QUOTES)]
    active_days = len({a["date"] for a in acts})

    recent = [a for a in acts][-14:][::-1]

    totals_out = {k: round_bucket(v) for k, v in totals.items()}
    totals_out["all"]["active_days"] = active_days

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": source,
        "athlete": {"name": ATHLETE_NAME},
        "quote": {"text": quote[0], "author": quote[1]},
        "journey": {
            "start": JOURNEY_START.isoformat(),
            "goal_km": GOAL_KM,
            "km": round(journey_km, 1),
        },
        "totals": totals_out,
        "periods": {"week": week, "month": month},
        "goals": {
            "month": {
                "foot_km": MONTHLY_FOOT_GOAL_KM,
                "wheel_km": MONTHLY_WHEEL_GOAL_KM,
            },
        },
        "records": records,
        "streak": streak,
        "weeks": weeks,
        "activities": recent,
    }


def build_records(acts: list[dict], weekly: dict) -> list[dict]:
    out: list[dict] = []
    if not acts:
        return out

    foot = [a for a in acts if a["sport"] == "foot"]
    wheel = [a for a in acts if a["sport"] == "wheel"]

    def best(pool, key):
        return max(pool, key=lambda a: a[key]) if pool else None

    longest_run = best(foot, "km")
    if longest_run:
        out.append({"id": "longest-foot", "label": "Longest run",
                    "value": longest_run["km"], "unit": "km", "dec": 1,
                    "date": longest_run["date"], "activity": longest_run["name"]})

    longest_ride = best(wheel, "km")
    if longest_ride:
        out.append({"id": "longest-wheel", "label": "Longest ride",
                    "value": longest_ride["km"], "unit": "km", "dec": 1,
                    "date": longest_ride["date"], "activity": longest_ride["name"]})

    biggest_climb = best(acts, "elev_m")
    if biggest_climb:
        out.append({"id": "climb", "label": "Biggest climb",
                    "value": biggest_climb["elev_m"], "unit": "m", "dec": 0,
                    "date": biggest_climb["date"], "activity": biggest_climb["name"]})

    if weekly:
        top = max(weekly.values(), key=lambda w: w["foot_km"] + w["wheel_km"])
        out.append({"id": "week", "label": "Biggest week",
                    "value": round(top["foot_km"] + top["wheel_km"], 1), "unit": "km", "dec": 1,
                    "date": top["start"], "activity": "week beginning"})

    longest = build_streak(acts)
    out.append({"id": "streak", "label": "Longest streak",
                "value": longest["longest"], "unit": "days", "dec": 0,
                "date": longest.get("longest_end") or "", "activity": ""})

    return out


def build_streak(acts: list[dict]) -> dict:
    days = sorted({a["date"] for a in acts})
    if not days:
        return {"current": 0, "longest": 0, "longest_end": None}

    best = run = 1
    best_end = days[0]
    for prev, cur in zip(days, days[1:]):
        gap = (date.fromisoformat(cur) - date.fromisoformat(prev)).days
        run = run + 1 if gap == 1 else 1
        if run > best:
            best, best_end = run, cur

    today = date.today()
    current = 0
    if days and (today - date.fromisoformat(days[-1])).days <= 1:
        current = 1
        for prev, cur in zip(reversed(days[:-1]), reversed(days)):
            if (date.fromisoformat(cur) - date.fromisoformat(prev)).days == 1:
                current += 1
            else:
                break

    return {"current": current, "longest": best, "longest_end": best_end}


# --------------------------------------------------------------------------
# sample data (deterministic, so previews are stable)
# --------------------------------------------------------------------------

def sample_activities() -> list[dict]:
    rng = random.Random(20261124)
    today = date.today()
    acts: list[dict] = []

    names_run = ["Morning Run", "Evening Run", "Afternoon Run", "Tempo Run",
                 "Long Slow Distance", "Hill Repeats", "Recovery Jog"]
    names_ride = ["Afternoon Ride", "Zwift - Group Ride", "Zwift - Crit Cross",
                  "Sunday Endurance", "Commute", "Zwift - California Dreamin'",
                  "Gravel Loop"]

    for i in range(420):
        d = today - timedelta(days=i)
        if d.weekday() in (1, 3, 5) and rng.random() < 0.8:
            km = round(rng.gauss(7.2, 2.4), 1)
            acts.append({
                "id": 9000 + i, "name": rng.choice(names_run), "type": "Run",
                "sport": "foot", "date": d.isoformat(),
                "km": max(2.0, km),
                "elev_m": round(max(4, km * rng.uniform(6, 12))),
                "time_s": int(max(2.0, km) * rng.uniform(290, 340)),
            })
        if d.weekday() in (2, 6) and rng.random() < 0.62:
            km = round(rng.gauss(34, 16), 1)
            acts.append({
                "id": 8000 + i, "name": rng.choice(names_ride), "type": "Ride",
                "sport": "wheel", "date": d.isoformat(),
                "km": max(8.0, km),
                "elev_m": round(max(10, km * rng.uniform(6, 11))),
                "time_s": int(max(8.0, km) * rng.uniform(105, 140)),
            })

    # keep the last week looking like the real ledger: one run, no ride yet
    start = monday_of(today)
    acts = [a for a in acts if date.fromisoformat(a["date"]) < start]
    acts.append({"id": 9901, "name": "Evening Run", "type": "Run", "sport": "foot",
                 "date": start.isoformat(), "km": 5.0, "elev_m": 38, "time_s": 1870})
    if today > start:
        acts.append({"id": 9902, "name": "Morning Run", "type": "Run", "sport": "foot",
                     "date": (start + timedelta(days=1)).isoformat(),
                     "km": 6.1, "elev_m": 44, "time_s": 2210})

    acts.sort(key=lambda a: a["date"])
    return acts


# --------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="Build data/data.json")
    parser.add_argument("--sample", action="store_true",
                        help="write demo data instead of calling Strava")
    parser.add_argument("--out", default=str(OUT_PATH), help="output path")
    args = parser.parse_args()

    if args.sample:
        # sample_activities() is already in the normalised shape
        acts = sample_activities()
        payload = build_payload(acts, source="sample")
    else:
        load_dotenv()
        token = get_access_token()
        raw = fetch_activities(token)
        stats = fetch_stats(token)
        acts = [normalise(a) for a in raw]
        payload = build_payload(acts, source="strava")
        apply_stats(payload, stats, acts)

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n",
                   encoding="utf-8")

    t = payload["totals"]
    print(f"wrote {out}")
    print(f"  {payload['source']}: {t['all']['activities']} activities, "
          f"{t['foot']['km']:.1f} km foot, {t['wheel']['km']:.1f} km wheel")
    print(f"  journey: {payload['journey']['km']:.1f} / {payload['journey']['goal_km']:.0f} km")


if __name__ == "__main__":
    main()
