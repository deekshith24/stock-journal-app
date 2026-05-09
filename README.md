# Stock Journal App - Quick Start

## 🚀 Easy Start (Recommended for non-developers)

### Option 1: One-Click Script (Mac/Linux)
Double-click the `start-app.sh` file in your project folder, or run:
```bash
./start-app.sh
```

### Option 2: One-Click Script (Windows)
Double-click the `start-app.bat` file in your project folder.

### Option 3: Manual Start
Open terminal/command prompt in the project folder and run:
```bash
npm start
```

## 📋 What happens when you start the app?

1. **Port Cleanup**: Automatically kills any existing processes using ports 3002 and 4174
2. **Dependencies Check**: Automatically installs any missing packages
3. **Backend Server**: Starts on http://localhost:3002
4. **Frontend App**: Starts on http://localhost:4174
5. **Browser**: Open http://localhost:4174 in your browser

## 🛑 How to stop the app?

Press `Ctrl+C` in the terminal/command prompt window.

## 🔧 Developer Options

If you want to run them separately:
- Backend only: `npm run dev --prefix backend`
- Frontend only: `npm run dev --prefix frontend`

## 📞 Need Help?

If the app doesn't start, make sure you have Node.js installed. Download from: https://nodejs.org/