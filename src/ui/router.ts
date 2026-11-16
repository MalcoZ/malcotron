/** Hash routes: `#/`, `#/lesson/<id>/<step>`, `#/lesson/<id>/done`, `#/piece/<id>`. */
export type Route =
  | { name: 'home' }
  | { name: 'lesson'; id: string; step: number }
  | { name: 'lesson-done'; id: string }
  | { name: 'piece'; id: string };

/** Parse a location hash. Steps are counted from 1 in the URL and from 0 in the route. */
export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  if (parts[0] === 'lesson' && parts[1]) {
    if (parts[2] === 'done') return { name: 'lesson-done', id: parts[1] };
    const step = Number(parts[2] ?? '1');
    return {
      name: 'lesson',
      id: parts[1],
      step: Number.isInteger(step) && step >= 1 ? step - 1 : 0,
    };
  }
  if (parts[0] === 'piece' && parts[1]) return { name: 'piece', id: parts[1] };
  return { name: 'home' };
}

export function routePath(route: Route): string {
  switch (route.name) {
    case 'home':
      return '/';
    case 'lesson':
      return `/lesson/${encodeURIComponent(route.id)}/${route.step + 1}`;
    case 'lesson-done':
      return `/lesson/${encodeURIComponent(route.id)}/done`;
    case 'piece':
      return `/piece/${encodeURIComponent(route.id)}`;
  }
}
