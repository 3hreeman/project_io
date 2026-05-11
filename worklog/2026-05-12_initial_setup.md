# Project: Real-time .io Game Prototype (project_io)

## 📅 Worklog - 2026-05-12

### 1. Project Overview
- **Goal**: Create a smooth, server-authoritative real-time multiplayer game prototype.
- **Tech Stack**:
    - **Backend**: Node.js, Express, Socket.io, TypeScript.
    - **Frontend**: HTML5 Canvas, Vanilla JavaScript, Socket.io-client.
    - **Model**: Server-Authoritative (Server calculates state at 30Hz).

### 2. Core Features Implemented
#### A. Authoritative Server Logic
- Server maintains the master state of all players.
- Tick rate: 30Hz (updates every 33.3ms).
- Movement, boundary checks, and chat timers are handled on the server.

#### B. Movement System
- **Keyboard**: WASD support.
- **Mouse**: Click-to-move support with vector-based navigation.
- **Priority**: Keyboard input overrides/cancels active mouse movement.

#### C. User Interface & Social
- **Nickname System**: Entry screen before joining.
- **Overhead UI**: Nicknames and chat bubbles rendered directly above players on the Canvas.
- **Chat System**: Toggleable chat input (Enter key). Messages disappear after 5 seconds.

#### D. Networking & Performance
- **Client-side Interpolation**:
    - The server sends a timestamp with every state update.
    - The client maintains a `stateBuffer` of recent states.
    - Rendering is delayed by 100ms (`RENDER_DELAY`) to allow for smooth linear interpolation between states, resulting in 60fps+ visual fluidness despite the 30Hz server rate.

### 3. Project Structure
- `src/server.ts`: Main server logic and state management.
- `public/index.html`: Unified client-side file (HTML, CSS, JS).
- `tsconfig.json`: Configured with `rootDir: ./src` and `outDir: ./dist`.
- `package.json`: Contains `dev` script using `ts-node-dev`.
- `.gitignore`: Excludes `node_modules`, `dist`, and system files.

### 4. Git Repository
- **Local**: Initialized and committed all features.
- **Remote**: Connected to `https://github.com/3hreeman/project_io.git`.
- **Branch**: `master`.

---
*This log serves as a hand-off document for future development sessions.*
