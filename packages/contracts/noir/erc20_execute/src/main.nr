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
    ) -> pub common::Result<common::MAX_TOKENS_IN_PER_EXECUTION + common::MAX_TOKENS_OUT_PER_EXECUTION, common::MAX_TOKENS_OUT_PER_EXECUTION> {
    let mut context = common::Context::from(tree_roots);

    let inputs = [execution_hash, execution_secret];
    assert_eq(
        std::hash::poseidon2::Poseidon2::hash(inputs, inputs.len()),
        wrapped_execution_hash,
        "invalid wrapped execution hash",
    );

    // check amounts out and emit change note hashes & nullifiers
    for x in notes_out.enumerate() {
        let (i, note_input) = x;
        common::Erc20Note::consume_and_sub_or_ignore_if_empty(
            &mut context,
            note_input,
            amounts_out[i],
            change_randomness[i],
            from_secret_key,
        );
    }

    // emit new note hashes
    for x in amounts_in.enumerate() {
        let (i, amount) = x;
        let note_hash = if amount.amount != common::U256::new() {
            common::Erc20Note { owner: to_address, amount, randomness: to_randomness[i] }.hash()
        } else {
            0
        };
        context.push_note_hash(note_hash)
    }

    context.finish()
}
