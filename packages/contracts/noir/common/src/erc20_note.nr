// fails to compile if this file is moved to erc20 crate

pub struct Erc20Note {
    pub owner: crate::WaAddress,
    pub amount: crate::TokenAmount,
    pub randomness: Field,
}

impl Erc20Note {
    // TODO(security): remove this in favour of BoundedVec<Erc20Note, MAX_LEN>
    pub fn is_set(self) -> bool {
        (self.owner != crate::WaAddress::zero()) & (self.amount.amount != crate::U256::new())
    }

    pub fn consume_and_sub<let N: u32>(
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

impl crate::Serialize<6> for Erc20Note {
    fn serialize(self) -> [Field; 6] {
        self
            .owner
            .serialize()
            .concat(self.amount.token.serialize())
            .concat(self.amount.amount.limbs)
            .concat([self.randomness])
    }
}

impl crate::Note for Erc20Note {
    fn hash(self) -> Field {
        let serialized = self.serialize();
        // TODO(security): use poseidon2_hash_with_separator
        std::hash::poseidon2::Poseidon2::hash(serialized, serialized.len())
    }
}

impl crate::OwnedNote for Erc20Note {
    fn owner(self) -> crate::WaAddress {
        self.owner
    }
}

pub type Erc20NoteConsumptionInputs = crate::NoteConsumptionInputs<Erc20Note>;
