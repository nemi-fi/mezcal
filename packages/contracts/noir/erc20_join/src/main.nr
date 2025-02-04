// Note: keep in sync with other languages
global MAX_NOTES_TO_JOIN: u32 = 2;

fn main(
    tree_roots: pub common::TreeRoots,
    // params
    from_secret_key: Field,
    notes: [common::Erc20NoteConsumptionInputs; MAX_NOTES_TO_JOIN],
    to: common::WaAddress,
    join_randomness: Field,
) -> pub common::Result<1, MAX_NOTES_TO_JOIN> {
    let mut context = common::Context::from(tree_roots);

    erc20::Token::join(&mut context, from_secret_key, notes, to, join_randomness);

    context.finish()
}
