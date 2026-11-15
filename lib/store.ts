'use client';
import { useMemo } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { PRODUCTS } from '@/catalog/products';
import type { Design, DoorMark, PlacedItem, Product, SurfaceChoice, ThemeId, Vec3 } from './types';

const uid = () => Math.random().toString(36).slice(2, 10);

function emptyDesign(sid: string): Design {
  return { sid, items: [], doors: [], surfaces: [], themeId: null, updatedAt: new Date().toISOString() };
}

type Mode = 'navigate' | 'arrange' | 'door';

type State = {
  designs: Record<string, Design>;
  importedProducts: Product[];
  activeSid: string | null;
  selectedUid: string | null;
  pendingProductId: string | null; // product being dropped into the scene
  mode: Mode;
  showFurnished: boolean;

  setActive: (sid: string) => void;
  design: () => Design;
  products: () => Product[];
  product: (id: string) => Product | undefined;

  addItem: (productId: string, pos: Vec3, roomId: string | null, rot?: number) => string;
  moveItem: (uid: string, pos: Vec3, roomId: string | null) => void;
  rotateItem: (uid: string, delta: number) => void;
  removeItem: (uid: string) => void;
  duplicateItem: (uid: string) => void;
  swapItem: (uid: string, next: PlacedItem) => void;
  setLocked: (locked: boolean) => void; // replace a piece with another product in place
  replaceItems: (items: Omit<PlacedItem, 'uid'>[], roomId: string | null) => void;
  clearRoom: (roomId: string) => void;

  addDoor: (door: Omit<DoorMark, 'uid'>) => void;
  removeDoor: (uid: string) => void;
  setSurface: (s: Omit<SurfaceChoice, 'uid'>) => void;
  removeSurface: (uid: string) => void;
  setTheme: (t: ThemeId | null) => void;
  addImportedProduct: (p: Product) => void; // adds, or replaces the product with the same id
  removeImportedProduct: (id: string) => void; // and every placed copy of it

  select: (uid: string | null) => void;
  setPending: (productId: string | null) => void;
  setMode: (m: Mode) => void;
  setShowFurnished: (v: boolean) => void;
  loadDesign: (d: Design) => void;
};

// Mattresses lying on this bed frame (same spot), which move, turn and go with it.
function ridersOf(it: PlacedItem, items: PlacedItem[], product: (id: string) => { category: string } | undefined): string[] {
  if (product(it.productId)?.category !== 'bed') return [];
  return items.filter((m) => m.uid !== it.uid && product(m.productId)?.category === 'mattress' && Math.hypot(m.pos.x - it.pos.x, m.pos.y - it.pos.y) < 0.3).map((m) => m.uid);
}

export const useStore = create<State>()(
  persist(
    (set, get) => {
      const update = (fn: (d: Design) => Design) => {
        const sid = get().activeSid;
        if (!sid) return;
        const cur = get().designs[sid] ?? emptyDesign(sid);
        set({ designs: { ...get().designs, [sid]: { ...fn(cur), updatedAt: new Date().toISOString() } } });
      };
      return {
        designs: {},
        importedProducts: [],
        activeSid: null,
        selectedUid: null,
        pendingProductId: null,
        mode: 'navigate',
        showFurnished: false,

        setActive: (sid) => {
          if (!get().designs[sid]) set({ designs: { ...get().designs, [sid]: emptyDesign(sid) } });
          set({ activeSid: sid, selectedUid: null, pendingProductId: null, mode: 'navigate' });
        },
        design: () => {
          const sid = get().activeSid;
          return (sid && get().designs[sid]) || emptyDesign(sid ?? '');
        },
        products: () => [...PRODUCTS, ...get().importedProducts],
        product: (id) => PRODUCTS.find((p) => p.id === id) ?? get().importedProducts.find((p) => p.id === id),

        addItem: (productId, pos, roomId, rot = 0) => {
          const id = uid();
          update((d) => ({ ...d, items: [...d.items, { uid: id, productId, pos, roomId, rot }] }));
          set({ selectedUid: id });
          return id;
        },
        // A mattress lying on a bed frame travels with it.
        moveItem: (id, pos, roomId) =>
          update((d) => {
            const it = d.items.find((i) => i.uid === id);
            const riders = it ? ridersOf(it, d.items, get().product) : [];
            const dx = it ? pos.x - it.pos.x : 0;
            const dy = it ? pos.y - it.pos.y : 0;
            return {
              ...d,
              items: d.items.map((i) => (i.uid === id ? { ...i, pos, roomId } : riders.includes(i.uid) ? { ...i, pos: { ...i.pos, x: i.pos.x + dx, y: i.pos.y + dy }, roomId } : i)),
            };
          }),
        rotateItem: (id, delta) =>
          update((d) => {
            const it = d.items.find((i) => i.uid === id);
            const riders = it ? ridersOf(it, d.items, get().product) : [];
            return { ...d, items: d.items.map((i) => (i.uid === id || riders.includes(i.uid) ? { ...i, rot: i.rot + delta } : i)) };
          }),
        removeItem: (id) => {
          update((d) => {
            const it = d.items.find((i) => i.uid === id);
            const riders = it ? ridersOf(it, d.items, get().product) : [];
            return { ...d, items: d.items.filter((i) => i.uid !== id && !riders.includes(i.uid)) };
          });
          if (get().selectedUid === id) set({ selectedUid: null });
        },
        duplicateItem: (id) => {
          const it = get().design().items.find((i) => i.uid === id);
          if (!it) return;
          const nid = uid();
          update((d) => ({ ...d, items: [...d.items, { ...it, uid: nid, pos: { ...it.pos, x: it.pos.x + 0.3, y: it.pos.y - 0.3 } }] }));
          set({ selectedUid: nid });
        },
        setLocked: (locked) => update((d) => ({ ...d, locked })),
        swapItem: (id, next) => update((d) => ({ ...d, items: d.items.map((i) => (i.uid === id ? { ...next, uid: id } : i)) })),
        replaceItems: (items, roomId) =>
          update((d) => ({
            ...d,
            items: [...d.items.filter((i) => i.roomId !== roomId), ...items.map((i) => ({ ...i, uid: uid() }))],
          })),
        clearRoom: (roomId) => update((d) => ({ ...d, items: d.items.filter((i) => i.roomId !== roomId) })),

        addDoor: (door) => update((d) => ({ ...d, doors: [...d.doors, { ...door, uid: uid() }] })),
        removeDoor: (id) => update((d) => ({ ...d, doors: d.doors.filter((x) => x.uid !== id) })),
        setSurface: (s) =>
          update((d) => {
            const key = JSON.stringify([s.roomId, s.target]);
            // Flooring is one choice for the whole home: a new floor replaces every room's.
            const rest = d.surfaces.filter((x) => JSON.stringify([x.roomId, x.target]) !== key && !(s.target === 'floor' && x.target === 'floor'));
            return { ...d, surfaces: [...rest, { ...s, uid: uid() }] };
          }),
        removeSurface: (id) => update((d) => ({ ...d, surfaces: d.surfaces.filter((x) => x.uid !== id) })),
        setTheme: (t) => update((d) => ({ ...d, themeId: t })),
        addImportedProduct: (p) => {
          const list = get().importedProducts;
          set({ importedProducts: list.some((x) => x.id === p.id) ? list.map((x) => (x.id === p.id ? p : x)) : [...list, p] });
        },
        removeImportedProduct: (id) => {
          const { designs, selectedUid, pendingProductId } = get();
          const gone = Object.values(designs).some((d) => d.items.some((i) => i.uid === selectedUid && i.productId === id));
          set({
            importedProducts: get().importedProducts.filter((p) => p.id !== id),
            designs: Object.fromEntries(
              Object.entries(designs).map(([sid, d]) => [
                sid,
                d.items.some((i) => i.productId === id) ? { ...d, items: d.items.filter((i) => i.productId !== id), updatedAt: new Date().toISOString() } : d,
              ]),
            ),
            selectedUid: gone ? null : selectedUid,
            pendingProductId: pendingProductId === id ? null : pendingProductId,
          });
        },

        select: (id) => set({ selectedUid: id }),
        // Picking a product no longer switches modes: furniture can be grabbed in any mode, and
        // staying in Walk keeps Matterport's own controls working after the drop.
        setPending: (productId) => set({ pendingProductId: productId }),
        setMode: (m) => set({ mode: m, pendingProductId: m === 'arrange' ? get().pendingProductId : null }),
        setShowFurnished: (v) => set({ showFurnished: v }),
        loadDesign: (d) => set({ designs: { ...get().designs, [d.sid]: d } }),
      };
    },
    {
      name: 'furniche',
      partialize: (s) => ({ designs: s.designs, importedProducts: s.importedProducts }),
    },
  ),
);

const EMPTY: Design = { sid: '', items: [], doors: [], surfaces: [], themeId: null, updatedAt: '' };

// Selectors must return stable references, or React re-renders forever.
export function useDesign(): Design {
  return useStore((s) => (s.activeSid && s.designs[s.activeSid]) || EMPTY);
}

export function useProducts(): Product[] {
  const imported = useStore((s) => s.importedProducts);
  return useMemo(() => [...PRODUCTS, ...imported], [imported]);
}
