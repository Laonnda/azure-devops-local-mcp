#!/usr/bin/env bash
# Creates the Windows distribution ZIP in distribution/.
# Run from the repo root: bash scripts/make-release.sh

set -e
cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./package.json').version")
OUT="distribution/ado-mcp-windows-$VERSION.zip"
STAGING=$(mktemp -d)
DEST="$STAGING/ado-mcp"
mkdir -p "$DEST"

echo "Building..."
npm run build

echo "Copying files..."
cp -r dist "$DEST/"
cp package.json "$DEST/"
cp setup.ps1 "$DEST/"
cp distribution/INSTALL.txt "$DEST/"

echo "Installing production dependencies..."
cd "$DEST"
npm install --omit=dev --ignore-scripts 2>/dev/null
rm -f package-lock.json
cd - > /dev/null

echo "Zipping..."
rm -f "$OUT"
(cd "$STAGING" && zip -r "$OLDPWD/$OUT" ado-mcp -x "*/\.DS_Store" -x "*/__pycache__/*")

rm -rf "$STAGING"
echo ""
echo "Created: $OUT"
echo "Size:    $(du -sh "$OUT" | cut -f1)"
