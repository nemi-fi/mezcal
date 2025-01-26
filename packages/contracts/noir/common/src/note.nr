pub trait Note<let N: u32> {
    fn serialize(self) -> [Field; N];

    fn inner_hash(self) -> Field;

    fn siloed_hash(self, context: crate::Context) -> Field {
        crate::NoteHashToSilo {
            silo_contract_address: context.this_address(),
            inner_note_hash: self.inner_hash(),
        }
            .siloed()
    }
}
