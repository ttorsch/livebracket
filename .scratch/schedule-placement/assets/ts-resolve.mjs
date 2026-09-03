/* Throwaway loader hook: lets `node --experimental-strip-types` run app code
   that was written for the bundler rather than for node. Two jobs:

   - Relative imports omit the .ts extension (lib/data.ts and friends).
   - lib/supabase.ts is the *browser* client, built on cookies, and cannot
     load outside a browser at all. It is swapped for supabase-shim.ts, which
     reads the same tables through a plain server client.

   Register it with:
     node --experimental-strip-types \
       --import ./.scratch/schedule-placement/assets/ts-resolve-register.mjs \
       --env-file=.env.local <script>

   Only this repo's own files are touched — a node_modules parent resolves
   untouched, or CJS requires inside @supabase break. */
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';

const SHIM = new URL('./supabase-shim.ts', import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  const parent = context.parentURL;
  const ours = parent?.startsWith('file:') && !parent.includes('/node_modules/');
  if (ours && specifier.startsWith('.')) {
    if (/(^|\/)supabase$/.test(specifier)) return nextResolve(SHIM, context);
    if (!/\.[a-z]+$/i.test(specifier)) {
      const base = dirname(fileURLToPath(parent));
      for (const candidate of [`${specifier}.ts`, `${specifier}.tsx`, `${specifier}/index.ts`]) {
        const full = resolvePath(base, candidate);
        if (existsSync(full)) return nextResolve(pathToFileURL(full).href, context);
      }
    }
  }
  return nextResolve(specifier, context);
}
