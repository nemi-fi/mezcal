#!/usr/bin/env bash

set -euo pipefail

if [ $# -ne 2 ]; then
  echo "Usage: $0 <prover.toml> <circuit.json>"
  exit 1
fi

PROVER_TOML=$1
CIRCUIT=$2

WORK_DIR=$(dirname $PROVER_TOML)

co-noir split-input --circuit $CIRCUIT --input $PROVER_TOML --protocol REP3 --out-dir $WORK_DIR
