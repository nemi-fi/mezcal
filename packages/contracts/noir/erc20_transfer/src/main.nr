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

    erc20::Token::transfer(
        &mut context,
        from_secret_key,
        from_note_inputs,
        to,
        amount,
        to_randomness,
        change_randomness,
    );

    context.finish()
}
