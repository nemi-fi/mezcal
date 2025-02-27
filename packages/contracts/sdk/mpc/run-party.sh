#!/usr/bin/env bash

set -euo pipefail

source ../../noir/timer.sh

if [ $# -ne 3 ]; then
  echo "Usage: $0 <WORK_DIR> <CIRCUIT_PATH> <PARTY_INDEX>"
  exit 1
fi
WORK_DIR=$1
CIRCUIT=$2
PARTY_INDEX=$3

PROVER0_TOML=$WORK_DIR/Prover0.toml
PROVER1_TOML=$WORK_DIR/Prover1.toml
# copy from https://github.com/TaceoLabs/co-snarks/tree/e96a712dfa987fb39e17232ef11d067b29b62aef/co-noir/co-noir/examples/configs
PARTY_CONFIGS_DIR=configs

# merge inputs into single input file
timeStart "merge-input-shares"
co-noir merge-input-shares --inputs $PROVER0_TOML.$PARTY_INDEX.shared --inputs $PROVER1_TOML.$PARTY_INDEX.shared --protocol REP3 --out $WORK_DIR/Prover.toml.$PARTY_INDEX.shared
timeEnd "merge-input-shares"

# run witness extension in MPC
timeStart "mpc-generate-witness"
co-noir generate-witness --input $WORK_DIR/Prover.toml.$PARTY_INDEX.shared --circuit $CIRCUIT --protocol REP3 --config $PARTY_CONFIGS_DIR/party$PARTY_INDEX.toml --out $WORK_DIR/witness.gz.$PARTY_INDEX.shared
timeEnd "mpc-generate-witness"

# run proving in MPC
timeStart "mpc-build-proving-key"
co-noir build-proving-key --witness $WORK_DIR/witness.gz.$PARTY_INDEX.shared --circuit $CIRCUIT --protocol REP3 --config $PARTY_CONFIGS_DIR/party$PARTY_INDEX.toml --out $WORK_DIR/proving_key.$PARTY_INDEX
timeEnd "mpc-build-proving-key"

timeStart "mpc-generate-proof"
co-noir generate-proof --proving-key $WORK_DIR/proving_key.$PARTY_INDEX --protocol REP3 --hasher KECCAK --crs ~/.bb-crs/bn254_g1.dat --config $PARTY_CONFIGS_DIR/party$PARTY_INDEX.toml --out $WORK_DIR/proof.$PARTY_INDEX.proof --public-input $WORK_DIR/public_input.json
timeEnd "mpc-generate-proof"
