import path from "path";

export const PROJECT_ROOT = path.resolve(/* turbopackIgnore: true */ process.cwd());
export const SETTINGS_PATH = path.join(PROJECT_ROOT, "settings.json");
export const SETTINGS_EXAMPLE_PATH = path.join(PROJECT_ROOT, "settings.example.json");
export const DATA_ROOT = path.join(PROJECT_ROOT, "data");
export const SCHEMA_CACHE_PATH = path.join(DATA_ROOT, "schema-cache.json");
