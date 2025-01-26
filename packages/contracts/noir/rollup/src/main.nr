use protocol_types::{
    abis::{
        append_only_tree_snapshot::AppendOnlyTreeSnapshot,
        nullifier_leaf_preimage::NullifierLeafPreimage,
    },
    merkle_tree,
};

fn main(
    // note hashes
    new_note_hashes: pub [Field; common::MAX_NOTES_PER_ROLLUP],
    note_hash_subtree_sibling_path: [Field; common::NOTE_HASH_SUBTREE_SIBLING_PATH_LENGTH],
    note_hash_tree: pub AppendOnlyTreeSnapshot,
    expected_new_note_hash_tree: pub AppendOnlyTreeSnapshot,
    // nullifiers
    new_nullifiers: pub [Field; common::MAX_NULLIFIERS_PER_ROLLUP],
    sorted_nullifiers: [Field; common::MAX_NULLIFIERS_PER_ROLLUP],
    sorted_nullifiers_indexes: [u32; common::MAX_NULLIFIERS_PER_ROLLUP],
    nullifier_subtree_sibling_path: [Field; common::NULLIFIER_SUBTREE_SIBLING_PATH_LENGTH],
    nullifier_low_leaf_preimages: [NullifierLeafPreimage; common::MAX_NOTES_PER_ROLLUP],
    nullifier_low_leaf_membership_witnesses: [merkle_tree::MembershipWitness<common::NULLIFIER_TREE_HEIGHT>; common::MAX_NOTES_PER_ROLLUP],
    nullifier_tree: pub AppendOnlyTreeSnapshot,
    expected_new_nullifier_tree: pub AppendOnlyTreeSnapshot,
) {
    let new_note_hash_tree = compute_new_note_hash_tree_snapshot::<common::MAX_NOTES_PER_ROLLUP, common::NOTE_HASH_SUBTREE_HEIGHT, common::NOTE_HASH_SUBTREE_SIBLING_PATH_LENGTH>(
        note_hash_tree,
        new_note_hashes,
        note_hash_subtree_sibling_path,
    );
    assert(new_note_hash_tree == expected_new_note_hash_tree, "Invalid new note hash tree");

    let new_nullifier_tree = compute_new_nullifier_tree_snapshot(
        nullifier_tree,
        new_nullifiers,
        sorted_nullifiers,
        sorted_nullifiers_indexes,
        nullifier_subtree_sibling_path,
        nullifier_low_leaf_preimages,
        nullifier_low_leaf_membership_witnesses,
    );
    assert(new_nullifier_tree == expected_new_nullifier_tree, "Invalid new nullifier tree");
}

fn compute_new_note_hash_tree_snapshot<let LEAVES_LENGTH: u32, let SUBTREE_HEIGHT: u32, let SUBTREE_SIBLING_PATH_LENGTH: u32>(
    tree: AppendOnlyTreeSnapshot,
    new_leaves: [Field; LEAVES_LENGTH],
    subtree_sibling_path: [Field; SUBTREE_SIBLING_PATH_LENGTH],
) -> AppendOnlyTreeSnapshot {
    assert(LEAVES_LENGTH == 1 << SUBTREE_HEIGHT as u8, "Invalid subtree height");
    let empty_commitments_subtree_root = merkle_tree::calculate_empty_tree_root(SUBTREE_HEIGHT);
    let commitments_tree_subroot = merkle_tree::calculate_subtree_root(new_leaves);

    // TODO(security): is there a need to check if note hashes are not in the tree before inserting?
    merkle_tree::append_only_tree::insert_subtree_to_snapshot_tree(
        tree,
        subtree_sibling_path,
        empty_commitments_subtree_root,
        commitments_tree_subroot,
        SUBTREE_HEIGHT as u8,
    )
}

fn compute_new_nullifier_tree_snapshot(
    tree: AppendOnlyTreeSnapshot,
    new_nullifiers: [Field; common::MAX_NULLIFIERS_PER_ROLLUP],
    sorted_nullifiers: [Field; common::MAX_NULLIFIERS_PER_ROLLUP],
    sorted_nullifiers_indexes: [u32; common::MAX_NULLIFIERS_PER_ROLLUP],
    subtree_sibling_path: [Field; common::NULLIFIER_SUBTREE_SIBLING_PATH_LENGTH],
    nullifier_low_leaf_preimages: [NullifierLeafPreimage; common::MAX_NOTES_PER_ROLLUP],
    nullifier_low_leaf_membership_witnesses: [merkle_tree::MembershipWitness<common::NULLIFIER_TREE_HEIGHT>; common::MAX_NOTES_PER_ROLLUP],
) -> AppendOnlyTreeSnapshot {
    merkle_tree::indexed_tree::batch_insert::<_, _, _, _, common::NULLIFIER_SUBTREE_HEIGHT, common::NULLIFIER_TREE_HEIGHT>(
        tree,
        new_nullifiers,
        sorted_nullifiers,
        sorted_nullifiers_indexes,
        subtree_sibling_path,
        nullifier_low_leaf_preimages,
        nullifier_low_leaf_membership_witnesses,
    )
}
