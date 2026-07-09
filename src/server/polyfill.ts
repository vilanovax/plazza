/**
 * Next.js reads `globalThis.AsyncLocalStorage` at module-eval time. When Next
 * is started from a custom server this global must be present *before* any Next
 * module loads, so we set it here and import this file first in server.ts.
 */
import { AsyncLocalStorage } from "node:async_hooks";

const g = globalThis as unknown as { AsyncLocalStorage?: typeof AsyncLocalStorage };
if (!g.AsyncLocalStorage) {
  g.AsyncLocalStorage = AsyncLocalStorage;
}

export {};
