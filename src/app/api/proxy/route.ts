import { NextResponse } from "next/server";
import { assertLocalOeHost } from "@/lib/plan/localHost";
import { loadSettings } from "@/lib/server/settings";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      host?: string;
      path?: string;
      method?: string;
      headers?: Record<string, string>;
      token?: string;
      body?: unknown;
    };
    const settings = await loadSettings();
    let target: string;
    try {
      target = assertLocalOeHost(body.host || settings.default_host || "");
    } catch (err) {
      return NextResponse.json(
        {
          error:
            err instanceof Error
              ? err.message
              : "Only local OE hosts are allowed",
        },
        { status: 403 },
      );
    }
    const apiPath = body.path;
    const method = (body.method || "POST").toUpperCase();
    if (!apiPath) {
      return NextResponse.json({ error: "path required" }, { status: 400 });
    }

    const headers: Record<string, string> = { ...(body.headers || {}) };
    if (body.token) headers.Authorization = `Bearer ${body.token}`;

    let raw: string | undefined;
    if (body.body !== undefined) {
      raw = JSON.stringify(body.body);
      if (!headers["Content-Type"] && !headers["content-type"]) {
        headers["Content-Type"] = "application/json";
      }
    }

    const url = `${target.replace(/\/$/, "")}/${apiPath.replace(/^\//, "")}`;
    let status = 502;
    let respHeaders: Record<string, string> = {};
    let parsedBody: unknown;

    const reqPreview = raw ? raw.slice(0, 800) : "";
    console.log(`[oe-proxy] → ${method} ${url}`);
    if (reqPreview) console.log(`[oe-proxy]   req: ${reqPreview}`);

    try {
      const resp = await fetch(url, {
        method,
        headers,
        body: method === "GET" || method === "HEAD" ? undefined : raw,
        signal: AbortSignal.timeout(120_000),
      });
      status = resp.status;
      const allow = new Set(["content-type", "reservations", "x-request-id"]);
      resp.headers.forEach((value, key) => {
        if (allow.has(key.toLowerCase())) respHeaders[key] = value;
      });
      const text = await resp.text();
      try {
        parsedBody = JSON.parse(text);
      } catch {
        parsedBody = { raw: text };
      }

      const bodyPreview =
        typeof parsedBody === "object" && parsedBody
          ? JSON.stringify(parsedBody).slice(0, 1200)
          : String(text).slice(0, 1200);
      console.log(`[oe-proxy] ← ${status} ${apiPath}`);
      console.log(`[oe-proxy]   res: ${bodyPreview}`);

      // Extra parse hints for execution viewers.
      if (
        apiPath.includes("get_state_history") &&
        parsedBody &&
        typeof parsedBody === "object"
      ) {
        const b = parsedBody as Record<string, unknown>;
        const hist = (b.history ||
          b.state_history ||
          b.states ||
          b.data) as unknown;
        const rows = Array.isArray(hist) ? hist : [];
        const emptyErr = rows.filter(
          (r) =>
            r &&
            typeof r === "object" &&
            (r as { error?: unknown }).error != null &&
            typeof (r as { error?: unknown }).error === "object" &&
            Object.keys((r as { error: object }).error).length === 0,
        ).length;
        console.log(
          `[oe-proxy]   state_history rows=${rows.length} empty_error_objects=${emptyErr}`,
        );
      }
    } catch (err) {
      console.error(
        `[oe-proxy] ✗ ${method} ${url}:`,
        err instanceof Error ? err.message : err,
      );
      return NextResponse.json({
        status: 502,
        headers: { "Content-Type": "application/json" },
        body: {
          error: "proxy_failed",
          message: err instanceof Error ? err.message : String(err),
        },
      });
    }

    return NextResponse.json({
      status,
      headers: respHeaders,
      body: parsedBody,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
