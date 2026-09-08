#!/usr/bin/env bash
# Creates the cross-platform MCP Bundle (.mcpb) in distribution/.
# One bundle covers macOS, Windows, and Linux (node server type).
# Run from the repo root: bash scripts/make-mcpb.sh

set -e
cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./package.json').version")
OUT="distribution/ado-mcp-$VERSION.mcpb"
STAGING=$(mktemp -d)
DEST="$STAGING/ado-mcp"
mkdir -p "$DEST" distribution

echo "Building..."
npm run build

echo "Copying files..."
cp -r dist "$DEST/"
cp manifest.json "$DEST/"
cp package.json "$DEST/"
cp package-lock.json "$DEST/"
cp README.md "$DEST/"
cp LICENSE "$DEST/"

echo "Installing production dependencies..."
(cd "$DEST" && npm ci --omit=dev --ignore-scripts 2>/dev/null)

echo "Validating manifest..."
npx -y @anthropic-ai/mcpb validate "$DEST/manifest.json"

echo "Packing..."
rm -f "$OUT"
npx -y @anthropic-ai/mcpb pack "$DEST" "$OUT"

rm -rf "$STAGING"
echo ""
echo "Created: $OUT"
echo "Size:    $(du -sh "$OUT" | cut -f1)"
