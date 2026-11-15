#!/usr/bin/env python3
"""Build catalog/ikea-catalog.json from IKEA's own product search.

Each entry below names an IKEA product line and what we need to place it (category, footprint
in cm, colour for the stand-in, styles). The script looks it up on IKEA US search and keeps the
live name, type, price, product page and photos, so thumbnails and 3D models resolve to the exact
product. Entries IKEA no longer returns are skipped and reported.

    python3 scripts/build_ikea_catalog.py
"""
import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

SEARCH = "https://sik.search.blue.cdtapps.com/us/en/search-result-page?q={q}&size=24&types=PRODUCT"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"

# id, search query, words the IKEA type must contain, category, w, d, h (cm), colour, styles, placement
S = "scandinavian"
J = "japandi"
M = "midcentury"
I = "industrial"
C = "coastal"
O = "modern-organic"
F, W, OUT = "floor", "wall", "outdoor"

SPEC = [
    # Sofas and seating
    ("ikea-kivik-3", "KIVIK sofa Tibbleby beige", ["sofa"], "sofa", 228, 95, 83, "#cfc3ad", [S, O, C], F),
    ("ikea-ektorp-3", "EKTORP sofa Hallarp gray", ["sofa"], "sofa", 218, 88, 88, "#a7a9a6", [S, C], F),
    ("ikea-vimle-3", "VIMLE 3-seat sofa", ["sofa"], "sofa", 241, 98, 83, "#8d8f8c", [S, I], F),
    ("ikea-glostad", "GLOSTAD loveseat", ["loveseat", "sofa"], "sofa", 177, 89, 70, "#5b5d60", [S, I], F),
    ("ikea-uppland-3", "UPPLAND sofa", ["sofa"], "sofa", 231, 89, 85, "#e2dccf", [C, O, S], F),
    ("ikea-landskrona-3", "LANDSKRONA sofa", ["sofa"], "sofa", 204, 89, 78, "#4b5a4b", [M, I], F),
    ("ikea-soderhamn-3", "SÖDERHAMN 3-seat sofa", ["sofa"], "sofa", 198, 99, 83, "#d9d3c7", [J, S, O], F),
    ("ikea-friheten-corner", "FRIHETEN corner sofa-bed", ["sofa-bed", "sofa"], "sectional", 230, 151, 66, "#5b5d60", [I, S], F),
    ("ikea-kivik-sectional", "KIVIK sectional 4-seat", ["sectional"], "sectional", 318, 196, 83, "#cfc3ad", [S, O, C], F),
    ("ikea-poang", "POÄNG armchair birch", ["armchair"], "armchair", 68, 82, 100, "#d8c7a6", [S, J], F),
    ("ikea-strandmon", "STRANDMON wing chair", ["wing chair", "chair"], "armchair", 82, 96, 101, "#55585c", [C, S], F),
    ("ikea-ekero", "EKERÖ armchair", ["armchair"], "armchair", 70, 73, 76, "#c9b27c", [M, O], F),
    ("ikea-koarp", "KOARP armchair", ["armchair"], "armchair", 73, 86, 82, "#8a8c88", [M, S], F),
    ("ikea-alhult-bench", "ÅLHULT bench", ["bench"], "bench", 120, 38, 45, "#d9c09a", [S, J], F),
    ("ikea-valtorp-bench", "VALTORP bench", ["bench"], "bench", 110, 35, 45, "#8b6844", [O, M], F),
    ("ikea-hemnes-bench", "HEMNES bench", ["bench"], "bench", 98, 37, 47, "#ece8df", [C, S], F),
    ("ikea-franklin-bar", "FRANKLIN bar stool", ["bar stool"], "bar-stool", 44, 44, 99, "#3d4042", [I], F),

    # Tables
    ("ikea-lack-coffee", "LACK coffee table black-brown", ["coffee table"], "coffee-table", 90, 55, 45, "#3a2f2a", [S, I], F),
    ("ikea-listerby-coffee", "LISTERBY coffee table", ["coffee table"], "coffee-table", 140, 60, 50, "#b8936a", [J, S, O], F),
    ("ikea-vittsjo-coffee", "VITTSJÖ coffee table", ["coffee table"], "coffee-table", 90, 50, 40, "#3d4042", [I, M], F),
    ("ikea-stockholm-coffee", "STOCKHOLM coffee table walnut", ["coffee table"], "coffee-table", 180, 59, 40, "#6e4a33", [M, O], F),
    ("ikea-hemnes-coffee", "HEMNES coffee table white stain", ["coffee table"], "coffee-table", 118, 75, 46, "#ece8df", [C, S], F),
    ("ikea-lack-side", "LACK side table white", ["side table"], "side-table", 55, 55, 45, "#f2f2ef", [S], F),
    ("ikea-gladom", "GLADOM tray table", ["tray table", "table"], "side-table", 45, 45, 53, "#5a6b5a", [M, I], F),
    ("ikea-listerby-side", "LISTERBY side table beech", ["side table"], "side-table", 50, 50, 50, "#b8936a", [J, O], F),
    ("ikea-nasinge-table", "NÄSINGE extendable table", ["extendable table"], "dining-table", 160, 90, 75, "#b8936a", [S, J], F),
    ("ikea-tonstad-table", "TONSTAD extendable table", ["extendable table"], "dining-table", 160, 95, 75, "#8b6844", [M, O], F),
    ("ikea-morbylanga", "MÖRBYLÅNGA table oak", ["table"], "dining-table", 220, 100, 75, "#8b6844", [O, M], F),
    ("ikea-lisabo-table", "LISABO table ash", ["table"], "dining-table", 140, 78, 74, "#cfb38b", [J, S], F),
    ("ikea-docksta", "DOCKSTA table", ["table"], "round-table", 103, 103, 75, "#f4f4f1", [M, S], F),
    ("ikea-alhult-table", "ÅLHULT extendable table", ["extendable table"], "dining-table", 150, 90, 75, "#d9c09a", [S, J], F),
    ("ikea-lisabo-chair", "LISABO chair", ["chair"], "dining-chair", 46, 52, 80, "#cfb38b", [J, S], F),
    ("ikea-odger-chair", "ODGER chair", ["chair"], "dining-chair", 45, 51, 81, "#3d4042", [I, S], F),
    ("ikea-teodores", "TEODORES chair", ["chair"], "dining-chair", 47, 51, 80, "#f4f4f1", [S, C], F),
    ("ikea-krylbo", "KRYLBO chair", ["chair"], "dining-chair", 49, 53, 80, "#8b6844", [M, O], F),
    ("ikea-nasinge-chair", "NÄSINGE chair", ["chair"], "dining-chair", 43, 52, 91, "#ece8df", [C], F),

    # Storage and media
    ("ikea-kallax-2x4", "KALLAX shelf unit white", ["shelf unit"], "bookshelf", 77, 39, 147, "#f4f4f1", [S], F),
    ("ikea-billy", "BILLY bookcase white", ["bookcase"], "bookshelf", 80, 28, 202, "#f4f4f1", [S, C], F),
    ("ikea-hemnes-bookcase", "HEMNES bookcase", ["bookcase"], "bookshelf", 90, 37, 197, "#ece8df", [C, S], F),
    ("ikea-vittsjo-shelf", "VITTSJÖ shelf unit", ["shelf unit"], "bookshelf", 51, 36, 175, "#3d4042", [I], F),
    ("ikea-hemnes-tv", "HEMNES TV unit", ["tv unit"], "tv-console", 183, 47, 57, "#ece8df", [C, S], F),
    ("ikea-besta-tv", "BESTÅ TV bench", ["tv bench", "tv unit"], "tv-console", 180, 42, 38, "#3a2f2a", [I, M], F),
    ("ikea-brimnes-tv", "BRIMNES TV unit", ["tv unit"], "tv-console", 180, 41, 53, "#f4f4f1", [S], F),
    ("ikea-lack-tv", "LACK TV unit", ["tv unit"], "tv-console", 160, 35, 36, "#3a2f2a", [S, I], F),

    # Bedroom
    ("ikea-malm-queen", "MALM bed frame high queen", ["bed frame"], "bed", 165, 214, 100, "#e3d7c3", [S, J], F),
    ("ikea-hemnes-bed-queen", "HEMNES bed frame queen white stain", ["bed frame"], "bed", 174, 211, 112, "#ece8df", [C, S], F),
    ("ikea-songesand-queen", "SONGESAND bed frame queen", ["bed frame"], "bed", 173, 213, 95, "#4a3b33", [M, I], F),
    ("ikea-tarva-queen", "TARVA bed frame queen", ["bed frame"], "bed", 166, 209, 92, "#d9b98f", [J, S, O], F),
    ("ikea-neiden-full", "NEIDEN bed frame", ["bed frame"], "bed", 147, 197, 85, "#d9b98f", [J, S], F),
    ("ikea-kleppstad-queen", "KLEPPSTAD bed frame", ["bed frame"], "bed", 160, 206, 85, "#f4f4f1", [S], F),
    ("ikea-vesteroy-queen", "VESTERÖY pocket spring mattress queen", ["mattress"], "mattress", 152, 203, 27, "#f4f4f1", [S, J, C, O, M, I], F),
    ("ikea-foam-mattress", "foam mattress queen", ["foam mattress"], "mattress", 152, 203, 18, "#f4f4f1", [S, J, C, O, M, I], F),
    ("ikea-hybrid-mattress", "hybrid mattress queen", ["mattress"], "mattress", 152, 203, 30, "#f4f4f1", [S, J, C, O, M, I], F),
    ("ikea-valevag-queen", "VALEVÅG pocket spring mattress", ["mattress"], "mattress", 152, 203, 26, "#f4f4f1", [S, J, C, O, M, I], F),
    ("ikea-hemnes-nightstand", "HEMNES nightstand", ["nightstand"], "nightstand", 46, 35, 70, "#ece8df", [C, S], F),
    ("ikea-tarva-nightstand", "TARVA nightstand", ["nightstand"], "nightstand", 48, 39, 61, "#d9b98f", [J, S], F),
    ("ikea-storklinta-2", "STORKLINTA 2-drawer chest", ["2-drawer chest"], "nightstand", 40, 40, 57, "#f4f4f1", [S], F),
    ("ikea-nordli-2", "NORDLI 2-drawer chest", ["2-drawer chest"], "nightstand", 40, 47, 54, "#f4f4f1", [S, C], F),
    ("ikea-storklinta-6", "STORKLINTA 6-drawer dresser", ["6-drawer dresser"], "dresser", 140, 48, 75, "#f4f4f1", [S], F),
    ("ikea-hemnes-8", "HEMNES 8-drawer dresser", ["dresser"], "dresser", 160, 50, 96, "#ece8df", [C, S], F),
    ("ikea-vihals-6", "VIHALS 6-drawer dresser", ["6-drawer dresser"], "dresser", 140, 47, 75, "#ece8df", [C, S], F),
    ("ikea-pax-100", "PAX wardrobe white", ["wardrobe"], "wardrobe", 100, 58, 201, "#f4f4f1", [S], F),
    ("ikea-brimnes-wardrobe", "BRIMNES wardrobe with 3 doors", ["wardrobe"], "wardrobe", 117, 50, 190, "#f4f4f1", [S], F),

    # Office
    ("ikea-lisabo-desk", "LISABO desk", ["desk"], "desk", 118, 45, 74, "#cfb38b", [J, S], F),
    ("ikea-micke-desk", "MICKE desk", ["desk"], "desk", 105, 50, 75, "#f4f4f1", [S], F),
    ("ikea-desk-55", "desk 55", ["desk"], "desk", 140, 60, 73, "#f4f4f1", [S, I], F),
    ("ikea-markus", "MARKUS office chair", ["office chair"], "office-chair", 62, 60, 140, "#3d4042", [I, S], F),
    ("ikea-millberget", "MILLBERGET swivel chair", ["swivel chair", "chair"], "office-chair", 66, 66, 117, "#5a3f2e", [M, I], F),

    # Lighting
    ("ikea-hektar-floor", "HEKTAR floor lamp", ["floor lamp"], "floor-lamp", 40, 40, 181, "#3d4042", [I], F),
    ("ikea-nymane-floor", "NYMÅNE floor lamp", ["floor lamp"], "floor-lamp", 34, 34, 157, "#f4f4f1", [S, C], F),
    ("ikea-paper-floor", "paper floor lamp", ["floor lamp"], "floor-lamp", 30, 30, 120, "#f1ece0", [J, S], F),
    ("ikea-arc-floor", "arc floor lamp", ["floor lamp"], "floor-lamp", 40, 120, 190, "#b89a5a", [M, O], F),
    ("ikea-ranarp-floor", "RANARP floor lamp", ["floor lamp"], "floor-lamp", 30, 30, 153, "#3d4042", [I, M], F),
    ("ikea-tagarp-floor", "TÅGARP floor uplighter", ["floor uplighter", "floor lamp"], "floor-lamp", 34, 34, 178, "#3d4042", [I, S], F),
    ("ikea-vidja-floor", "VIDJA floor lamp", ["floor lamp"], "floor-lamp", 22, 22, 138, "#f1ece0", [J, C], F),

    # Rugs
    ("ikea-stockholm-rug", "STOCKHOLM rug flatwoven", ["rug"], "rug", 250, 350, 1, "#d8d2c6", [S, J], F),
    ("ikea-lohals-rug", "LOHALS rug flatwoven natural", ["rug"], "rug", 160, 230, 1, "#cdb48d", [C, J, O], F),
    ("ikea-tiphede-rug", "TIPHEDE rug", ["rug"], "rug", 155, 220, 1, "#e8e2d6", [S, C], F),
    ("ikea-round-rug", "round rug", ["rug"], "rug", 150, 150, 1, "#d9d1c3", [J, O], F),
    ("ikea-stoense-rug", "STOENSE rug low pile", ["rug"], "rug", 200, 300, 1, "#cfc8bb", [S, O], F),

    # Plants and showpieces
    ("ikea-fejka-fiddle", "FEJKA artificial potted plant 9 ¾ fiddle leaf fig", ["artificial potted plant", "plant"], "plant", 40, 40, 160, "#4c6b45", [O, C, J], F),
    ("ikea-fejka-monstera", "FEJKA artificial potted plant monstera", ["artificial potted plant", "plant"], "plant", 45, 45, 90, "#4c6b45", [O, C], F),
    ("ikea-fejka-olive", "FEJKA artificial potted plant olive", ["artificial potted plant", "plant"], "plant", 35, 35, 120, "#7d8a5a", [O, J], F),
    ("ikea-olivblad-stand", "OLIVBLAD plant stand", ["plant stand"], "decor", 37, 37, 58, "#3d4042", [I, O], F),
    ("ikea-branas-basket", "BRANÄS basket rattan", ["basket"], "decor", 32, 34, 32, "#c49a6c", [C, O, J], F),
    ("ikea-pouf", "pouffe", ["pouf"], "decor", 45, 45, 45, "#d9d3c7", [J, O, S], F),
    ("ikea-alseda-stool", "ALSEDA stool", ["stool"], "decor", 40, 40, 45, "#c49a6c", [C, O, J], F),
    ("ikea-strandmon-ottoman", "STRANDMON ottoman", ["ottoman"], "decor", 60, 40, 44, "#55585c", [C, S], F),
    ("ikea-floor-vase", "vase large", ["vase"], "decor", 25, 25, 45, "#c9b79c", [O, J], F),
    ("ikea-sculpture", "decoration sculpture", ["decoration", "sculpture"], "decor", 20, 20, 35, "#e9e4da", [O, J, M], F),
    ("ikea-candle-holder", "candle holder floor", ["candle holder", "candlestick"], "decor", 20, 20, 40, "#b89a5a", [M, O], F),
    ("ikea-berbyn-vase", "BERÄKNA vase", ["vase"], "decor", 25, 25, 34, "#e9e4da", [J, S, O], F),
    ("ikea-viljestark-vase", "VILJESTARK vase", ["vase"], "decor", 15, 15, 31, "#cfd8d4", [S, C], F),
    ("ikea-pomp-lantern", "BORRBY lantern for block candle", ["lantern"], "decor", 21, 21, 44, "#3d4042", [I, C], F),

    # Wall pieces
    ("ikea-hovet-mirror", "HOVET mirror", ["mirror"], "mirror", 78, 4, 196, "#c9cbc8", [I, S], W),
    ("ikea-lindbyn-mirror", "LINDBYN mirror", ["mirror"], "mirror", 60, 3, 80, "#3d4042", [M, I], W),
    ("ikea-nissedal-mirror", "NISSEDAL mirror", ["mirror"], "mirror", 65, 3, 150, "#f4f4f1", [S, C], W),
    ("ikea-stockholm-mirror", "STOCKHOLM mirror", ["mirror"], "mirror", 60, 3, 80, "#b89a5a", [M, O], W),
    ("ikea-ikornnes-mirror", "IKORNNES floor mirror", ["floor mirror", "mirror"], "mirror", 52, 4, 167, "#8b6844", [O, J], W),
    ("ikea-rodalm-frame", "RÖDALM frame", ["frame"], "wall-art", 50, 3, 70, "#3d4042", [S, M], W),
    ("ikea-picture-canvas", "picture canvas", ["picture"], "wall-art", 100, 3, 70, "#b7a58c", [S, O, J], W),
    ("ikea-pjatteryd-art", "PJÄTTERYD picture", ["picture"], "wall-art", 90, 3, 140, "#a6927a", [O, J, M], W),
    ("ikea-bild-poster", "BILD poster", ["poster"], "wall-art", 50, 1, 70, "#c9bfae", [S, M], W),
    ("ikea-knoppang-frame", "KNOPPÄNG frame with poster", ["frame"], "wall-art", 40, 2, 50, "#ece8df", [S, C], W),

    # Outdoor
    ("ikea-nammaro-table", "NÄMMARÖ table outdoor", ["table, outdoor"], "patio-table", 140, 75, 73, "#7a5a3c", [C, O], OUT),
    ("ikea-nammaro-chair", "NÄMMARÖ chair outdoor", ["chair", "easy chair"], "patio-chair", 63, 69, 82, "#7a5a3c", [C, O], OUT),
    ("ikea-nammaro-lounger", "NÄMMARÖ reclining chair outdoor", ["reclining", "chaise", "lounger"], "lounger", 66, 140, 90, "#7a5a3c", [C], OUT),
    ("ikea-hogon-parasol", "HÖGÖN parasol", ["parasol"], "umbrella", 270, 270, 240, "#e9e1cf", [C], OUT),
    ("ikea-brunsholmen-planter", "PERSILLADE plant pot outdoor", ["plant pot", "pot"], "planter", 40, 40, 38, "#cdbfa8", [O, C], OUT),
]


EXCLUDE = ["junior", "children", "daybed", "table lamp", "cover", "leg", "cushion", "pad", "mattress protector", "sofa-bed", "sleeper", "doll", "toy"]

IN = 2.54
FRACTIONS = {"½": 0.5, "¼": 0.25, "¾": 0.75, "⅛": 0.125, "⅜": 0.375, "⅝": 0.625, "⅞": 0.875}


def inches(t: str) -> float:
    """'35 3/8' or '7 ½' or '11' -> inches."""
    total = 0.0
    for part in t.replace('"', "").split():
        if part in FRACTIONS:
            total += FRACTIONS[part]
        elif "/" in part:
            a, b = part.split("/")
            total += float(a) / float(b)
        else:
            whole = part.rstrip("½¼¾⅛⅜⅝⅞")
            total += (float(whole) if whole else 0) + sum(v for k, v in FRACTIONS.items() if part.endswith(k) and whole)
    return total


def dims_from(text: str, cat: str, w: int, d: int, h: int):
    """Use IKEA's own size text where its meaning is clear; otherwise keep the curated size."""
    t = text.strip()
    try:
        if "'" in t:  # rugs: 5 ' 7 "x7 ' 10 "
            sides = []
            for side in t.split("x"):
                ft, _, rest = side.partition("'")
                sides.append(float(ft) * 12 + (inches(rest) if rest.strip(' "') else 0))
            if len(sides) == 2:
                return round(sides[0] * IN), round(sides[1] * IN), h
            return w, d, h
        if '"' not in t or any(c.isalpha() for c in t.replace("x", "")):  # 'x' separates sides
            return w, d, h
        sides = [x.split("/")[0] if x.count("/") >= 2 else x for x in t.split("x")]  # extendable: closed size
        nums = [inches(x) for x in sides]
        cm = [round(n * IN) for n in nums]
        if len(cm) == 3:
            return cm[0], cm[1], cm[2]
        if len(cm) == 2:
            if cat in ("bookshelf", "wardrobe", "dresser", "mirror", "wall-art"):
                return cm[0], d, cm[1]  # width x height
            return cm[0], cm[1], h  # width x depth
        if len(cm) == 1 and cat in ("round-table", "bench"):
            return (cm[0], cm[0], h) if cat == "round-table" else (cm[0], d, h)
    except ValueError:
        pass
    return w, d, h


def search(q: str):
    req = urllib.request.Request(SEARCH.format(q=urllib.parse.quote(q)), headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.load(r)["searchResultPage"]["products"]["main"]["items"]


def main():
    out, missing = [], []
    for (pid, q, types, cat, w, d, h, color, styles, placement) in SPEC:
        try:
            items = [it["product"] for it in search(q)]
        except Exception as e:  # network or shape change: keep going, report at the end
            missing.append(f"{pid}: {e}")
            continue
        # An upper-case first word names the IKEA line; a lower-case query takes the first product
        # of the right type (to pick up current lines). The type must match and not be excluded.
        first = q.split()[0]
        line = first.upper() if first.isupper() else None
        def ok(p):
            t = (p.get("typeName") or "").lower()
            return (line is None or p.get("name", "").upper() == line) and any(x in t for x in types) and not any(x in t for x in EXCLUDE)
        pick = next((p for p in items if ok(p)), None)
        if not pick:
            missing.append(f"{pid}: no matching {line or q} result")
            continue
        w, d, h = dims_from(pick.get("itemMeasureReferenceText") or "", cat, w, d, h)
        variant = pick.get("validDesignText") or ""
        size = pick.get("itemMeasureReferenceText") or ""
        name = ", ".join(x for x in [f"{pick['name']} {pick.get('typeName', '').lower()}".strip(), size, variant] if x)
        out.append(
            {
                "id": pid,
                "name": name,
                "price": float(pick["salesPrice"]["numeral"]),
                "category": cat,
                "dims": [w, d, max(h, 1)],
                "color": color,
                "styles": styles,
                "placement": placement,
                "url": pick.get("pipUrl"),
                "image": pick.get("contextualImageUrl") or pick.get("mainImageUrl"),
                "cutout": pick.get("mainImageUrl"),
                "itemNo": pick.get("itemNoGlobal"),
            }
        )
        time.sleep(0.15)
    dest = Path(__file__).resolve().parent.parent / "catalog" / "ikea-catalog.json"
    dest.write_text(json.dumps({"checkedAt": time.strftime("%Y-%m-%d"), "products": out}, ensure_ascii=False, indent=1) + "\n")
    print(f"wrote {len(out)} products to {dest}")
    if missing:
        print("skipped:", *missing, sep="\n  ", file=sys.stderr)


if __name__ == "__main__":
    main()
