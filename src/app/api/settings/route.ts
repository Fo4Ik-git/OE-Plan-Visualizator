import { NextResponse } from "next/server";
import { loadSettings, saveSettings } from "@/lib/server/settings";

export async function GET() {
  try {
    return NextResponse.json(await loadSettings());
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const settings = await saveSettings(body);
    return NextResponse.json(settings);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
