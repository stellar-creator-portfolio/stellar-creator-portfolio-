#!/bin/bash

# Stellar Creator Portfolio - Development Setup Script
# 
# This script sets up the complete development environment including:
# - Frontend Next.js app with tRPC
# - Backend Rust API services  
# - Mobile React Native app
# - Database migrations
# - All required dependencies

set -e  # Exit on any error

echo "🚀 Setting up Stellar Creator Portfolio development environment..."

# Check if we're in the right directory
if [[ ! -f "package.json" ]]; then
    echo "❌ Error: Please run this script from the project root directory"
    exit 1
fi

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check required tools
echo "🔍 Checking required tools..."

if ! command_exists node; then
    echo "❌ Node.js is not installed. Please install Node.js 18+ and try again."
    exit 1
fi

if ! command_exists pnpm; then
    echo "📦 Installing pnpm..."
    npm install -g pnpm
fi

if ! command_exists cargo; then
    echo "❌ Rust is not installed. Please install Rust and try again."
    echo "   Visit: https://rustup.rs/"
    exit 1
fi

if ! command_exists docker; then
    echo "⚠️  Docker is not installed. You'll need to set up PostgreSQL manually."
fi

echo "✅ All required tools are available"

# Setup environment
echo "🔧 Setting up environment..."

if [[ ! -f ".env" ]]; then
    echo "📝 Creating .env file from template..."
    cp .env.example .env
    echo "⚠️  Please update the .env file with your actual configuration values"
fi

# Install frontend dependencies
echo "📦 Installing frontend dependencies..."
pnpm install

# Setup database
if command_exists docker; then
    echo "🐘 Starting PostgreSQL database..."
    if ! docker ps | grep -q stellar-postgres; then
        docker run -d \
            --name stellar-postgres \
            -e POSTGRES_DB=stellar_portfolio \
            -e POSTGRES_USER=postgres \
            -e POSTGRES_PASSWORD=postgres \
            -p 5432:5432 \
            postgres:15
        
        echo "⏳ Waiting for database to be ready..."
        sleep 10
    fi
else
    echo "⚠️  Please ensure PostgreSQL is running on port 5432"
fi

# Run database migrations
echo "🗄️  Running database migrations..."
pnpm prisma db push
pnpm prisma generate

# Build backend Rust services
echo "⚙️  Building backend services..."
cd backend
cargo build
cd ..

# Setup mobile development (optional)
echo "📱 Setting up mobile development..."
if command_exists expo; then
    echo "✅ Expo CLI detected"
else
    echo "📱 Installing Expo CLI for mobile development..."
    pnpm install -g @expo/cli
fi

# Verify everything works
echo "🧪 Running quick verification tests..."

# Check if frontend builds
echo "  → Testing frontend build..."
if pnpm build; then
    echo "  ✅ Frontend builds successfully"
else
    echo "  ❌ Frontend build failed"
fi

# Check backend compilation
echo "  → Testing backend compilation..."
cd backend
if cargo check; then
    echo "  ✅ Backend compiles successfully"
else
    echo "  ❌ Backend compilation failed"
fi
cd ..

# Create helpful development scripts
echo "📝 Creating development scripts..."

cat > scripts/dev-frontend.sh << 'EOF'
#!/bin/bash
echo "🚀 Starting frontend development server..."
pnpm dev
EOF

cat > scripts/dev-backend.sh << 'EOF'
#!/bin/bash
echo "🚀 Starting backend development server..."
cd backend/services/api
cargo run
EOF

cat > scripts/dev-mobile.sh << 'EOF'
#!/bin/bash
echo "🚀 Starting mobile development..."
cd mobile
expo start
EOF

chmod +x scripts/dev-*.sh

echo ""
echo "🎉 Setup complete! Here's what you can do next:"
echo ""
echo "1. 🌐 Start the frontend:    ./scripts/dev-frontend.sh"
echo "2. ⚙️  Start the backend:     ./scripts/dev-backend.sh" 
echo "3. 📱 Start mobile dev:      ./scripts/dev-mobile.sh"
echo "4. 🗄️  View database:        pnpm prisma studio"
echo ""
echo "📖 Key URLs:"
echo "   Frontend: http://localhost:3000"
echo "   Backend:  http://localhost:3001"
echo "   Database: http://localhost:5555 (Prisma Studio)"
echo ""
echo "📁 Important files:"
echo "   .env                    - Environment configuration"
echo "   prisma/schema.prisma    - Database schema"
echo "   backend/src/router.ts   - tRPC API routes"
echo ""
echo "🔧 Troubleshooting:"
echo "   - Update .env with real database credentials"  
echo "   - Run 'pnpm install' if you see dependency errors"
echo "   - Run 'cargo build' in backend/ if Rust compilation fails"
echo ""
echo "Happy coding! 🚀"