import { setEnabled } from '@/lib/wall/handlers';
import { wallDeps } from '@/lib/wall/deps';

// Host/co-host: turn the wall on or off (allowed after the event ended or was cancelled).
export async function PATCH(req: Request) {
  return setEnabled(req, wallDeps());
}
