fn main(
    tree_roots: pub common::TreeRoots,
    // from
    from_secret_key: Field,
    from_note_inputs: erc20::Erc20NoteConsumptionInputs,
    // to params
    // TODO(security): check if specifying a different to in the EVM contract will bypass the proof
    to: pub common::EthAddress,
    amount: pub common::TokenAmount,
    // change
    change_randomness: Field,
) -> pub common::Result<1, 1> {
    let mut context = common::Context::from(tree_roots);

    erc20::Token::burn(
        &mut context,
        from_secret_key,
        from_note_inputs,
        amount,
        change_randomness,
    );

    context.finish()
}
