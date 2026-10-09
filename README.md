# OE Plan Creator

Next.js rewrite of **OE Plan Visual** — local visualizer / editor / runner for LotusFlare Orchestration Engine plans.

Requires **Node.js 20+** (local project). No global installs beyond that.

## Quick start

```bash
cd OE_plan_v_creator
cp settings.example.json settings.json
# edit settings.json → lua_root (absolute path to your lua clone)
npm install
npm run dev
```

Open **http://127.0.0.1:3000**

## What you can do

Same as the Python tool:

1. **View** — open a plan from the lua tree, a local file, or paste JSON. Graph shows states and edges (`next`, choice, catch, …). `ref`/`merge` templates are resolved for the graph; the JSON pane keeps the canonical form.
2. **Edit** — add states from OE types or `#.wrapper` blocks (loaded from `orchestrationplan` templates). Edit in the inspector or JSON pane. Export JSON that matches hand-written OE plans.
3. **Run** — against a local Rhino OE: host, `operator_name`, Bearer token (or **Get service token**). **Upsert before run** is on by default (`add_plan` / `update_plan`), then `execute_plan_immediately`.

## Settings

| Key | Meaning |
|-----|---------|
| `lua_root` | Absolute path to the `lua` repo |
| `default_host` | OE base URL — local Rhino Lua NodePort is usually `http://localhost:31880` |
| `default_operator` | Canonical operator name for mutating plan APIs |
| `port` | Reserved (Next uses `npm run dev` port, default 3000) |

**Refresh schema from lua** (Settings) rescans validators + state-block wrappers under `orchestrationplan`.

## Stack

- Next.js 16.4 (App Router) + React 19 + TypeScript
- Tailwind CSS 4 + **shadcn/ui** (`src/components/ui/`)
- Cytoscape + dagre (graph)
- Monaco (JSON editors)
- Zustand (UI state)
- Server API routes for lua FS + OE proxy (replaces `server.py`)

## Layout

```
src/app/api/                 # /api/settings, /api/lua/*, /api/proxy, /api/schema, …
src/components/ui/           # shadcn primitives (CLI-managed)
src/components/editor/       # feature modules (toolbar, sidebar, inspector, panes)
  dialogs/                   # one *Dialog.tsx per modal
src/components/PlanEditor.tsx  # orchestration only
src/lib/plan/                # model, validator, run helpers
src/lib/server/              # lua FS, resolve refs, schema extract
.cursor/rules/               # AI rules: structure, reuse, modular + adaptive UI
data/schema-cache.json
settings.json
```

Agent rules (always apply):

- `modular-ui.mdc` — split by region, configurable props, desktop-first adaptive
- `component-reuse.mdc` — use shadcn, no one-off buttons/modals
- `project-structure.mdc` — where files belong

Add UI pieces with:

```bash
npx shadcn@latest add <component>
```

## Auth (same idea as `it_bruno`)

- Prefer **Get service token** → `POST /api/v3/authorization/get_service_token`
- Or paste a Bearer token from Bruno / portal
- Plan upserts need the **canonical** operator name

Local OE must already be running; this tool does not start Rhino.
