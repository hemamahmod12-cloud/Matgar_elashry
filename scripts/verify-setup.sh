#!/bin/bash
echo "🔍 التحقق من الإعداد..."
FILES=(
  ".github/workflows/ci.yml"
  ".github/workflows/codeql.yml"
  ".github/workflows/auto-format.yml"
  ".github/workflows/health-check.yml"
  ".github/dependabot.yml"
  ".eslintrc.json"
  ".prettierrc.json"
  ".prettierignore"
  "scripts/migrate-roles.js"
  "firestore.rules"
)
MISSING=0
for f in "${FILES[@]}"; do
  if [ -f "$f" ]; then
    echo "✅ $f"
  else
    echo "❌ $f مفقود"
    MISSING=$((MISSING+1))
  fi
done
if [ $MISSING -eq 0 ]; then
  echo ""
  echo "🎉 كل الملفات موجودة!"
else
  echo ""
  echo "⚠️ $MISSING ملف مفقود."
  exit 1
fi
