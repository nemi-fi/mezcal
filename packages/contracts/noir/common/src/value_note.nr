pub struct Erc20Note {
    pub owner: crate::WaAddress,
    pub amount: crate::TokenAmount,
    pub randomness: Field,
}

impl Erc20Note {
    // TODO(security): remove this in favour of BoundedVec<Erc20Note, MAX_LEN>
    pub fn is_set(self) -> bool {
        (self.owner != 0) & (self.amount.amount != crate::U256::new())
    }

    pub fn consume_and_sub(
        context: &mut crate::Context,
        note_consumption: crate::NoteConsumptionInputs,
        amount: crate::TokenAmount,
        randomness: Field,
        secret_key: Field,
    ) {
        note_consumption.consume(context, secret_key);
        let change_note = Self {
            owner: note_consumption.note.owner,
            amount: note_consumption.note.amount - amount,
            randomness,
        };
        context.push_note_hash(change_note.hash());
    }
}

impl crate::Serialize<6> for Erc20Note {
    fn serialize(self) -> [Field; 6] {
        [self.owner, self.amount.token].concat(self.amount.amount.limbs).concat([self.randomness])
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
