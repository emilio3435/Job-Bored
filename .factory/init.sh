#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)

npm --prefix "$REPO_ROOT" run install:repo

mkdir -p "$REPO_ROOT/.factory/library"

# Install pre-commit hook if not present
if [ ! -f "${REPO_ROOT}/.git/hooks/pre-commit" ] && [ -f "${REPO_ROOT}/scripts/pre-commit-hook.sh" ]; then
  cp "${REPO_ROOT}/scripts/pre-commit-hook.sh" "${REPO_ROOT}/.git/hooks/pre-commit"
  chmod +x "${REPO_ROOT}/.git/hooks/pre-commit"
  echo "Pre-commit hook installed."
fi
