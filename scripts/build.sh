#!/bin/bash
set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}Starting ffxpy build process...${NC}"

# 1. Check for required commands
if ! command -v npm &> /dev/null; then
    echo -e "${RED}Error: npm is not installed.${NC}"
    exit 1
fi

if ! command -v uv &> /dev/null; then
    echo -e "${RED}Error: uv is not installed.${NC}"
    exit 1
fi

# 2. Build Frontend
echo -e "${BLUE}Step 1: Building Frontend (Web UI)...${NC}"
cd src/ffxpy/web/ui
if [ ! -d "node_modules" ]; then
    echo -e "${BLUE}Installing npm dependencies...${NC}"
    npm install
fi
npm run build
cd - > /dev/null

# 3. Build Python Package
echo -e "${BLUE}Step 2: Building Python Wheel and Source Distribution...${NC}"
uv build

echo -e "${GREEN}Build successful! artifacts are in the 'dist' directory.${NC}"
ls -lh dist/
