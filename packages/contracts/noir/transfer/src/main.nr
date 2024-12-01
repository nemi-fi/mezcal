use common::ValueNote;

struct Result {
    nullifier: Field,
    change_note_hash: Field,
    to_note_hash: Field,
}

fn main(
    tree_roots: pub common::TreeRoots,
    // from
    from_secret_key: Field,
    from_note_inputs: common::NoteConsumptionInputs,
    // transfer params
    to: Field,
    amount: u64,
    to_randomness: Field,
    // change
    change_randomness: Field,
) -> pub Result {
    let (nullifier, change_note) = common::ValueNote::consume_and_sub(
        from_note_inputs,
        common::TokenAmount { token: from_note_inputs.note.token, amount: amount },
        change_randomness,
        tree_roots,
        from_secret_key,
    );
    let to_note = ValueNote {
        owner: to,
        token: from_note_inputs.note.token,
        value: amount,
        randomness: to_randomness,
    };

    Result { nullifier, change_note_hash: change_note.hash(), to_note_hash: to_note.hash() }
}
