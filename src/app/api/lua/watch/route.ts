import { watch, promises as fs } from "fs";
import { luaRoot, safeUnder } from "@/lib/server/lua";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type WatchPayload = {
  path: string;
  mtimeMs: number;
  size: number;
};

async function fileMeta(target: string, rel: string): Promise<WatchPayload> {
  const st = await fs.stat(target);
  return { path: rel, mtimeMs: st.mtimeMs, size: st.size };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const relParam = searchParams.get("path");
  if (!relParam) {
    return new Response(JSON.stringify({ error: "path required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  let root: string;
  let target: string;
  const rel = decodeURIComponent(relParam);
  try {
    root = await luaRoot();
    target = safeUnder(root, rel);
    await fs.access(target);
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : String(err),
      }),
      { status: 404, headers: { "Content-Type": "application/json" } },
    );
  }

  const encoder = new TextEncoder();
  let closed = false;
  let debounce: ReturnType<typeof setTimeout> | null = null;
  let watcher: ReturnType<typeof watch> | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return;
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      const emitChange = async () => {
        try {
          const meta = await fileMeta(target, rel);
          send("change", meta);
        } catch {
          send("error", { error: "file missing", path: rel });
        }
      };

      void fileMeta(target, rel).then((meta) => send("ready", meta));

      try {
        watcher = watch(target, { persistent: true }, () => {
          if (debounce) clearTimeout(debounce);
          debounce = setTimeout(() => {
            void emitChange();
          }, 120);
        });
        watcher.on("error", () => {
          send("error", { error: "watch failed", path: rel });
        });
      } catch (err) {
        send("error", {
          error: err instanceof Error ? err.message : String(err),
          path: rel,
        });
      }

      heartbeat = setInterval(() => {
        send("ping", { t: Date.now() });
      }, 15000);

      const onAbort = () => {
        closed = true;
        if (debounce) clearTimeout(debounce);
        if (heartbeat) clearInterval(heartbeat);
        watcher?.close();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      request.signal.addEventListener("abort", onAbort);
    },
    cancel() {
      closed = true;
      if (debounce) clearTimeout(debounce);
      if (heartbeat) clearInterval(heartbeat);
      watcher?.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
