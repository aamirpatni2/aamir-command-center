/**
 * Import FIRST in the browser entry (before anything that defines or parses schemas).
 * Zod 4 probes for `Function("")` to speed up parsing; under the dashboard's
 * Content-Security-Policy (no eval) that probe is a CSP violation on every page.
 * Side-effect module that imports only zod, so it runs before any other schema module.
 */
import { z } from "zod";

z.config({ jitless: true });
