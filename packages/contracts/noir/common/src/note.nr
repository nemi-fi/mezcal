pub trait Note {
    fn hash(self) -> Field;

    pub fn emit(self, context: &mut crate::Context) {
        context.push_note_hash(self.hash());
    }
}
