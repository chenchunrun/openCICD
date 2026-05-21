# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an **AI-Native CI/CD Control Plane** — not a traditional CI/CD replacement. It manages the full lifecycle of AI coding agents (Claude Code, Codex, Copilot, etc.) within enterprise software delivery: task authorization, permission enforcement, isolated execution, change verification, self-repair loops, audit evidence, and controlled deployment.

The PRD is in `coding-plan.md`. All module letters (A–V) and priority levels (P0/P1/P2) referenced below correspond to sections in that document.

## Core Architecture

Nine-stage pipeline, each stage is an independent module:

```
Intent Gate → Policy Engine → Agent Orchestrator → Isolated Runner
→ Verification Engine → Review Engine → Repair Loop Manager → Evidence Store
→ Release / GitOps Gate
```

**Control plane / execution plane separation** — control plane handles tasks, policies, audit; execution plane runs agents in isolated runners.

## Language & Tech Stack

- **Backend**: TypeScript (Node.js) — all data models and adapter interfaces in the PRD are TypeScript
- **Agent adapters**: TypeScript async iterables for event streaming (`AsyncIterable<AgentEvent>`)
- **Policies**: YAML-based, multi-layer (org → repo → directory → task → emergency override)
- **Evidence**: JSON schema, versioned

## Module Map (PRD Sections)

| Section | Module | P0 for MVP |
|---------|--------|------------|
| A | Repo onboarding & baseline scan | Yes |
| B | Agent registry & adapter interface | Yes |
| C | Intent Gate (task normalization) | Yes |
| D | Policy Engine (permissions) | Yes |
| E | Context Broker (context assembly) | Yes |
| F | Isolated Runner (containers/worktrees) | Yes |
| G | CI orchestration (GitHub Actions first) | Yes |
| H | Verification Engine (tests, SAST, etc.) | Yes |
| I | AI Review Engine | Yes |
| J | Repair Loop Manager | Yes |
| K | Evidence Store & audit | Yes |
| L | Release / GitOps Gate | Yes |
| M | Dashboard & UI | P1 |

## Key Design Principles

1. **All AI tasks must be normalized first** — no freeform prompts to agents. Tasks require `goal`, `scope`, `done_when`.
2. **Default least privilege** — read-only or workspace-write, no network, no secrets, no production access by default.
3. **AI never reviews itself** — generating agent cannot be the sole reviewer.
4. **Deterministic checks > LLM judgment** — AI review supplements, never replaces, merge gates.
5. **Agents never deploy directly** — they create deploy PRs; deployment goes through GitOps + environment protection + human approval.

## Agent Adapter Contract

```typescript
interface AgentAdapter {
  name: string;
  capabilities(): AgentCapabilities;
  prepare(input: AgentTask, policy: EffectivePolicy): Promise<AgentRunPlan>;
  run(plan: AgentRunPlan): AsyncIterable<AgentEvent>;
  stop(runId: string): Promise<void>;
  collectDiff(runId: string): Promise<GitDiff>;
  collectEvidence(runId: string): Promise<AgentEvidence>;
  cleanup(runId: string): Promise<void>;
}
```

## API Structure

- `POST/GET /api/tasks` — task lifecycle
- `POST/GET /api/runs` — agent run lifecycle
- `GET /api/evidence/{id}` — evidence retrieval & export
- `GET/POST /api/policies/*` — policy query, validate, simulate
- `POST /webhooks/*` — GitHub, GitLab, Jenkins, Slack, PagerDuty

## Risk Classification

| Level | Auto-policy |
|-------|------------|
| Low | Auto PR + auto review OK |
| Medium | Auto PR, CI pass + human review required |
| High | Pre-approval + Code Owner mandatory |
| Critical | No auto — human-led only |

## High-Risk Paths

Changes to these paths trigger enhanced review: `infra/**`, `terraform/**`, `k8s/**`, `migrations/**`, `auth/**`, `payments/**`, `security/**`, `.github/workflows/**`, `AGENTS.md`, `CLAUDE.md`, `.codex/**`, `.claude/**`, `.mcp.json`, lock files.

## Repair Loop Defaults

- Max 2 loops
- Max 10 files changed per loop
- Must add test for bugfixes
- Cannot delete tests, weaken policies, or modify CI to skip checks
- After exhausting loops, escalate to human

## MVP Scope

GitHub only, Claude Code + Codex adapters, Intent Gate, Policy Engine, Isolated Runner (workspace-write + read-only), network disabled by default, secrets unavailable by default, Issue-to-PR, PR AI Review, CI Repair (2 loops), Evidence JSON, agent policy file change detection, basic dashboard.

## Terminology (bilingual)

Key terms appear in both English and Chinese in the PRD:
- Intent Gate / 任务规格化
- Policy Engine / 策略引擎
- Evidence / 证据包
- Repair Loop / 自修复循环
- Isolated Runner / 隔离执行器
