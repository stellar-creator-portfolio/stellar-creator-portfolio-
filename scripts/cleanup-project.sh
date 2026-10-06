#!/bin/bash

# Stellar Creator Portfolio - Project Cleanup Script
# Removes temporary files, logs, and unnecessary artifacts

echo "🧹 Starting project cleanup..."

# Remove log files
echo "Removing log files..."
find . -name "*.log" -type f -delete
rm -rf logs/*

# Remove temporary files
echo "Removing temporary files..."
find . -name "*.tmp" -type f -delete
find . -name "*.temp" -type f -delete
find . -name "*~" -type f -delete

# Remove OS generated files
echo "Removing OS generated files..."
find . -name ".DS_Store" -type f -delete
find . -name ".DS_Store?" -type f -delete
find . -name "._*" -type f -delete
find . -name ".Spotlight-V100" -type f -delete
find . -name ".Trashes" -type f -delete
find . -name "ehthumbs.db" -type f -delete
find . -name "Thumbs.db" -type f -delete

# Remove build artifacts
echo "Removing build artifacts..."
rm -rf dist/
rm -rf build/
rm -rf .next/
rm -rf coverage/
rm -rf .nyc_output/

# Remove node_modules in subdirectories (keep main one)
echo "Removing nested node_modules..."
find . -path "./node_modules" -prune -o -name "node_modules" -type d -exec rm -rf {} + 2>/dev/null

# Clean Rust targets
echo "Cleaning Rust targets..."
cd backend && cargo clean 2>/dev/null
cd ..

echo "✅ Project cleanup completed!"