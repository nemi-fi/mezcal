// fails to compile if this file is moved to erc20 crate

use super::note::Note;
use protocol_types::traits::Serialize;

pub struct Erc20Note {
    pub owner: crate::WaAddress,
    pub amount: crate::TokenAmount,
    pub randomness: Field,
}

impl crate::Note for Erc20Note {}

impl Erc20Note {
    pub fn sub_and_emit_change<let N: u32>(
        context: &mut crate::Context,
        notes: [Erc20NoteConsumptionInputs; N],
        amount: crate::TokenAmount,
        change_randomness: Field,
        secret_key: Field,
    ) {
        let mut subtracted = crate::TokenAmount::zero(amount.token);
        for note in notes {
            note.consume(context, secret_key);
            subtracted += note.note.amount;
        }
        Self {
            owner: crate::WaAddress::from_secret_key(secret_key),
            amount: subtracted - amount,
            randomness: change_randomness,
        }
            .emit(context);
    }
}

impl crate::Serialize<4> for Erc20Note {
    fn serialize(self) -> [Field; 4] {
        self
            .owner
            .serialize()
            .concat(self.amount.token.serialize())
            .concat([self.amount.amount.to_integer()])
            .concat([self.randomness])
    }
}

impl crate::OwnedNote for Erc20Note {
    fn owner(self) -> crate::WaAddress {
        self.owner
    }
}

pub type Erc20NoteConsumptionInputs = crate::NoteConsumptionInputs<Erc20Note>;
