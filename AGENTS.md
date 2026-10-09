<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# OE Plan Creator — agent guide

Local Next.js 16 app: visualize / edit / run LotusFlare OE plans against a `lua` checkout + local OE.

## Always read

- `.cursor/rules/modular-ui.mdc` — **split by module**, configurable props, desktop-first adaptive layout
- `.cursor/rules/project-structure.mdc` — where files go
- `.cursor/rules/component-reuse.mdc` — shadcn reuse, no one-off UI
- `README.md` — run instructions and feature list

## Stack

- Next.js App Router + TypeScript + Tailwind 4
- **shadcn/ui** (base-nova / Base UI) in `src/components/ui/`
- Cytoscape graph, Monaco JSON, Zustand store
- Server routes under `src/app/api/*` replace the old Python `server.py`

## Non-negotiables

1. **Reuse components.** Check `ui/` and `editor/` before writing new markup. Add missing shadcn pieces with `npx shadcn@latest add …`.
2. **One region → one module.** Sidebar, inspector, JSON pane, toolbar, each modal = own file under `editor/` or `editor/dialogs/`. `PlanEditor` only orchestrates.
3. **Configurable.** Feature components accept `className` + props/callbacks (and optional slots). No hard-wired panels.
4. **Desktop-first adaptive.** Looks good at 1280×800 and 1920×1080; below `lg` columns stack/collapse cleanly — no broken horizontal overflow.
5. **Same product behaviour** as the Python OE Plan Visual tool (open lua plans, edit graph/JSON, validate, upsert+run).
6. **No secrets in git.** `settings.json` is local; commit `settings.example.json` only.

## Common commands

```bash
npm run dev
npm run build
npx shadcn@latest add <component>
```
