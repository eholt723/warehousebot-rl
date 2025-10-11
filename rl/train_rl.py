from stable_baselines3 import DQN
from warehouse_env import WarehouseEnv

env = WarehouseEnv()

# Initialize model
model = DQN("MlpPolicy", env, verbose=1, learning_rate=0.0005, buffer_size=50000)

# Train for a few thousand steps
model.learn(total_timesteps=100000)

# Save the model
model.save("models/warehouse_dqn")

print("✅ Training complete! Model saved to models/warehouse_dqn.zip")
