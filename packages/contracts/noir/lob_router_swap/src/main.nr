fn main(
    tree_roots: pub common::TreeRoots,
    // seller
    seller_secret_key: Field,
    seller_note: erc20::Erc20NoteConsumptionInputs,
    seller_order: lob_router::Order,
    seller_randomness: Field,
    // buyer
    buyer_secret_key: Field,
    buyer_note: erc20::Erc20NoteConsumptionInputs,
    buyer_order: lob_router::Order,
    buyer_randomness: Field,
) -> pub common::Result<4, 2> {
    let mut context = common::Context::from(tree_roots);

    lob_router::LobRouter::swap(
        &mut context,
        seller_secret_key,
        seller_note,
        seller_order,
        seller_randomness,
        buyer_secret_key,
        buyer_note,
        buyer_order,
        buyer_randomness,
    );

    context.finish()
}
