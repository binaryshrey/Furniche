import { create } from 'zustand';

// Whether the Ask Furniche panel is open, so overlays on the tour (the swap card) can keep clear of it.
export const usePanel = create<{ open: boolean; setOpen: (open: boolean) => void }>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));
