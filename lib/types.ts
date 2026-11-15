// All positions are in the Matterport Model API frame: metres, Z up.
// Convert to three.js only in lib/coords.ts.

export type Vec2 = { x: number; y: number };
export type Vec3 = { x: number; y: number; z: number };

export type Wall = { id: string; a: Vec2; b: Vec2; thickness: number };

export type Room = {
  id: string;
  label: string;
  floorId: string;
  polygon: Vec2[];
  areaM2: number;
  widthM: number;
  depthM: number;
  heightM: number | null;
  floorZ: number;
};

export type Pano = { id: string; label: string; floorId: string | null; pos: Vec3 };

export type Floor = { id: string; label: string; z: number };

export type ModelGeometry = {
  sid: string;
  name: string;
  address: string | null;
  lat: number | null;
  lon: number | null;
  defurnishedViewId: string | null;
  floors: Floor[];
  walls: Record<string, Wall[]>; // by floor id
  rooms: Room[];
  panos: Pano[];
};

export type Category =
  | 'sofa'
  | 'sectional'
  | 'armchair'
  | 'coffee-table'
  | 'side-table'
  | 'tv-console'
  | 'bookshelf'
  | 'dining-table'
  | 'round-table'
  | 'dining-chair'
  | 'bed'
  | 'nightstand'
  | 'dresser'
  | 'wardrobe'
  | 'desk'
  | 'office-chair'
  | 'floor-lamp'
  | 'rug'
  | 'plant'
  | 'mirror'
  | 'wall-art'
  | 'bench'
  | 'bar-stool'
  | 'mattress' // sits on a bed frame
  | 'decor' // floor-standing showpieces: vases, baskets, pouffes, plant stands, lanterns
  | 'patio-table'
  | 'patio-chair'
  | 'lounger'
  | 'umbrella'
  | 'planter';

export type Retailer = 'ikea' | 'amazon' | 'wayfair' | 'west-elm' | 'target' | 'other';

export type ThemeId = 'midcentury' | 'japandi' | 'scandinavian' | 'industrial' | 'coastal' | 'modern-organic';

export type Placement = 'floor' | 'wall' | 'outdoor';

export type Product = {
  id: string;
  source: 'curated' | 'imported';
  retailer: Retailer;
  name: string;
  url: string;
  imageUrl?: string;
  priceUsd: number;
  priceCheckedAt: string;
  category: Category;
  dimsCm: { w: number; d: number; h: number };
  color: string;
  styles: ThemeId[];
  placement: Placement;
  standIn: boolean;
};

export type PlacedItem = {
  uid: string;
  productId: string;
  roomId: string | null;
  pos: Vec3;
  rot: number; // radians about the vertical axis
};

export type DoorMark = { uid: string; roomId: string; pos: Vec2; widthM: number };

export type SurfaceChoice = {
  uid: string;
  roomId: string;
  target: 'floor' | 'walls' | { wallId: string };
  materialId: string;
};

export type Design = {
  sid: string;
  items: PlacedItem[];
  doors: DoorMark[];
  surfaces: SurfaceChoice[];
  themeId: ThemeId | null;
  // Furniture can't be moved, rotated or nudged while locked, so the room can be walked
  // freely; on after Auto-furnish, toggled in the design panel.
  locked?: boolean;
  updatedAt: string;
};

export type FitLevel = 'ok' | 'warn' | 'error';
export type FitIssue = { uid: string; level: FitLevel; message: string };

export type Listing =
  | {
      kind: 'home';
      sid: string;
      listingId: number;
      address: string;
      city: string;
      price: number | null;
      beds: number | null;
      baths: number | null;
      sqft: number | null;
      yearBuilt: number | null;
      status: number | null;
      lat: number;
      lon: number;
      rooms: number;
      splat: boolean;
    }
  | {
      kind: 'apartment';
      sid: string;
      propertyId: number;
      unitName: string;
      community: string | null;
      address: string;
      city: string;
      rentMin: number | null;
      rentMax: number | null;
      lat: number | null;
      lon: number | null;
      rooms: number;
    };
