# WarehouseBot-RL — Autonomous Picking Simulation

A browser-based warehouse simulation where a bot learns to plan efficient, collision-free pick sequences using Reinforcement Learning.

**Live demo:** https://eholt723.github.io/warehousebot-rl/

---

## What It Does

The simulation models a 2D warehouse grid where a bot must collect items and deliver them to a drop zone while navigating around moving people. Each episode the bot:

- Plans pick order using nearest-neighbor + 2-opt heuristic
- Navigates with A* (static obstacles) and waits for human buffer clearance
- Accumulates reward based on efficiency and safety
- Reports episode results to a shared backend so stats persist across visitors

Three warehouse layouts rotate randomly. Mobile and desktop are both supported.

---

## Stack

| Layer | Tech |
|---|---|
| Frontend | Vanilla JS / HTML / Canvas |
| Hosting | GitHub Pages (`/docs`) |
| Stats backend | Cloudflare Worker + Durable Object |
| RL training | Python, stable-baselines3 (offline) |
| Model format | ONNX (exported for browser use) |

---

## Running Locally

**Site (static):** open `docs/index.html` directly in a browser, or serve `docs/` with any static server.

**Worker (dev):**
```
npx wrangler dev
```

**Worker (deploy):**
```
npx wrangler deploy
```

**Tests:**
```
npm test
```

---

## Project Structure

```
docs/              — GitHub Pages site (HTML, JS, CSS, layouts, ONNX model)
wbrl-stats/
  worker.js        — Cloudflare Worker + RLState Durable Object
rl/
  train_rl.py      — DQN training script
  warehouse_env.py — Gym environment
  export_onnx.py   — Export trained model to ONNX
  models/          — Saved model weights + ONNX file
tests/
  worker.spec.js   — Vitest tests for the worker API
wrangler.toml      — Cloudflare Workers config
```

---

## RL Setup

Training runs offline via Python. The trained model is exported to ONNX and bundled with the site for visualization. The browser sim uses the heuristic planner (not the ONNX model) for live interaction; the ONNX model is available for replay/comparison.

Shared episode stats (episode count, epsilon, avg reward, recent steps) are stored in a Cloudflare Durable Object and visible to all visitors in real time.
