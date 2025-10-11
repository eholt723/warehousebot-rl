import gymnasium as gym
from gymnasium import spaces
import numpy as np
import random

class WarehouseEnv(gym.Env):
    """
    Warehouse Picker Environment (grid-based)
    - Bot picks up items and delivers to drop zone
    - People move randomly (dynamic obstacles)
    Notes:
      * Discrete grid world
      * People avoid shelves and item cells
      * Bot avoids stepping into a person cell
    """
    metadata = {"render_modes": ["ansi"]}

    def __init__(self, grid_size=(18, 30), n_items=10, n_people=8):
        super().__init__()

        self.rows, self.cols = grid_size
        self.n_items = n_items
        self.n_people = n_people

        # Actions: 0=Up, 1=Down, 2=Left, 3=Right, 4=Wait
        self.action_space = spaces.Discrete(5)

        # Observation: (rows, cols, 3) one-hot-ish planes: items, people, bot
        self.observation_space = spaces.Box(
            low=0, high=1, shape=(self.rows, self.cols, 3), dtype=np.float32
        )

        # Static defaults; can be overridden by external layout (make_replays applies it)
        self.drop = [1, 27]
        self.bot = [1, 1]
        self.items = []     # list[(r,c)]
        self.people = []    # list[(r,c)]
        self.picked = set() # indices of items picked
        self.steps = 0
        self.done = False

    # ---------------- Core API ----------------
    def reset(self, seed=None, options=None):
        super().reset(seed=seed)

        # Randomize a default layout if none injected by external caller
        self._randomize_layout()

        self.picked = set()
        self.steps = 0
        self.done = False

        return self._get_obs(), {}

    def step(self, action):
        # SB3 sometimes gives action as np.ndarray([a]); normalize to int
        try:
            if hasattr(action, "item"):
                action = int(action.item())
            else:
                action = int(action)
        except Exception:
            action = 4  # default to 'wait'

        if action < 0 or action > 4:
            action = 4

        if self.done:
            return self._get_obs(), 0.0, True, False, {}

        self.steps += 1
        reward = -0.01  # small living-time penalty

        # ---- Move bot (try to step; don't step into a person) ----
        move = {0: (-1, 0), 1: (1, 0), 2: (0, -1), 3: (0, 1), 4: (0, 0)}[action]
        new_r = int(np.clip(self.bot[0] + move[0], 0, self.rows - 1))
        new_c = int(np.clip(self.bot[1] + move[1], 0, self.cols - 1))

        if (new_r, new_c) not in self.people:
            self.bot = [new_r, new_c]

        # ---- Pick items ----
        for idx, (r, c) in enumerate(self.items):
            if [r, c] == self.bot and idx not in self.picked:
                self.picked.add(idx)
                reward += 1.0

        # ---- Deliver all items ----
        if self.bot == self.drop and len(self.picked) == len(self.items) and len(self.items) > 0:
            reward += 5.0
            self.done = True

        # ---- Move people ----
        self._move_people()

        # ---- Collision penalty (shouldn't happen due to check above, but guard anyway) ----
        if tuple(self.bot) in self.people:
            reward -= 2.0
            self.done = True

        terminated = self.done
        truncated = self.steps >= 500

        return self._get_obs(), float(reward), bool(terminated), bool(truncated), {}

    # ---------------- Helpers ----------------
    def _randomize_layout(self):
        # Default random layout for standalone training (make_replays will override)
        self.rows, self.cols = int(self.rows), int(self.cols)
        self.bot = [1, 1]
        self.drop = [1, min(self.cols - 1, 27)]

        # Random items within interior cells
        self.items = self._spawn_items()
        # People spawn avoiding items, bot, drop
        self.people = self._spawn_people()

    def _spawn_items(self):
        coords = set()
        while len(coords) < self.n_items:
            r = random.randint(2, self.rows - 2)
            c = random.randint(2, self.cols - 2)
            coords.add((r, c))
        return list(coords)

    def _spawn_people(self):
        coords = set()
        guards = 0
        while len(coords) < self.n_people and guards < 10000:
            guards += 1
            r = random.randint(0, self.rows - 1)
            c = random.randint(0, self.cols - 1)
            if (r, c) in self.items:           # avoid item cells
                continue
            if [r, c] == self.drop:            # avoid drop
                continue
            if [r, c] == self.bot:             # avoid bot
                continue
            coords.add((r, c))
        return list(coords)

    def _move_people(self):
        new_positions = set()
        for (r, c) in self.people:
            dr, dc = random.choice([(1,0),(-1,0),(0,1),(0,-1),(0,0)])  # (0,0)=idle sometimes
            nr = int(np.clip(r + dr, 0, self.rows - 1))
            nc = int(np.clip(c + dc, 0, self.cols - 1))
            # avoid items and don't double-book same cell this tick
            if (nr, nc) in self.items or (nr, nc) in new_positions:
                nr, nc = r, c
            new_positions.add((nr, nc))
        self.people = list(new_positions)

    def _get_obs(self):
        grid = np.zeros((self.rows, self.cols, 3), dtype=np.float32)
        # channel 0 = items, 1 = people, 2 = bot
        for (r, c) in self.items:
            grid[r, c, 0] = 1.0
        for (r, c) in self.people:
            grid[r, c, 1] = 1.0
        grid[self.bot[0], self.bot[1], 2] = 1.0
        return grid

    # Optional console renderer
    def render(self):
        grid = np.full((self.rows, self.cols), ".", dtype="<U1")
        for (r, c) in self.items:
            grid[r, c] = "I"
        for (r, c) in self.people:
            grid[r, c] = "P"
        dr, dc = self.drop
        grid[dr, dc] = "D"
        br, bc = self.bot
        grid[br, bc] = "B"
        print("\n".join("".join(row) for row in grid))
