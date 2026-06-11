/**
 * Minimal sample used only to warm the bootstrap pipeline at image build time:
 * it gives ingest something to chunk, embed something to vectorize (which
 * downloads the default embedding model into the cache), and the graph loader
 * a couple of relations to persist.
 */
export function greet(name) {
  return `Hello, ${name}!`;
}

export function greetCrew(names) {
  return names.map((name) => greet(name));
}
