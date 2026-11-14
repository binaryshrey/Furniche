"""Build data/listings.json from the CoStar hackathon kit and the Matterport model index.

The output is git-ignored: the kit is licensed for the hackathon only.

Usage (from the repo root):
  python3 scripts/build_listings.py --region houston --kit ../costar-hackathon-kit --index ../matterport_kit/models_index.csv
"""
import argparse
import csv
import json
import os
import re

UNIT_PATTERN = re.compile(r"\d\s*(?:BR|Bd|Bed)|studio", re.I)


def read_index(path):
    with open(path, newline="") as f:
        return {row["sid"]: row for row in csv.DictReader(f)}


# The kit covers two metros; each model is placed by its coordinates.
REGIONS = {
    "houston": {"city": "Houston", "test": lambda lat, lon: 29.0 < lat < 30.6 and -96.5 < lon < -94.5},
    "la": {"city": "Los Angeles", "test": lambda lat, lon: lon < -110},
}
REGION = REGIONS["houston"]


def in_region(row):
    try:
        return REGION["test"](float(row["lat"]), float(row["lon"]))
    except (TypeError, ValueError):
        return False


def homes(kit, index):
    records = {}
    with open(os.path.join(kit, "data/residential-listings.jsonl")) as f:
        for line in f:
            r = json.loads(line)
            records[r["id"]] = r
    out, seen = [], set()
    with open(os.path.join(kit, "residential-listings.csv"), newline="") as f:
        for row in csv.DictReader(f):
            sid = row["MatterportModelId"]
            m = index.get(sid)
            if not sid or not m or not in_region(m) or m["defurnished"] != "yes" or sid in seen:
                continue
            r = records.get(int(row["ListingId"]))
            if not r:
                continue
            prop = r.get("property") or {}
            addr = prop.get("address") or {}
            seen.add(sid)
            out.append({
                "kind": "home",
                "sid": sid,
                "listingId": r["id"],
                "address": row["Address"] or m["address"],
                "city": row["City"] or REGION["city"],
                "price": r.get("currentPrice"),
                "beds": prop.get("bedsMin"),
                "baths": prop.get("bathsFull"),
                "sqft": prop.get("sqftMin"),
                "yearBuilt": prop.get("yearBuilt"),
                "status": r.get("listingStatus"),
                "lat": addr.get("latitude") or float(m["lat"]),
                "lon": addr.get("longitude") or float(m["lon"]),
                "rooms": int(m["room_count"] or 0),
                "splat": m["splat"] == "yes",
            })
    return out


def apartments(kit, index):
    rents = {}
    with open(os.path.join(kit, "data/apartment-listing.jsonl")) as f:
        for line in f:
            a = json.loads(line)
            if a.get("propertyId"):
                rents[a["propertyId"]] = a
    out = []
    with open(os.path.join(kit, "commercial-properties.csv"), newline="") as f:
        for row in csv.DictReader(f):
            sid = row["MatterportModelId"]
            m = index.get(sid)
            if not sid or not m or not in_region(m) or m["defurnished"] != "yes":
                continue
            if not UNIT_PATTERN.search(m["name"] or ""):
                continue
            a = rents.get(int(row["PropertyId"])) or {}
            out.append({
                "kind": "apartment",
                "sid": sid,
                "propertyId": int(row["PropertyId"]),
                "unitName": m["name"],
                "community": a.get("buildingName"),
                "address": row["Address"],
                "city": row["City"] or REGION["city"],
                "rentMin": a.get("minRent") or None,
                "rentMax": a.get("maxRent") or None,
                "lat": float(m["lat"]) if m["lat"] else None,
                "lon": float(m["lon"]) if m["lon"] else None,
                "rooms": int(m["room_count"] or 0),
            })
    return out


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--kit", default="../costar-hackathon-kit")
    p.add_argument("--index", default="../matterport_kit/models_index.csv")
    p.add_argument("--region", default="houston", choices=sorted(REGIONS))
    p.add_argument("--out", default="data/listings.json")
    a = p.parse_args()
    global REGION
    REGION = REGIONS[a.region]
    index = read_index(a.index)
    h, ap = homes(a.kit, index), apartments(a.kit, index)
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    with open(a.out, "w") as f:
        json.dump({"homes": h, "apartments": ap}, f)
    print(f"wrote {a.out}: {len(h)} homes, {len(ap)} apartment units")


if __name__ == "__main__":
    main()
