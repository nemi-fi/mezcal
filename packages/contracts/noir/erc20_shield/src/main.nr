fn main(
    tree_roots: pub common::TreeRoots,
    owner: common::WaAddress,
    amount: pub common::TokenAmount,
    randomness: Field,
) -> pub common::Result<1, 0> {
    let mut context = common::Context::from(tree_roots);

    let note = common::Erc20Note { owner, amount, randomness };
    context.push_note_hash(note.hash());

    context.finish()
}
