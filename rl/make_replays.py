# Generates JSON episodes your browser demo can play.
# Forces the Python env to mirror docs/data/layout-01.json so labels match A..J.

import json, os
from stable_baselines3 import DQN
from warehouse_env import WarehouseEnv

LAYOUT_JSON = "../docs/data/layout-01.json"
OUT_DIR = "../docs/data/episodes"
N_EPISODES = 3
MAX_STEPS = 600

def load_layout():
    with open(LAYOUT_JSON, "r") as f:
        return json.load(f)

def apply_layout(env: WarehouseEnv, layout: dict):
    """Set env fields so they match the website layout exactly."""
    env.rows = int(layout["rows"])
    env.cols = int(layout["cols"])

    # items in A..J order so we keep letter mapping
    label_order = sorted(list(layout["items"].keys()))  # ["A","B",...]
    env.items = [tuple(layout["items"][k]) for k in label_order]
    env.n_items = len(env.items)

    # drop/dock/start/bot
    env.drop = list(layout.get("drop", [1, min(env.cols - 1, 27)]))
    start = layout.get("dock", layout.get("start", [1, 1]))
    env.bot = list(start)

    # people count (spawn avoids items)
    env.n_people = int(layout.get("people", {}).get("count", 8))
    env.people = env._spawn_people()

    env.picked = set()
    env.steps = 0
    env.done = False
    return label_order

def roll_episode(env: WarehouseEnv, model: DQN, label_order, max_steps=600):
    # env.reset() randomizes; immediately force layout to match website
    env.reset()
    layout = load_layout()
    label_order = apply_layout(env, layout)

    frames = []
    done = truncated = False
    t = 0
    obs, _ = env.reset()  # SB3 expects reset before first predict; reset then re-apply:
    label_order = apply_layout(env, layout)

    while not (done or truncated) and t < max_steps:
      # predict → step
        action, _ = model.predict(obs, deterministic=True)
        # env.step handles ndarray action; no need to cast here
        obs, r, done, truncated, _ = env.step(action)

        frames.append({
            "t": t,
            "bot": env.bot,                      # [r,c]
            "people": env.people,                # [[r,c], ...]
            "picked_idx": sorted(list(env.picked))  # indices into env.items
        })
        t += 1

    return {
        "meta": {
            "rows": env.rows, "cols": env.cols,
            "drop": env.drop,
            "dock": layout.get("dock", layout.get("start", [1,1])),
            "items": env.items,           # coords list aligned to label_order
            "labels": label_order         # ["A","B",...]
        },
        "frames": frames
    }

if __name__ == "__main__":
    os.makedirs(OUT_DIR, exist_ok=True)
    env = WarehouseEnv()
    layout = load_layout()
    labels = apply_layout(env, layout)

    model = DQN.load("models/warehouse_dqn")  # ensure this path exists

    for i in range(1, N_EPISODES + 1):
        ep = roll_episode(env, model, labels, MAX_STEPS)
        out_path = os.path.join(OUT_DIR, f"rl-episode-{i:02d}.json")
        with open(out_path, "w") as f:
            json.dump(ep, f)
        print(f"Saved {out_path}")

    print("✅ Episodes written to docs/data/episodes/")
