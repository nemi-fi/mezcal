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
    amount: common::U256,
    to_randomness: Field,
    // change
    change_randomness: Field,
) -> pub Result {
    let (nullifier, change_note) = common::Erc20Note::consume_and_sub(
        from_note_inputs,
        common::TokenAmount { token: from_note_inputs.note.amount.token, amount },
        change_randomness,
        tree_roots,
        from_secret_key,
    );
    let to_note = common::Erc20Note {
        owner: to,
        amount: common::TokenAmount { token: from_note_inputs.note.amount.token, amount },
        randomness: to_randomness,
    };

    Result { nullifier, change_note_hash: change_note.hash(), to_note_hash: to_note.hash() }
}
