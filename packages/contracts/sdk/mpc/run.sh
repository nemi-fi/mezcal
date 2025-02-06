#!/usr/bin/env bash

set -euo pipefail

source ../../noir/timer.sh

if [ $# -ne 2 ]; then
  echo "Usage: $0 <WORK_DIR> <CIRCUIT_PATH>"
  exit 1
fi
WORK_DIR=$1
CIRCUIT=$2

PROVER0_TOML=$WORK_DIR/Prover0.toml
PROVER1_TOML=$WORK_DIR/Prover1.toml
# copy from https://github.com/TaceoLabs/co-snarks/tree/e96a712dfa987fb39e17232ef11d067b29b62aef/co-noir/co-noir/examples/configs
PARTY_CONFIGS_DIR=configs

# merge inputs into single input file
timeStart "merge-input-shares"
co-noir merge-input-shares --inputs $PROVER0_TOML.0.shared --inputs $PROVER1_TOML.0.shared --protocol REP3 --out $WORK_DIR/Prover.toml.0.shared
co-noir merge-input-shares --inputs $PROVER0_TOML.1.shared --inputs $PROVER1_TOML.1.shared --protocol REP3 --out $WORK_DIR/Prover.toml.1.shared
co-noir merge-input-shares --inputs $PROVER0_TOML.2.shared --inputs $PROVER1_TOML.2.shared --protocol REP3 --out $WORK_DIR/Prover.toml.2.shared
timeEnd "merge-input-shares"

# run witness extension in MPC
timeStart "mpc-generate-witness"
co-noir generate-witness --input $WORK_DIR/Prover.toml.0.shared --circuit $CIRCUIT --protocol REP3 --config $PARTY_CONFIGS_DIR/party0.toml --out $WORK_DIR/witness.gz.0.shared &
co-noir generate-witness --input $WORK_DIR/Prover.toml.1.shared --circuit $CIRCUIT --protocol REP3 --config $PARTY_CONFIGS_DIR/party1.toml --out $WORK_DIR/witness.gz.1.shared &
co-noir generate-witness --input $WORK_DIR/Prover.toml.2.shared --circuit $CIRCUIT --protocol REP3 --config $PARTY_CONFIGS_DIR/party2.toml --out $WORK_DIR/witness.gz.2.shared
wait $(jobs -p)
timeEnd "mpc-generate-witness"

# run proving in MPC
timeStart "mpc-build-proving-key"
co-noir build-proving-key --witness $WORK_DIR/witness.gz.0.shared --circuit $CIRCUIT --crs ~/.bb-crs/bn254_g1.dat --protocol REP3 --config $PARTY_CONFIGS_DIR/party0.toml --out $WORK_DIR/proving_key.0 &
co-noir build-proving-key --witness $WORK_DIR/witness.gz.1.shared --circuit $CIRCUIT --crs ~/.bb-crs/bn254_g1.dat --protocol REP3 --config $PARTY_CONFIGS_DIR/party1.toml --out $WORK_DIR/proving_key.1 &
co-noir build-proving-key --witness $WORK_DIR/witness.gz.2.shared --circuit $CIRCUIT --crs ~/.bb-crs/bn254_g1.dat --protocol REP3 --config $PARTY_CONFIGS_DIR/party2.toml --out $WORK_DIR/proving_key.2
wait $(jobs -p)
timeEnd "mpc-build-proving-key"

timeStart "mpc-generate-proof"
co-noir generate-proof --proving-key $WORK_DIR/proving_key.0 --protocol REP3 --hasher KECCAK --config $PARTY_CONFIGS_DIR/party0.toml --out $WORK_DIR/proof.0.proof --public-input $WORK_DIR/public_input.json &
co-noir generate-proof --proving-key $WORK_DIR/proving_key.1 --protocol REP3 --hasher KECCAK --config $PARTY_CONFIGS_DIR/party1.toml --out $WORK_DIR/proof.1.proof &
co-noir generate-proof --proving-key $WORK_DIR/proving_key.2 --protocol REP3 --hasher KECCAK --config $PARTY_CONFIGS_DIR/party2.toml --out $WORK_DIR/proof.2.proof
wait $(jobs -p)
timeEnd "mpc-generate-proof"
