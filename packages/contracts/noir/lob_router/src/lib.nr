mod LobRouter {
    pub fn swap(
        context: &mut common::Context,
        seller_secret_key: Field,
        seller_note: erc20::Erc20NoteConsumptionInputs,
        seller_amount: common::TokenAmount,
        seller_randomness: Field,
        buyer_secret_key: Field,
        buyer_note: erc20::Erc20NoteConsumptionInputs,
        buyer_amount: common::TokenAmount,
        buyer_randomness: Field,
    ) {
        // TODO(security): orders must be signed by parties and the prices should match
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
