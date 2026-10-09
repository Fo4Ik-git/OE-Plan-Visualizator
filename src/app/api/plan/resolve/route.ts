import { NextResponse } from "next/server";
import { loadTemplateCatalog } from "@/lib/server/lua";
import { resolveRefs } from "@/lib/server/resolve";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      plan?: unknown;
      templates?: Record<string, unknown>;
    };
    if (body.plan == null) {
      return NextResponse.json({ error: "plan required" }, { status: 400 });
    }
    const catalog = await loadTemplateCatalog();
    for (const [name, content] of Object.entries(body.templates || {})) {
      catalog[name] = content;
      catalog[name.startsWith("#.") ? name : `#.${name}`] = content;
    }
    return NextResponse.json({ resolved: resolveRefs(body.plan, catalog) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
