#!/usr/bin/env bash
# Creates the Windows distribution ZIP in distribution/.
# Run from the repo root: bash scripts/make-release.sh

set -e
cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./package.json').version")
OUT="distribution/azure-devops-local-mcp-windows-$VERSION.zip"
STAGING=$(mktemp -d)
DEST="$STAGING/azure-devops-local-mcp"
mkdir -p "$DEST"

echo "Building..."
npm run build

echo "Copying files..."
cp -r dist "$DEST/"
cp package.json "$DEST/"
cp setup.bat "$DEST/"
cp setup.ps1 "$DEST/"

cat > "$DEST/INSTALL.txt" <<'EOF'
azure-devops-local-mcp — Windows installation
==============================

1. Install Node.js 20 or later (LTS installer from https://nodejs.org).
2. Extract this ZIP to a permanent folder, e.g. C:\tools\azure-devops-local-mcp.
   Do not move the folder afterwards.
3. Right-click setup.ps1 and choose "Run with PowerShell".
4. Follow the prompts: Azure DevOps organization URL, Personal Access
   Token, and optionally a default project.
5. Restart Claude Desktop.

The setup script writes the Claude Desktop configuration automatically.
Run it again if you need to change the URL or renew the token.

Tip: Claude Desktop users can skip this ZIP entirely — download the
.mcpb bundle from the GitHub releases page and open it with Claude
Desktop instead. No Node.js required.
EOF

echo "Installing production dependencies..."
cd "$DEST"
npm install --omit=dev --ignore-scripts 2>/dev/null
rm -f package-lock.json
cd - > /dev/null

echo "Zipping..."
rm -f "$OUT"
(cd "$STAGING" && zip -r "$OLDPWD/$OUT" azure-devops-local-mcp -x "*/\.DS_Store" -x "*/__pycache__/*")

rm -rf "$STAGING"
echo ""
echo "Created: $OUT"
echo "Size:    $(du -sh "$OUT" | cut -f1)"
