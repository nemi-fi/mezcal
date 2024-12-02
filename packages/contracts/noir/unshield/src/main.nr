struct Result {
    nullifier: Field,
    change_note_hash: Field,
}

fn main(
    tree_roots: pub common::TreeRoots,
    // from
    from_secret_key: Field,
    from_note_inputs: common::NoteConsumptionInputs,
    // to params
    // TODO(security): check if specifying a different to in the EVM contract will bypass the proof
    to: pub common::EthAddress,
    amount: pub common::TokenAmount,
    // change
    change_randomness: Field,
) -> pub Result {
    let (nullifier, change_note) = common::Erc20Note::consume_and_sub(
        from_note_inputs,
        amount,
        change_randomness,
        tree_roots,
        from_secret_key,
    );

    Result { nullifier, change_note_hash: change_note.hash() }
}
