struct Result {
    note_hashes_in: [Field; common::MAX_TOKENS_IN_PER_EXECUTION],
    change_note_hashes: [Field; common::MAX_TOKENS_OUT_PER_EXECUTION],
    nullifiers_out: [Field; common::MAX_TOKENS_OUT_PER_EXECUTION],
}

fn main(
    tree_roots: pub common::TreeRoots,
    // accounts
    from_secret_key: Field,
    to_address: Field,
    // execution
    execution_hash: pub Field,
    execution_secret: Field,
    wrapped_execution_hash: pub Field,
    // amounts & notes
    amounts_in: pub [common::TokenAmount; common::MAX_TOKENS_IN_PER_EXECUTION],
    to_randomness: [Field; common::MAX_TOKENS_IN_PER_EXECUTION],
    amounts_out: pub [common::TokenAmount; common::MAX_TOKENS_OUT_PER_EXECUTION],
    notes_out: [common::NoteConsumptionInputs; common::MAX_TOKENS_OUT_PER_EXECUTION],
    change_randomness: [Field; common::MAX_TOKENS_OUT_PER_EXECUTION],
) -> pub Result {
    let inputs = [execution_hash, execution_secret];
    assert_eq(
        std::hash::poseidon2::Poseidon2::hash(inputs, inputs.len()),
        wrapped_execution_hash,
        "invalid wrapped execution hash",
    );

    // check amounts out and emit change note hashes & nullifiers
    let (change_note_hashes, nullifiers_out) = {
        let change_and_nullifiers_out = notes_out.enumerate().map(
            |(i, note_input): (u32, common::NoteConsumptionInputs)| {
                let amount_out = amounts_out[i];
                if (note_input.note.is_set()) {
                    let (nullifier, change_note) = common::ValueNote::consume_and_sub(
                        note_input,
                        amount_out,
                        change_randomness[i],
                        tree_roots,
                        from_secret_key,
                    );
                    (change_note.hash(), nullifier)
                } else {
                    assert_eq(amount_out.amount, 0, f"invalid amount at {i}");
                    (0, 0)
                }
            },
        );
        let change_note_hashes =
            change_and_nullifiers_out.map(|(note_hash, _): (Field, Field)| note_hash);
        let nullifiers_out =
            change_and_nullifiers_out.map(|(_, nullifier): (Field, Field)| nullifier);
        (change_note_hashes, nullifiers_out)
    };

    // emit new note hashes
    let note_hashes_in = amounts_in.enumerate().map(|(i, amount): (u32, common::TokenAmount)| {
        if (amount.amount != 0) {
            common::ValueNote {
                owner: to_address,
                token: amount.token,
                value: amount.amount,
                randomness: to_randomness[i],
            }
                .hash()
        } else {
            0
        }
    });

    Result { note_hashes_in, change_note_hashes, nullifiers_out }
}
