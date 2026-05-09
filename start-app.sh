#!/bin/bash

echo "🚀 Starting Stock Journal App..."
echo "This will start both the backend server and frontend app."
echo ""

# Kill any existing processes on required ports
echo "🧹 Cleaning up any existing processes..."
lsof -ti:3002 | xargs kill -9 2>/dev/null || true
lsof -ti:4174 | xargs kill -9 2>/dev/null || true
sleep 2

# Check if dependencies are installed
if [ ! -d "node_modules" ]; then
    echo "📦 Installing root dependencies..."
    npm install
fi

if [ ! -d "backend/node_modules" ]; then
    echo "📦 Installing backend dependencies..."
    npm install --prefix backend
fi

if [ ! -d "frontend/node_modules" ]; then
    echo "📦 Installing frontend dependencies..."
    npm install --prefix frontend
fi

echo ""
echo "🔄 Starting both backend and frontend servers..."
echo "Backend will run on: http://localhost:3002"
echo "Frontend will run on: http://localhost:4174"
echo ""
echo "Press Ctrl+C to stop both servers"
echo ""

# Start both servers
npm start