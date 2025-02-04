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
) -> pub common::Result<1, 1> {
    let mut context = common::Context::from(tree_roots);

    common::Erc20Note::consume_and_sub(
        &mut context,
        from_note_inputs,
        amount,
        change_randomness,
        from_secret_key,
    );

    context.finish()
}
