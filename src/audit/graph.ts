/** Follow a directed graph iteratively, including cycles and very long chains. */
export function reachableFrom(
  entries: readonly string[],
  graph: ReadonlyMap<string, readonly string[]>,
): Set<string> {
  const reached = new Set(entries);
  const queue = [...reached];
  for (let index = 0; index < queue.length; index++)
    for (const target of graph.get(queue[index]!) ?? [])
      if (!reached.has(target)) {
        reached.add(target);
        queue.push(target);
      }
  return reached;
}
