mod LobRouter {
    use common::OwnedNote;

    pub fn swap(
        context: &mut common::Context,
        seller_secret_key: Field,
        seller_note: erc20::Erc20NoteConsumptionInputs,
        seller_order: crate::Order,
        seller_randomness: Field,
        buyer_secret_key: Field,
        buyer_note: erc20::Erc20NoteConsumptionInputs,
        buyer_order: crate::Order,
        buyer_randomness: Field,
    ) {
        // TODO(security): orders must be signed by parties

        assert(
            seller_order.sell_amount == buyer_order.buy_amount,
            "seller order amount does not match buyer order amount",
        );
        assert(
            seller_order.buy_amount == buyer_order.sell_amount,
            "buyer order amount does not match seller order amount",
        );
        let seller_amount = seller_order.sell_amount;
        let buyer_amount = seller_order.buy_amount;
        assert(seller_amount.token == seller_note.note.amount.token, "invalid seller note token");
        assert(buyer_amount.token == buyer_note.note.amount.token, "invalid buyer note token");

        erc20::Token::transfer(
            context,
            seller_secret_key,
            seller_note,
            buyer_note.note.owner(),
            seller_amount,
            buyer_randomness,
            seller_randomness,
        );

        erc20::Token::transfer(
            context,
            buyer_secret_key,
            buyer_note,
            seller_note.note.owner(),
            buyer_amount,
            seller_randomness,
            buyer_randomness,
        );
    }
}

pub struct Order {
    pub sell_amount: common::TokenAmount,
    pub buy_amount: common::TokenAmount,
    /// Hide order contents from other parties and outside world
    // TODO(perf): not sure if this is needed because orders are secret shared in an MPC network
    pub randomness: Field,
}
