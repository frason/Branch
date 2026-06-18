# Branch — Claude Code Starter Brief

Paste this into a fresh Claude Code session in an empty project folder.

---

## What we're building

Branch: a spatial, branching canvas for exploring AI image generation iterations.
Full concept, tech stack, and competitive landscape are in the attached one-pager
(branch-canvas-onepager.pdf). Key points Claude Code needs:

- Frontend: React + Babylon.js (WebGL) canvas. Nodes = generated images. Edges =
  branch lineage. Must stay responsive with a large node tree (Figma-style perf).
- Backend: Node + Express. Owns an async generation queue against a real image
  API (start with Flux via fal.ai or Replicate for cheap iteration; keep the
  provider swappable — see adapter pattern below).
- Persistence: Postgres. Trees, nodes, branch-level settings (aspect ratio, model
  version — fixed per branch) vs node-level settings (lens, style, f-stop — flex
  per iteration).
- Token budget + velocity: live spend tracking (running balance) AND a rolling
  burn-rate indicator (spend per minute over a trailing window), so launching
  several branches at once visibly spikes velocity before the budget itself runs out.
- Architecture must keep the generation layer swappable — same canvas and budget
  system should be able to point at a different model/artifact type later
  (text, audio) without a rewrite.

## Step 1 — Initialize the repo

```
git init
npm init -y
mkdir -p src/client src/server/generation src/server/db .claude/agents
```

Set up a GitHub repo and push immediately — GitHub issues are the task queue for
this whole project (see below), so we need git remote wired up before any real work starts.

## Step 2 — Drop in `.claude/settings.json`

```json
{
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  }
}
```

Note: this flag enables agent teams if we ever want parallel multi-perspective
review on something gnarly. Day-to-day work should use subagents (below), not
agent teams — teams spin up full separate Claude sessions and cost roughly 5x
per teammate, which works against the "don't blow through my session window"
goal. Subagents are the right default; reach for a team only when a task
genuinely needs multiple agents debating each other live.

## Step 3 — Add the subagents (already drafted, copy into `.claude/agents/`)

Four agents, deliberately split by cost tier as well as domain:

| Agent | Model | Why this tier |
|---|---|---|
| `canvas-builder` | sonnet | Frontend/WebGL work needs real judgment — layout, performance tradeoffs, state design |
| `backend-builder` | sonnet | Same: queue design, schema design, provider abstraction need real reasoning |
| `chore-runner` | haiku | Mechanical work only — running tests and reporting failures, lint, formatting, docstrings, changelog updates. No architectural judgment, so the cheap model is genuinely sufficient |
| `pr-reviewer` | sonnet | Read-only gate before a PR opens — worth paying for since catching a bad merge is higher value than the chore tier |

This is the actual mechanism for "use cheaper models for mundane tasks": each
subagent declares its own `model` in frontmatter, and routine/mechanical work
gets routed to a `haiku`-tier agent explicitly rather than letting everything
default to whatever the main session is running. Claude Code also has a
built-in `Explore` subagent that always runs on Haiku for read-only codebase
search — lean on that automatically for "find where X is defined" style
lookups instead of spending main-session budget on it.

Rule of thumb going forward as you add agents: if a task requires deciding
*how* to do something, it's sonnet; if it requires *executing* an
already-decided mechanical step (run tests, format, summarize logs, rename
things), it's haiku.

## Step 4 — Use GitHub issues as the cross-session task queue

This is what actually solves "don't blow through a 5-hour window" — not agent
teams, not loops inside one session. The pattern:

1. Every piece of work (feature, bug, chore) becomes a GitHub issue, labeled
   `ready`, `in-progress`, or `blocked`.
2. Each Claude Code session starts with: *"Check open issues labeled `ready`,
   pick the highest-priority one, implement it on a branch, open a PR
   referencing the issue, and stop."*
3. The session does the work using `canvas-builder` / `backend-builder` as
   appropriate, runs `chore-runner` for tests/lint, runs `pr-reviewer` before
   opening the PR, then stops.
4. Next session (next window, next day, whenever) repeats step 2 with the next
   ready issue. The issue/PR history is the persistent memory across windows —
   you're not relying on one long-running session or context carrying over.

This also means you get a clean audit trail of what got built, when, and why,
which lines up with wanting tickets/PRs/bugs documented from day one.

## Step 5 — First milestone (the actual first prompt to send)

Once the above is in place, kick off real work with something like:

> Create GitHub issues for: (1) basic Express server skeleton with a health
> check route, (2) Postgres schema for trees/nodes/branch settings, (3) a
> Babylon.js canvas that renders a single static node, (4) a generation
> adapter interface that the backend-builder agent will implement against
> Flux first. Label them all `ready`. Then pick issue 1, implement it on a
> branch, run tests via chore-runner, review via pr-reviewer, and open a PR.

That gives you a working skeleton plus a populated backlog for the next
session to continue from.
