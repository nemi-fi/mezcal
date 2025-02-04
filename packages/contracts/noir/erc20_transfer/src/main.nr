fn main(
    tree_roots: pub common::TreeRoots,
    // from
    from_secret_key: Field,
    from_note_inputs: common::NoteConsumptionInputs,
    // transfer params
    to: common::WaAddress,
    amount: common::U256,
    to_randomness: Field,
    // change
    change_randomness: Field,
) -> pub common::Result<2, 1> {
    let mut context = common::Context::from(tree_roots);

    common::Erc20Note::consume_and_sub(
        &mut context,
        from_note_inputs,
        common::TokenAmount { token: from_note_inputs.note.amount.token, amount },
        change_randomness,
        from_secret_key,
    );
    let to_note = common::Erc20Note {
        owner: to,
        amount: common::TokenAmount { token: from_note_inputs.note.amount.token, amount },
        randomness: to_randomness,
    };
    context.push_note_hash(to_note.hash());

    context.finish()
}
