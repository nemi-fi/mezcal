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

    pub fn consume_and_sub_or_ignore_if_empty(
        context: &mut crate::Context,
        note_consumption: crate::NoteConsumptionInputs,
        amount: crate::TokenAmount,
        randomness: Field,
        secret_key: Field,
    ) {
        if note_consumption.note.is_set() {
            Self::consume_and_sub(context, note_consumption, amount, randomness, secret_key);
        } else {
            assert_eq(
                amount,
                crate::TokenAmount { token: crate::EthAddress::zero(), amount: crate::U256::new() },
                f"tried to consume an empty note using amount {amount}",
            );
            context.push_nullifier(0);
            context.push_note_hash(0);
        }
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
