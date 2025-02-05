#!/usr/bin/env bash

set -euo pipefail

source timer.sh

nargo compile --silence-warnings
echo "Compiled"

CIRCUIT_NAME=erc20_transfer
CIRCUIT=target/$CIRCUIT_NAME.json

# merge Prover1.toml and Prover2.toml into Prover.toml
# Convert TOML to JSON
dasel -f "$CIRCUIT_NAME/Prover1.toml" -r toml -w json > prover1.json
dasel -f "$CIRCUIT_NAME/Prover2.toml" -r toml -w json > prover2.json
# Merge JSON with jq
jq -s '.[0] * .[1]' prover1.json prover2.json > merged.json
# Convert back to TOML
dasel -f merged.json -r json -w toml > "$CIRCUIT_NAME/Prover.toml"
rm prover1.json prover2.json merged.json

# split input into shares
co-noir split-input --circuit $CIRCUIT --input $CIRCUIT_NAME/Prover1.toml --protocol REP3 --out-dir target
co-noir split-input --circuit $CIRCUIT --input $CIRCUIT_NAME/Prover2.toml --protocol REP3 --out-dir target
echo "Inputs split"

# merge inputs into single input file
timeStart "merge-input-shares"
co-noir merge-input-shares --inputs target/Prover1.toml.0.shared --inputs target/Prover2.toml.0.shared --protocol REP3 --out target/Prover.toml.0.shared
co-noir merge-input-shares --inputs target/Prover1.toml.1.shared --inputs target/Prover2.toml.1.shared --protocol REP3 --out target/Prover.toml.1.shared
co-noir merge-input-shares --inputs target/Prover1.toml.2.shared --inputs target/Prover2.toml.2.shared --protocol REP3 --out target/Prover.toml.2.shared
timeEnd "merge-input-shares"

# run witness extension in MPC
timeStart "mpc-generate-witness"
co-noir generate-witness --input target/Prover.toml.0.shared --circuit $CIRCUIT --protocol REP3 --config configs/party0.toml --out target/witness.gz.0.shared &
co-noir generate-witness --input target/Prover.toml.1.shared --circuit $CIRCUIT --protocol REP3 --config configs/party1.toml --out target/witness.gz.1.shared &
co-noir generate-witness --input target/Prover.toml.2.shared --circuit $CIRCUIT --protocol REP3 --config configs/party2.toml --out target/witness.gz.2.shared
wait $(jobs -p)
timeEnd "mpc-generate-witness"

# run proving in MPC
timeStart "mpc-build-proving-key"
co-noir build-proving-key --witness target/witness.gz.0.shared --circuit $CIRCUIT --crs bn254_g1.dat --protocol REP3 --config configs/party0.toml --out target/proving_key.0 &
co-noir build-proving-key --witness target/witness.gz.1.shared --circuit $CIRCUIT --crs bn254_g1.dat --protocol REP3 --config configs/party1.toml --out target/proving_key.1 &
co-noir build-proving-key --witness target/witness.gz.2.shared --circuit $CIRCUIT --crs bn254_g1.dat --protocol REP3 --config configs/party2.toml --out target/proving_key.2
wait $(jobs -p)
timeEnd "mpc-build-proving-key"

timeStart "mpc-generate-proof"
co-noir generate-proof --proving-key target/proving_key.0 --protocol REP3 --hasher KECCAK --config configs/party0.toml --out target/proof.0.proof --public-input target/public_input.json &
co-noir generate-proof --proving-key target/proving_key.1 --protocol REP3 --hasher KECCAK --config configs/party1.toml --out target/proof.1.proof &
co-noir generate-proof --proving-key target/proving_key.2 --protocol REP3 --hasher KECCAK --config configs/party2.toml --out target/proof.2.proof
wait $(jobs -p)
timeEnd "mpc-generate-proof"

timeStart "bb-generate-witness"
nargo execute --package $CIRCUIT_NAME --silence-warnings
timeEnd "bb-generate-witness"
timeStart "bb-generate-proof"
bb prove_ultra_keccak_honk -b $CIRCUIT -w target/$CIRCUIT_NAME.gz -o target/proof_bb.proof
timeEnd "bb-generate-proof"


# Create verification key
co-noir create-vk --circuit $CIRCUIT --crs bn254_g1.dat --hasher KECCAK --vk target/verification_key
echo "Verification key created"

# verify proof
co-noir verify --proof target/proof.0.proof --vk target/verification_key --hasher KECCAK --crs bn254_g2.dat
echo "Proof verified"

# check if verification keys are the same (yes/no)
cmp -s target/verification_key target/verification_key_bb && echo "Verification keys are the same" || echo "Verification keys are different"
cmp -s target/proof.0.proof target/proof_bb.proof && echo "Proofs are the same" || echo "Proofs are different"

# Double check with bb
bb write_vk_ultra_keccak_honk -b $CIRCUIT -o target/verification_key_bb
echo "Verification key created with bb"
echo "Verifying with bb"
bb verify_ultra_keccak_honk -p target/proof.0.proof -k target/verification_key_bb
echo "Proof verified with bb"

# Check the bb proof
bb verify_ultra_keccak_honk -p target/proof_bb.proof -k target/verification_key_bb
