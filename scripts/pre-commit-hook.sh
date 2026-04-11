#!/usr/bin/env sh
# Pre-commit hook for regression prevention
# Runs quick validation checks before allowing commits

set -e

REPO_ROOT=$(git rev-parse --show-toplevel)
cd "$REPO_ROOT"

echo "Running pre-commit validation..."

# Check that .factory/skills/SKILL.md files exist and are readable (they must exist in .factory)
if [ -d ".factory/skills" ]; then
  for skill_dir in .factory/skills/*/; do
    if [ -f "${skill_dir}SKILL.md" ]; then
      : # SKILL.md exists - good
    else
      echo "WARNING: ${skill_dir}SKILL.md is missing"
    fi
  done
fi

# Quick syntax check for modified JS files
STAGED_JS=$(git diff --cached --name-only --diff-filter=ACM | grep -E '\.(js|mjs)$' | grep -v node_modules | grep -v server/node_modules || true)
if [ -n "$STAGED_JS" ]; then
  echo "Checking staged JS files syntax..."
  for f in $STAGED_JS; do
    if ! node --check "$f" 2>/dev/null; then
      echo "SYNTAX ERROR in $f"
      exit 1
    fi
  done
fi

# Check that integration skills reference the contract
if [ -d "integrations" ]; then
  STAGED_INTEGRATION_SKILLS=$(git diff --cached --name-only --diff-filter=ACM | grep "integrations/.*/SKILL.md$" || true)
  if [ -n "$STAGED_INTEGRATION_SKILLS" ]; then
    echo "Validating integration skill references..."
    if ! npm run lint:skills >/dev/null 2>&1; then
      echo "FAIL: Integration skills are missing required contract references"
      echo "Run 'npm run lint:skills' for details"
      exit 1
    fi
  fi
fi

# Check that validation artifacts aren't staged (they belong in .factory/validation/)
STAGED_ARTIFACTS=$(git diff --cached --name-only --diff-filter=ACM | grep -E "^evidence/|^.factory/validation/" || true)
if [ -n "$STAGED_ARTIFACTS" ]; then
  echo "WARNING: Validation artifacts staged:"
  echo "$STAGED_ARTIFACTS"
  echo "These should typically remain untracked or in .factory/validation/"
fi

echo "Pre-commit validation passed."
exit 0
