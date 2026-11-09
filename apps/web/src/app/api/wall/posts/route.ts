import { createPost } from '@/lib/wall/handlers';
import { wallDeps } from '@/lib/wall/deps';

export async function POST(req: Request) {
  return createPost(req, wallDeps());
}
