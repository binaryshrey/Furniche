"use client";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { toThree } from "@/lib/coords";
import { useLivePrices } from "@/lib/livePrices";
import { bridge, useGhost, useViewerState } from "@/lib/sceneBridge";
import { useDesign, useStore } from "@/lib/store";
import type { PlacedItem, Product } from "@/lib/types";

// A price tag over every IKEA piece on the floor you're on, with today's price from ikea.com.
// Click it to open the product on IKEA's site. Tags follow the pieces as the camera moves and
// hide behind walls and off screen.

const fmt = (n: number, cur: string) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: cur || "USD",
    maximumFractionDigits: n % 1 ? 2 : 0,
  });
const ray = new THREE.Raycaster();
ray.layers.enableAll();

export default function PriceTags() {
  const design = useDesign();
  const product = useStore((s) => s.product);
  // Pieces on the floor you're on (open-plan rooms share one view; walls hide the rest below).
  const floorZ = useViewerState((s) => s.cameraFloorZ);
  const showing = useViewerState((s) => s.showingRoom);
  const ghost = useGhost((s) => s.ghost);
  const { prices, want, show: on } = useLivePrices();
  const refs = useRef(new Map<string, HTMLAnchorElement>());
  const box = useRef<HTMLDivElement>(null);

  // IKEA pieces in this room. A mattress lying on its bed shares the bed's spot, so it is left out.
  const items = useMemo(() => {
    const all = design.items
      .map((item) => ({ item, p: product(item.productId) }))
      .filter((x): x is { item: PlacedItem; p: Product } => !!x.p);
    const mine = all.filter(
      ({ item, p }) =>
        item.pos.z > floorZ - 0.5 &&
        item.pos.z < floorZ + 2.4 &&
        p.retailer === "ikea" &&
        !(
          p.category === "mattress" &&
          all.some(
            (o) =>
              o.p.category === "bed" &&
              Math.hypot(o.item.pos.x - item.pos.x, o.item.pos.y - item.pos.y) <
                0.3,
          )
        ),
    );
    // The same product close together (chairs round a table) gets one tag: "2 × $65".
    const groups: { item: PlacedItem; p: Product; count: number }[] = [];
    for (const x of mine) {
      const g = groups.find(
        (y) =>
          y.p.id === x.p.id &&
          Math.hypot(y.item.pos.x - x.item.pos.x, y.item.pos.y - x.item.pos.y) <
            2,
      );
      if (!g) groups.push({ ...x, count: 1 });
      else {
        const n = g.count + 1;
        g.item = {
          ...g.item,
          pos: {
            ...g.item.pos,
            x: (g.item.pos.x * g.count + x.item.pos.x) / n,
            y: (g.item.pos.y * g.count + x.item.pos.y) / n,
          },
        };
        g.count = n;
      }
    }
    return groups;
  }, [design.items, product, floorZ]);

  useEffect(() => {
    if (on && items.length) want([...new Set(items.map((x) => x.p.id))]);
  }, [on, items, want]);

  // Pin each tag just above its piece every frame; check walls in the way a few times a second.
  useEffect(() => {
    if (!on || !showing) return;
    const v = new THREE.Vector3();
    const hidden = new Map<string, boolean>();
    let raf = 0;
    let lastOcc = 0;
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      const cam = bridge.camera;
      const r = box.current?.getBoundingClientRect();
      if (!cam || !r) return;
      const checkWalls = t - lastOcc > 200;
      if (checkWalls) lastOcc = t;
      const placed: { el: HTMLAnchorElement; x: number; y: number }[] = [];
      for (const { item, p } of items) {
        const el = refs.current.get(item.uid);
        if (!el) continue;
        const top = {
          x: item.pos.x,
          y: item.pos.y,
          z:
            item.pos.z +
            p.dimsCm.h / 100 +
            (p.placement === "wall" ? 0.06 : 0.12),
        };
        const at = new THREE.Vector3(...toThree(top));
        v.copy(at).project(cam);
        let show = v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05;
        if (show && checkWalls && bridge.scan.length) {
          const from = cam.getWorldPosition(new THREE.Vector3());
          const dir = at.clone().sub(from);
          const dist = dir.length();
          ray.set(from, dir.normalize());
          ray.far = dist - 0.2;
          hidden.set(
            item.uid,
            ray.intersectObjects(bridge.scan, false).length > 0,
          );
        }
        if (hidden.get(item.uid)) show = false;
        el.style.display = show ? "" : "none";
        if (show)
          placed.push({
            el,
            x: ((v.x + 1) / 2) * r.width,
            y: ((1 - v.y) / 2) * r.height,
          });
      }
      // Keep tags from covering each other: nearer the top first, push later ones down.
      placed.sort((a, b) => a.y - b.y);
      const done: { x: number; y: number; w: number }[] = [];
      for (const tg of placed) {
        const w = tg.el.offsetWidth || 90;
        let y = tg.y;
        for (let k = 0; k < 6; k++) {
          const hit = done.find(
            (d) =>
              Math.abs(d.x - tg.x) < (d.w + w) / 2 + 4 &&
              Math.abs(d.y - y) < 24,
          );
          if (!hit) break;
          y = hit.y + 25;
        }
        done.push({ x: tg.x, y, w });
        tg.el.style.transform = `translate(-50%, -100%) translate(${tg.x}px, ${y}px)`;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [on, showing, items]);

  if (!showing || !items.length) return null;
  return (
    <div
      ref={box}
      className="pointer-events-none absolute inset-0 z-[7] overflow-hidden"
      aria-label="Price tags"
    >
      {on &&
        !ghost &&
        items.map(({ item, p, count }) => {
          const live = prices[p.id];
          const price =
            (count > 1 ? `${count} × ` : "") +
            (live ? fmt(live.price, live.currency) : fmt(p.priceUsd, "USD"));
          const changed = live && Math.abs(live.price - p.priceUsd) >= 0.5;
          return (
            <a
              key={item.uid}
              ref={(el) => {
                if (el) refs.current.set(item.uid, el);
                else refs.current.delete(item.uid);
              }}
              data-fn-ui
              href={live?.url ?? p.url}
              target="_blank"
              rel="noopener noreferrer"
              title={`${p.name.split(",")[0]} on ikea.com${live ? ` · price checked ${new Date(live.checkedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}${live.inStock === false ? " · out of stock online" : ""}` : " · checking today’s price…"}`}
              onPointerDown={(e) => e.stopPropagation()}
              className="pointer-events-auto absolute left-0 top-0 opacity-50 transition-opacity hover:opacity-100 focus-visible:opacity-100 flex items-center gap-1 whitespace-nowrap rounded-full border border-black/10 bg-[#ffdb00] py-0.5 pl-1 pr-2 text-[11px] font-bold leading-5 text-[#0058a3] shadow-md"
              style={{ display: "none", willChange: "transform" }}
            >
              <span className="rounded-full bg-[#0058a3] px-1.5 text-[9px] font-extrabold tracking-wide text-[#ffdb00]">
                IKEA
              </span>
              {price}
              {changed && (
                <span className="text-[9px] font-semibold text-[#0058a3]/70 line-through">
                  {fmt(p.priceUsd, "USD")}
                </span>
              )}
              {live?.inStock === false && (
                <span className="text-[9px] font-semibold text-red-700">
                  sold out
                </span>
              )}
              <svg
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                aria-hidden
              >
                <path d="M7 17 17 7M9 7h8v8" />
              </svg>
            </a>
          );
        })}
    </div>
  );
}

// Toolbar switch for the tags.
export function PriceTagToggle() {
  const { show, setShow } = useLivePrices();
  return (
    <button
      onClick={() => setShow(!show)}
      className={`rounded-md border border-line px-2.5 py-1.5 ${show ? "bg-ink text-paper" : "bg-card"}`}
      aria-pressed={show}
      title="Today’s IKEA price over each piece; click a tag to open it on ikea.com"
    >
      Price tags
    </button>
  );
}
