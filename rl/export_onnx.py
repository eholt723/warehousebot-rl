# rl/export_onnx.py
# Export SB3 DQN policy to ONNX for browser inference (onnxruntime-web).

import os
import torch
from stable_baselines3 import DQN
from warehouse_env import WarehouseEnv

MODEL_PATH = "models/warehouse_dqn.zip"
ONNX_PATH  = "models/warehouse_dqn.onnx"

def main():
    print("Loading model…")
    env = WarehouseEnv()
    model = DQN.load(MODEL_PATH)
    policy = model.policy
    policy.eval()  # inference mode
    device = torch.device("cpu")

    # Wrap the policy so ONNX sees a clean module: obs -> q_values
    class QModule(torch.nn.Module):
        def __init__(self, policy):
            super().__init__()
            self.policy = policy

        def forward(self, obs_flat: torch.Tensor):
            # SB3 DQNPolicy.forward returns Q-values given flattened obs
            return self.policy.forward(obs_flat)

    qm = QModule(policy).to(device).eval()

    obs_size = env.rows * env.cols * 3  # matches your JS obs builder
    dummy = torch.zeros(1, obs_size, dtype=torch.float32, device=device)

    # Classic exporter (no extra packages required)
    with torch.no_grad():
        torch.onnx.export(
            qm,
            dummy,
            ONNX_PATH,
            input_names=["obs"],
            output_names=["q_values"],
            dynamic_axes={"obs": {0: "batch"}, "q_values": {0: "batch"}},
            opset_version=12,
        )

    assert os.path.exists(ONNX_PATH), "ONNX file was not created."
    print(f"✅ Exported ONNX to {ONNX_PATH}")

if __name__ == "__main__":
    main()
