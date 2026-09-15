/** Ampliación de tipos para el binding de assets de Wrangler. */
interface AssetsFetcher {
  fetch: (request: Request) => Promise<Response>;
}
