import { deleteMine } from '@/lib/wall/handlers';
import { wallDeps } from '@/lib/wall/deps';

// "Delete all my posts" (also used by the app after withdrawing an RSVP).
export async function DELETE(req: Request) {
  return deleteMine(req, wallDeps());
}
