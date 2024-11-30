struct Result {
    nullifier: Field,
    change_note_hash: Field,
}

fn main(
    // trees
    note_hash_tree_root: pub Field,
    nullifier_tree_root: pub Field,
    // from
    from_secret_key: Field,
    from_note_inputs: common::NoteConsumptionInputs,
    // to params
    token: pub common::EthAddress,
    to: pub common::EthAddress,
    amount: pub u64,
    // change
    change_randomness: Field,
) -> pub Result {
    assert_eq(token, from_note_inputs.note.token, "invalid token");

    let nullifier = common::consume_owned_note(
        note_hash_tree_root,
        nullifier_tree_root,
        from_secret_key,
        from_note_inputs,
    );

    let change_note = common::ValueNote {
        owner: from_note_inputs.note.owner,
        token: from_note_inputs.note.token,
        value: from_note_inputs.note.value - amount,
        randomness: change_randomness,
    };

    Result { nullifier, change_note_hash: change_note.hash() }
}
