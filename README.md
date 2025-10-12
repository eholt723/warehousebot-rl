# WarehouseBot-RL — Autonomous Picking Simulation

## Problem Framing
Modern fulfillment centers must balance efficiency and safety as robots or human pickers navigate busy warehouse aisles.  
The challenge is to minimize travel time and collisions while completing multiple pick tasks in dynamic environments with shifting obstacles and routes.

## Goal
Develop an autonomous agent that learns to plan efficient, collision-free pick sequences.  
The agent should determine both the optimal order of items to collect and the safest, most efficient path between them, improving throughput and reducing total travel distance.

## Approach
This simulation models a warehouse environment on a 2D grid where the agent learns through **Reinforcement Learning (Q-Learning)**.  
Each episode consists of multiple pick tasks, and the agent receives:

- **Rewards** for efficient, safe deliveries  
- **Penalties** for collisions, delays, or unnecessary movement  

Performance is compared to heuristic path planners such as **A\*** and **nearest-item selection**.  
Over time, the RL agent learns policies that outperform static methods by optimizing both path length and decision efficiency.

## Key Concepts
- **Reinforcement Learning:** The agent learns by interacting with the environment using trial and error.  
- **State Space:** Agent position, remaining items, and surrounding obstacles.  
- **Actions:** Move up, down, left, right, or choose next pick target.  
- **Reward Function:** Encourages shorter routes and penalizes unsafe or inefficient moves.  
- **Benchmarking:** Evaluated against traditional A* planning to demonstrate adaptive learning improvements.

## Summary
This project demonstrates how Reinforcement Learning can be applied to spatial decision-making problems such as warehouse picking.  
The simulation visualizes intelligent path optimization, safety-aware behavior, and adaptability to different warehouse layouts.

