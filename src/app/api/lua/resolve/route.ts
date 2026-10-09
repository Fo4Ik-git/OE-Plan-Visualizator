import { promises as fs } from "fs";
import { NextResponse } from "next/server";
import { loadTemplateCatalog, luaRoot, safeUnder } from "@/lib/server/lua";
import { resolveRefs } from "@/lib/server/resolve";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const rel = searchParams.get("path");
    if (!rel) {
      return NextResponse.json({ error: "path required" }, { status: 400 });
    }
    const root = await luaRoot();
    const target = safeUnder(root, decodeURIComponent(rel));
    const plan = JSON.parse(await fs.readFile(target, "utf8"));
    const catalog = await loadTemplateCatalog(root);
    return NextResponse.json({
      path: rel,
      plan,
      resolved: resolveRefs(plan, catalog),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
