import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// package.json sits two levels up from both src/utils/ and dist/utils/
export const VERSION: string = require("../../package.json").version;
