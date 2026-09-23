export { Hai, type HaiConfig } from "./runtime.js";
export { memoryStore } from "./store.js";
export { nodeHandler } from "./routes.js";

import { Hai, type HaiConfig } from "./runtime.js";
export const createHai = (config: HaiConfig) => new Hai(config);
