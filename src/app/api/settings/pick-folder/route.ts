import { execFile } from "child_process";
import { promisify } from "util";
import { NextResponse } from "next/server";

const execFileAsync = promisify(execFile);

/**
 * Opens a native folder picker (Finder on macOS) and returns the absolute path.
 * Browser cannot expose real FS paths; this runs on the local Next.js server.
 */
export async function POST(request: Request) {
  try {
    let prompt = "Select lua repository root";
    try {
      const body = (await request.json()) as { prompt?: string };
      if (body.prompt?.trim()) prompt = body.prompt.trim();
    } catch {
      /* empty body ok */
    }

    const platform = process.platform;
    let folderPath = "";

    if (platform === "darwin") {
      const script = `POSIX path of (choose folder with prompt ${JSON.stringify(prompt)})`;
      const { stdout } = await execFileAsync("osascript", ["-e", script], {
        timeout: 300_000,
      });
      folderPath = stdout.trim().replace(/\/$/, "");
    } else if (platform === "linux") {
      try {
        const { stdout } = await execFileAsync(
          "zenity",
          ["--file-selection", "--directory", `--title=${prompt}`],
          { timeout: 300_000 },
        );
        folderPath = stdout.trim().replace(/\/$/, "");
      } catch {
        const { stdout } = await execFileAsync(
          "kdialog",
          ["--getexistingdirectory", ".", "--title", prompt],
          { timeout: 300_000 },
        );
        folderPath = stdout.trim().replace(/\/$/, "");
      }
    } else {
      return NextResponse.json(
        {
          error:
            "Native folder picker is only supported on macOS and Linux. Paste the path manually.",
        },
        { status: 501 },
      );
    }

    if (!folderPath) {
      return NextResponse.json({ cancelled: true });
    }

    return NextResponse.json({ path: folderPath, cancelled: false });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // User hit Cancel in Finder — osascript exits non-zero.
    if (
      /User canceled|cancelled|canceled|-128/i.test(message) ||
      (err as { code?: number | string })?.code === 1
    ) {
      return NextResponse.json({ cancelled: true });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
