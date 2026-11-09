import { completeUpload } from '@/lib/wall/handlers';
import { wallDeps } from '@/lib/wall/deps';

// Decodes and re-encodes the uploaded photo without metadata (sharp + libheif WASM for HEIC). Node runtime;
// region and memory are set in vercel.json (preferredRegion is deprecated in Next.js 16).
export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(req: Request, ctx: RouteContext<'/api/wall/uploads/[id]/complete'>) {
  const { id } = await ctx.params;
  return completeUpload(req, wallDeps(), id);
}
