# Vertical Tabs Chrome Extension

Arc/Zen-inspired vertical tab management for Chrome, built with React + TypeScript + Vite + CRXJS.

## Features

- ✅ Side panel with tab list
- ✅ Search tabs by title or URL
- ✅ Switch between tabs
- ✅ Close tabs
- ✅ Pinned tabs support
- ✅ Custom new tab page
- ✅ Hot reload in development
- ✅ Service worker for tab management

## Development

### Prerequisites

- Node.js 18+ and npm

### Setup

```bash
# Install dependencies
npm install

# Start development server with hot reload
npm run dev

# Build for production
npm run build
```

### Loading in Chrome

1. Go to `chrome://extensions/`
2. Enable "Developer mode" (top right toggle)
3. Click "Load unpacked"
4. Select the `dist` folder in your project
5. Click the extension icon or use `Ctrl+Shift+E` (or `Cmd+Shift+E` on Mac) to open the side panel

## Project Structure

```
vertical-tabs/
├── src/
│   ├── background/          # Service worker
│   ├── sidepanel/           # Side panel React app
│   ├── newtab/              # New tab page
│   ├── lib/                 # Utilities (chrome-api, messages, storage)
│   ├── types/               # TypeScript types
│   └── styles/              # Global styles
├── public/                  # Static assets (icons)
├── manifest.json            # Extension manifest
└── vite.config.ts          # Vite configuration
```

## Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build extension for production
- `npm run preview` - Preview production build
- `npm run watch` - Build in watch mode

## Technologies

- **React 19** - UI framework
- **TypeScript** - Type safety
- **Vite** - Build tool
- **CRXJS** - Chrome extension Vite plugin
- **Tailwind CSS** - Styling
- **Zustand** - State management (ready for future use)

## License

MIT
