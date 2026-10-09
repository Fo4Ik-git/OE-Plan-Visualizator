import { NextResponse } from "next/server";
import { listPlanOwners } from "@/lib/server/lua";

export async function GET() {
  try {
    return NextResponse.json({ owners: await listPlanOwners() });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
