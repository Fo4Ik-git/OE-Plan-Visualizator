import { NextResponse } from "next/server";
import { refreshSchemaCache } from "@/lib/server/schema";

export async function POST() {
  try {
    return NextResponse.json(await refreshSchemaCache());
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
