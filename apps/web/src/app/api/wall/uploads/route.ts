import { reserveUpload } from '@/lib/wall/handlers';
import { wallDeps } from '@/lib/wall/deps';

// Reserves one photo upload and returns a single-use signed upload URL into the private quarantine bucket.
export async function POST(req: Request) {
  return reserveUpload(req, wallDeps());
}
