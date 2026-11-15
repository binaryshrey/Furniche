import { NextResponse } from 'next/server';
import { z } from 'zod';
import { CATEGORY_LABEL } from '@/catalog/products';
import { type ImageInput, llmAvailable, structured } from '@/lib/llm';
import type { Category } from '@/lib/types';

// Names the piece in a photo and estimates its size, while the 3D model is being built. The size
// is an estimate from what kind of piece it is; the shopper confirms or corrects it.
const CATEGORIES = Object.keys(CATEGORY_LABEL) as [Category, ...Category[]];

const Guess = z.object({
  name: z.string().describe('Short shop-style name, e.g. "Walnut lounge chair"'),
  category: z.enum(CATEGORIES),
  color: z.string().describe('Main colour as a hex code like #c9b79c'),
  widthCm: z.number().describe('Estimated width seen from the front, in cm'),
  depthCm: z.number().describe('Estimated depth, front to back, in cm'),
  heightCm: z.number().describe('Estimated height, floor to top, in cm'),
  confidence: z.enum(['high', 'medium', 'low']),
});

export async function POST(req: Request) {
  if (!llmAvailable()) return NextResponse.json({ guess: null });
  const image = (await req.formData().catch(() => null))?.get('image');
  if (!(image instanceof Blob) || !/^image\/(jpeg|png|webp)$/.test(image.type) || image.size > 15_000_000) {
    return NextResponse.json({ error: 'Send one JPEG, PNG or WebP photo.' }, { status: 400 });
  }
  const photo: ImageInput = { mediaType: image.type as ImageInput['mediaType'], data: Buffer.from(await image.arrayBuffer()).toString('base64') };
  const ai = await structured({
    system:
      'You identify one piece of furniture or decor in a photo for a room planner. If several pieces are shown, ' +
      'describe the most prominent one. Estimate its real size from the kind of piece, its proportions and any ' +
      'objects in the photo that show scale; say how sure you are. Width is the side seen from the front.',
    user: 'What is this piece, and roughly how big is it?',
    images: [photo],
    schema: Guess,
    effort: 'low',
    maxTokens: 4000,
  });
  if (!ai) return NextResponse.json({ guess: null });
  const cm = (v: number) => (Number.isFinite(v) ? Math.min(600, Math.max(1, Math.round(v))) : null);
  return NextResponse.json({
    guess: {
      name: ai.name.trim().slice(0, 80) || CATEGORY_LABEL[ai.category],
      category: ai.category,
      color: /^#[0-9a-f]{6}$/i.test(ai.color) ? ai.color : '#9a8f80',
      dimsCm: { w: cm(ai.widthCm), d: cm(ai.depthCm), h: cm(ai.heightCm) },
      confidence: ai.confidence,
    },
  });
}
