import { getFeed } from '@/lib/wall/handlers';
import { wallDeps } from '@/lib/wall/deps';

// Event wall feed (add-event-wall): one page of posts with signed photo URLs (≤ 1 h), never cached.
export async function GET(req: Request) {
  return getFeed(req, wallDeps());
}
