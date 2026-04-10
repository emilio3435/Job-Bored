#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)

npm --prefix "$REPO_ROOT" run install:repo

mkdir -p "$REPO_ROOT/.factory/library"
