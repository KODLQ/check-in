import { blockAuthor, unblock } from '@/lib/wall/handlers';
import { wallDeps } from '@/lib/wall/deps';

// Host/co-host: stop a poster from posting (by one of their post ids) or allow them again.
export async function POST(req: Request) {
  return blockAuthor(req, wallDeps());
}

export async function DELETE(req: Request) {
  return unblock(req, wallDeps());
}
