import { NextResponse } from "next/server";
import { loadSchemaCache, refreshSchemaCache } from "@/lib/server/schema";

export async function GET() {
  let cache = await loadSchemaCache();
  const empty =
    !cache ||
    !Array.isArray(cache.wrappers) ||
    cache.wrappers.length === 0 ||
    !Array.isArray(cache.state_types) ||
    cache.state_types.length === 0;

  if (empty) {
    try {
      cache = await refreshSchemaCache();
    } catch (err) {
      if (!cache) {
        return NextResponse.json(
          {
            error:
              err instanceof Error
                ? err.message
                : "schema cache missing and refresh failed",
          },
          { status: 404 },
        );
      }
    }
  }

  return NextResponse.json(cache);
}
