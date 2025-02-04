pub use common::{Erc20Note, Erc20NoteConsumptionInputs};

pub mod Token {
    pub fn mint(
        context: &mut common::Context,
        to: common::WaAddress,
        amount: common::TokenAmount,
        randomness: Field,
    ) {
        common::Erc20Note { owner: to, amount, randomness }.emit(context);
    }

    pub fn burn(
        context: &mut common::Context,
        from_secret_key: Field,
        from_note_inputs: common::Erc20NoteConsumptionInputs,
        amount: common::TokenAmount,
        change_randomness: Field,
    ) {
        common::Erc20Note::consume_and_sub(
            context,
            from_note_inputs,
            amount,
            change_randomness,
            from_secret_key,
        );
    }

    pub fn join<let N: u32>(
        context: &mut common::Context,
        from_secret_key: Field,
        notes: [common::Erc20NoteConsumptionInputs; N],
        to: common::WaAddress,
        join_randomness: Field,
    ) {
        for note in notes {
            note.consume(context, from_secret_key);
        }

        let mut joined_amount = common::TokenAmount::zero(notes[0].note.amount.token);
        for i in 0..N {
            assert(notes[i].note.is_set(), "invalid note");
            joined_amount += notes[i].note.amount;
        }

        common::Erc20Note { owner: to, amount: joined_amount, randomness: join_randomness }.emit(
            context,
        );
    }

    pub fn transfer(
        context: &mut common::Context,
        from_secret_key: Field,
        from_note_inputs: common::Erc20NoteConsumptionInputs,
        to: common::WaAddress,
        amount: common::U256,
        to_randomness: Field,
        change_randomness: Field,
    ) {
        common::Erc20Note::consume_and_sub(
            context,
            from_note_inputs,
            common::TokenAmount { token: from_note_inputs.note.amount.token, amount },
            change_randomness,
            from_secret_key,
        );
        common::Erc20Note {
            owner: to,
            amount: common::TokenAmount { token: from_note_inputs.note.amount.token, amount },
            randomness: to_randomness,
        }
            .emit(context);
    }
}
