#!/usr/bin/env python3
"""Add more IKEA products to catalog/ikea-catalog.json, with sizes read from each product page.

build_ikea_catalog.py hand-picks product lines and types in their sizes. This script widens the
range the way IKEA's own category pages do (beds, bedside tables, wardrobes, sofas, rugs...): it
lists products per category through IKEA US search, opens each product page, and reads the
published measurements (Length, Width, Depth, Height, Headboard height, Diameter) so every added
piece is placed at its real size. Existing entries are kept; products already present (same
item number, page or product line) are skipped.

    python3 scripts/expand_ikea_catalog.py            # add
    python3 scripts/expand_ikea_catalog.py --dry-run  # list what would be added
"""
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

SEARCH = "https://sik.search.blue.cdtapps.com/us/en/search-result-page?q={q}&size=40&types=PRODUCT"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
CATALOG = Path(__file__).resolve().parent.parent / "catalog" / "ikea-catalog.json"

S, J, M, I, C, O = "scandinavian", "japandi", "midcentury", "industrial", "coastal", "modern-organic"

# (search query, words the IKEA type must contain, app category, how many to add)
CATEGORIES = [
    ("bed frame", ["bed frame"], "bed", 12),
    ("bed frame with mattress", ["bed frame"], "bed", 4),
    ("upholstered bed frame", ["bed frame"], "bed", 4),
    ("nightstand", ["nightstand", "bedside table"], "nightstand", 8),
    ("chest of drawers", ["chest of drawers", "dresser"], "dresser", 8),
    ("wardrobe", ["wardrobe"], "wardrobe", 8),
    ("bench", ["bench"], "bench", 4),
    ("sofa", ["sofa"], "sofa", 8),
    ("sectional sofa", ["sectional", "corner sofa"], "sectional", 4),
    ("armchair", ["armchair"], "armchair", 6),
    ("coffee table", ["coffee table"], "coffee-table", 6),
    ("side table", ["side table"], "side-table", 5),
    ("tv unit", ["tv unit", "tv bench"], "tv-console", 6),
    ("bookcase", ["bookcase", "shelving unit", "shelf unit"], "bookshelf", 6),
    ("dining table", ["dining table", "table"], "dining-table", 6),
    ("dining chair", ["chair"], "dining-chair", 6),
    ("desk", ["desk"], "desk", 5),
    ("office chair", ["office chair", "swivel chair"], "office-chair", 4),
    ("floor lamp", ["floor lamp", "uplighter"], "floor-lamp", 5),
    ("rug flatwoven", ["rug"], "rug", 6),
    # Pots for a table or counter (small) and for the floor (tall): most share one IKEA line, FEJKA.
    ("artificial potted plant", ["artificial potted plant", "artificial plant"], "plant", 16),
    ("artificial flowers in pot", ["artificial potted plant", "artificial plant"], "plant", 8),
]

EXCLUDE = [
    "junior", "children", "bunk", "loft", "daybed", "sofa-bed", "sofa bed", "sleeper", "crib", "cot",
    "cover", "leg", "cushion", "pad", "protector", "doll", "toy", "frame for", "underframe", "headboard",
    "table lamp", "extension", "gaming", "high chair", "stool", "bar", "outdoor", "garden", "wall",
    "fold", "bed base", "bed slat", "storage box", "insert", "kit", "set of", "cart", "trolley", "mirror",
]

COLORS = {
    "white": "#f4f4f1", "black": "#2f2f2f", "brown": "#8b6844", "beige": "#d9c8a9", "grey": "#9a9c9a",
    "gray": "#9a9c9a", "green": "#6b7f5e", "blue": "#5d7d94", "red": "#a9473f", "yellow": "#d8b64a",
    "orange": "#cc7a3d", "pink": "#d9a5a0", "turquoise": "#5aa6a0", "multicolour": "#cfc3ad",
    "silver colour": "#c3c6c6", "gold colour": "#b89a5a", "dark brown": "#4a3b33",
}
STYLES = {
    "white": [S, J, C], "beige": [S, J, O], "brown": [O, M], "black": [I, S], "grey": [S, I], "gray": [S, I],
    "green": [C, O], "blue": [C, S],
}

FRACTIONS = {"½": 0.5, "¼": 0.25, "¾": 0.75, "⅛": 0.125, "⅜": 0.375, "⅝": 0.625, "⅞": 0.875}


def inches(text: str) -> float | None:
    """'79 7/8 §' or '4 ¼ §' or "5 ' 7 §" (feet and inches) -> inches. § stands for the inch mark."""
    t = text.replace("§", "").replace('"', "").replace("\\", "").strip()
    feet = 0.0
    if "'" in t:
        ft, _, t = t.partition("'")
        try:
            feet = float(ft.strip()) * 12
        except ValueError:
            return None
        t = t.strip()
    total, seen = feet, bool(feet)
    for part in t.split():
        try:
            if part in FRACTIONS:
                total += FRACTIONS[part]
            elif "/" in part:
                a, b = part.split("/")
                total += float(a) / float(b)
            elif part[-1] in FRACTIONS:
                total += float(part[:-1]) + FRACTIONS[part[-1]]
            else:
                total += float(part)
            seen = True
        except ValueError:
            return None
    return total if seen else None


def get(url: str, timeout: int = 25) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html,application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf8", "replace")


def search(q: str):
    return [it["product"] for it in json.loads(get(SEARCH.format(q=urllib.parse.quote(q))))["searchResultPage"]["products"]["main"]["items"]]


def measurements(page: str) -> dict[str, float]:
    """The product's own measurements (the first list on the page; later ones are packaging)."""
    t = page.replace('\\\\"', "§").replace('\\"', "§")  # the page embeds the JSON with escaped inch marks
    start = t.find('"measurements":[{"measure"')
    if start < 0:
        return {}
    segment = t[start : t.find("]", start)]
    out = {}
    for measure, name in re.findall(r'"measure":"([^"]*)","name":"([^"]*)"', segment):
        v = inches(measure)
        if v is not None:
            out[name.lower()] = v * 2.54
    return out


def dims_for(cat: str, ms: dict[str, float]):
    """(w, d, h) in cm from published measurements, or None when the page lacks what we need."""
    L, Wd, D, H = ms.get("length"), ms.get("width"), ms.get("depth"), ms.get("height") or ms.get("headboard height")
    dia = ms.get("diameter")
    if cat == "bed":
        return (Wd, L, H) if Wd and L and H else None
    if cat == "rug":
        return (min(L, Wd), max(L, Wd), 1) if L and Wd else None
    if cat == "floor-lamp":
        base = dia or Wd or D or ms.get("base diameter") or 30
        return (base, base, H) if H else None
    if not H:
        return None
    if D and (Wd or L):
        return (Wd or L, D, H)
    if L and Wd:
        return (max(L, Wd), min(L, Wd), H)
    if dia:
        return (dia, dia, H)
    return None


def pick_color(p) -> tuple[str, list[str]]:
    names = [c.get("name", "").lower() for c in (p.get("colors") or [])]
    for n in names:
        if n in COLORS:
            return COLORS[n], STYLES.get(n, [S])
    return "#cfc3ad", [S]


def build(p, cat: str):
    page = get(p["pipUrl"])
    d = dims_for(cat, measurements(page))
    if not d:
        return None, "no measurements"
    w, dep, h = (round(x) for x in d)
    if cat == "dresser" and w < 60 and h < 80:
        cat = "nightstand"  # a small, low chest of drawers works as a bedside table
    if cat == "nightstand" and (w > 70 or h > 90):
        return None, "too big for a nightstand"
    if cat == "bed" and (w > 200 or h < 20):
        return None, "not a single bed frame"
    if min(w, dep) < 10 or max(w, dep, h) > 400:
        return None, f"implausible size {w}x{dep}x{h}"
    color, styles = pick_color(p)
    size = p.get("itemMeasureReferenceText") or ""
    variant = p.get("validDesignText") or ""
    name = ", ".join(x for x in [f"{p['name']} {p.get('typeName', '').lower()}".strip(), size, variant] if x)
    slug = re.sub(r"[^a-z0-9]+", "-", f"{p['name']}-{p.get('itemNoGlobal', '')}".lower()).strip("-")
    return {
        "id": f"ikea-{slug}",
        "name": name,
        "price": float(p["salesPrice"]["numeral"]),
        "category": cat,
        "dims": [w, dep, max(h, 1)],
        "color": color,
        "styles": styles,
        "placement": "floor",
        "url": p["pipUrl"],
        "image": p.get("contextualImageUrl") or p.get("mainImageUrl"),
        "cutout": p.get("mainImageUrl"),
        "itemNo": p.get("itemNoGlobal"),
    }, None


def main():
    dry = "--dry-run" in sys.argv
    raw = CATALOG.read_text()
    data = json.loads(raw)
    have_items = {x.get("itemNo") for x in data["products"]}
    have_urls = {x.get("url") for x in data["products"]}
    have_lines = {(x["name"].split()[0].upper(), x["category"]) for x in data["products"]}

    jobs, skipped = [], []
    for q, types, cat, n in CATEGORIES:
        try:
            items = search(q)
        except Exception as e:
            skipped.append(f"{q}: search failed ({e})")
            continue
        chosen, lines = [], set()
        for p in items:
            t = (p.get("typeName") or "").lower()
            line = (p.get("name") or "").upper()
            if not p.get("pipUrl") or not p.get("salesPrice"):
                continue
            if not any(x in t for x in types) or any(x in t for x in EXCLUDE):
                continue
            same_line = cat != "plant" and ((line, cat) in have_lines or line in lines)  # plants share one line (FEJKA)
            if p.get("itemNoGlobal") in have_items or p["pipUrl"] in have_urls or same_line:
                continue
            lines.add(line)
            chosen.append(p)
            if len(chosen) >= n:
                break
        jobs += [(p, cat) for p in chosen]
        time.sleep(0.2)

    def run(job):
        p, cat = job
        for attempt in range(2):
            try:
                time.sleep(0.2)
                return job, *build(p, cat)
            except Exception as e:
                err = str(e)
                time.sleep(1.5)
        return job, None, err

    added = []
    with ThreadPoolExecutor(max_workers=4) as ex:
        for (p, cat), item, err in ex.map(run, jobs):
            if item and item["id"] not in {x["id"] for x in data["products"]} | {x["id"] for x in added}:
                added.append(item)
                print(f"+ {item['category']:<13} {item['name'][:70]:<70} {item['dims']} ${item['price']:.0f}")
            else:
                skipped.append(f"{p['name']} {p.get('typeName', '')}: {err or 'duplicate'}")

    print(f"\n{len(added)} to add, {len(skipped)} skipped")
    for s in skipped[:40]:
        print("  skipped:", s, file=sys.stderr)
    if dry or not added:
        return
    for item in added:  # keep each category together
        idx = max((i for i, x in enumerate(data["products"]) if x["category"] == item["category"]), default=len(data["products"]) - 1)
        data["products"].insert(idx + 1, item)
    CATALOG.write_text(json.dumps(data, ensure_ascii=False, indent=1) + ("\n" if raw.endswith("\n") else ""))
    print(f"catalogue now has {len(data['products'])} products")


if __name__ == "__main__":
    main()
