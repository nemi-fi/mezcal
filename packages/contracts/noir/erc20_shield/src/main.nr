fn main(
    tree_roots: pub common::TreeRoots,
    owner: common::WaAddress,
    amount: pub common::TokenAmount,
    randomness: Field,
) -> pub common::Result<1, 0> {
    let mut context = common::Context::from(tree_roots);

    erc20::Token::mint(&mut context, owner, amount, randomness);

    context.finish()
}
