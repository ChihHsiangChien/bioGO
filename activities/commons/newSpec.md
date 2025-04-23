# 🎣 The Commons Activity - Teacher's Page Specification

## ✅ UI Controls

- **Toggle: "Show Student Matrix"**
  - Allows students to view all players’ catches from the previous turn.
  - Default: OFF

- **Toggle: "Show Fish Chart"**
  - Allows students to view the fish pool change chart over time.
  - Default: OFF

- **Input: "Fish in Pool"**
  - Current total number of fish.
  - Default: `100`
  - Editable by teacher each turn.

- **Input: "Fish Growth Rate"**
  - Natural growth rate of the fish pool per turn.
  - Default: `0.2` (20%)
  - Editable by teacher each turn.

- **Input: "Minimum Fish per Family"**
  - Default: `2`
  - For each player's catch exceeding this number, the surplus is converted to money.

- **Input: "Fish Price"**
  - Price per fish above minimum demand.
  - Default: `10`
  - Editable each turn.

- **Button: "Update"**
  - Apply manual changes to the fish pool, growth rate, or price.

- **Button: "End Turn"**
  - Ends the current turn and enables student input for the next round.

- **Button: "End Game"**
  - Ends the game; students see a Game Over screen.

## 📊 Display Components

- **Student Catch Matrix Table**
  - Shows each student’s catch for the turn.
  - Highlights students who haven’t submitted.
  - Controlled by toggle.

- **Fish Catch Chart**
  - Shows fish pool changes across turns.
  - Controlled by toggle.

## 🔁 Game Logic

### Initial Setup
- Fish in pool: `100`
- Growth rate: `0.2`
- Fish price: `10`
- Minimum fish per family: `2`

### Turn Flow
1. Teacher clicks **"Start Game"** to begin Turn 1.
2. Students enter desired fish catch and click **"Submit"**.
3. System processes input:
   - If total catch ≤ fish in pool: all students receive requested amount.
   - If total catch > fish in pool: first-come, first-served distribution until pool is empty.
4. Each student receives feedback:
