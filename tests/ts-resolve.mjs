// Resolves extensionless relative TypeScript imports so Node 24's built-in test runner
// executes pure Angular TypeScript modules directly without extra compilation steps.
import fs from 'node:fs';
import { registerHooks } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      (specifier.startsWith('./') || specifier.startsWith('../')) &&
      !/\.(?:[cm]?[jt]s|json|css)$/i.test(specifier) &&
      context.parentURL?.startsWith('file:')
    ) {
      const parentDir = path.dirname(fileURLToPath(context.parentURL));
      const tsPath = path.resolve(parentDir, `${specifier}.ts`);
      if (fs.existsSync(tsPath)) {
        return nextResolve(pathToFileURL(tsPath).href, context);
      }
      const indexTs = path.resolve(parentDir, specifier, 'index.ts');
      if (fs.existsSync(indexTs)) {
        return nextResolve(pathToFileURL(indexTs).href, context);
      }
    }
    return nextResolve(specifier, context);
  },
});
