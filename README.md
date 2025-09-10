# S U O K A - Next.js Edition

Physics-based 2048 game with liquid glass UI, built with Next.js, TypeScript, and Matter.js.

## 🚀 Getting Started

### Prerequisites

- Node.js (v18 or higher)
- npm or yarn

### Installation

1. **Install dependencies:**

   ```bash
   npm install
   ```

2. **Run the development server:**

   ```bash
   npm run dev
   ```

3. **Open your browser:**
   Navigate to [http://localhost:3000](http://localhost:3000)

### Build for Production

```bash
npm run build
npm start
```

## 🎮 Game Features

- **Physics-based gameplay** using Matter.js
- **Liquid glass UI** with animated backgrounds
- **Instant merge mechanics** for responsive gameplay
- **Particle effects** and smooth animations
- **Responsive design** that works on all devices
- **Dark theme** optimized for modern displays

## 🛠 Tech Stack

- **Next.js 15** - React framework with App Router
- **TypeScript** - Type-safe development
- **Matter.js** - 2D physics engine
- **TailwindCSS 4** - Utility-first CSS framework
- **Inter Font** - Modern typography

## 🎯 Game Rules

1. Click or tap to drop circles onto the board
2. Identical circles merge when they touch
3. Avoid letting circles cross the red danger line
4. Try to reach the highest score possible!

## 🎨 UI Highlights

- **Animated gradient background** with subtle motion
- **Glass morphism effects** for modern aesthetics
- **Particle explosions** when circles merge
- **Smooth animations** for all game interactions
- **Responsive layout** that adapts to all screen sizes

## 📱 Controls

- **Mouse/Trackpad:** Move to position, click to drop
- **Touch:** Tap and drag to position, tap to drop
- **Keyboard:** Arrow keys to move, Space/Enter to drop
- **P:** Pause/Resume
- **R:** Restart game

## 🔧 Development

The game logic is contained in `app/components/SuokaGame.tsx` with all styles in `app/globals.css`.

Key components:

- Physics engine setup and collision detection
- Particle system for visual effects
- Animation system for smooth merging
- Canvas rendering with high-DPI support
- React state management for UI updates

Enjoy playing S U O K A! 🎮✨
