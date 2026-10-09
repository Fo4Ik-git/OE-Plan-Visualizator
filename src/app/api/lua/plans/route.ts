import { NextResponse } from "next/server";
import { listPlanFiles, listPlanServices, luaRoot } from "@/lib/server/lua";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q") || "";
    const service = searchParams.get("service") || "";
    const root = await luaRoot();
    return NextResponse.json({
      plans: await listPlanFiles(q, service),
      services: await listPlanServices(root),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
