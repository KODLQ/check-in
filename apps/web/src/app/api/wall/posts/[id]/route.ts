import { deletePost } from '@/lib/wall/handlers';
import { wallDeps } from '@/lib/wall/deps';

// Own post, or any post (optionally all by its author) as host/co-host. Photo files are removed before
// responding so they stop loading at once.
export async function DELETE(req: Request, ctx: RouteContext<'/api/wall/posts/[id]'>) {
  const { id } = await ctx.params;
  return deletePost(req, wallDeps(), id);
}
