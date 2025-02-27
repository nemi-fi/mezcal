pub use common::erc20_note::{Erc20Note, Erc20NoteConsumptionInputs};

pub mod Token {
    use common::Note;

    pub fn mint(
        context: &mut common::Context,
        to: common::WaAddress,
        amount: common::TokenAmount,
        randomness: Field,
    ) {
        crate::Erc20Note { owner: to, amount, randomness }.emit(context);
    }

    pub fn burn(
        context: &mut common::Context,
        from_secret_key: Field,
        from_note_inputs: crate::Erc20NoteConsumptionInputs,
        amount: common::TokenAmount,
        change_randomness: Field,
    ) {
        crate::Erc20Note::sub_and_emit_change(
            context,
            [from_note_inputs],
            amount,
            change_randomness,
            from_secret_key,
        );
    }

    pub fn join<let N: u32>(
        context: &mut common::Context,
        from_secret_key: Field,
        notes: [crate::Erc20NoteConsumptionInputs; N],
        to: common::WaAddress,
        join_randomness: Field,
    ) {
        for note in notes {
            note.consume(context, from_secret_key);
        }

        let mut joined_amount = common::TokenAmount::zero(notes[0].note.amount.token);
        for i in 0..N {
            joined_amount += notes[i].note.amount;
        }

        crate::Erc20Note { owner: to, amount: joined_amount, randomness: join_randomness }.emit(
            context,
        );
    }

    pub fn transfer(
        context: &mut common::Context,
        from_secret_key: Field,
        from_note_inputs: crate::Erc20NoteConsumptionInputs,
        to: common::WaAddress,
        amount: common::TokenAmount,
        to_randomness: Field,
        change_randomness: Field,
    ) {
        crate::Erc20Note::sub_and_emit_change(
            context,
            [from_note_inputs],
            amount,
            change_randomness,
            from_secret_key,
        );
        crate::Erc20Note { owner: to, amount, randomness: to_randomness }.emit(context);
    }
}
