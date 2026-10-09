import { promises as fs } from "fs";
import { NextResponse } from "next/server";
import { luaRoot, safeUnder } from "@/lib/server/lua";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const rel = searchParams.get("path");
    if (!rel) {
      return NextResponse.json({ error: "path required" }, { status: 400 });
    }
    const root = await luaRoot();
    const decoded = decodeURIComponent(rel);
    const target = safeUnder(root, decoded);
    try {
      await fs.access(target);
    } catch {
      return NextResponse.json({ error: "not found", path: rel }, { status: 404 });
    }
    const st = await fs.stat(target);
    const meta = {
      path: decoded,
      mtimeMs: st.mtimeMs,
      size: st.size,
    };
    if (searchParams.get("stat") === "1") {
      return NextResponse.json(meta);
    }
    const text = await fs.readFile(target, "utf8");
    try {
      return NextResponse.json({ ...meta, json: JSON.parse(text) });
    } catch {
      return NextResponse.json({ ...meta, raw: text, json: null });
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
