import { NextResponse } from "next/server";
import { loadTemplateCatalog } from "@/lib/server/lua";

export async function GET() {
  try {
    const catalog = await loadTemplateCatalog();
    const refs = Object.keys(catalog)
      .filter((k) => k.startsWith("#."))
      .sort();
    return NextResponse.json({ refs, count: refs.length });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
