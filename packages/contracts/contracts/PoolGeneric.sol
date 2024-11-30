// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity ^0.8.23;

import {HeaderLib} from "@aztec/l1-contracts/src/core/libraries/HeaderLib.sol";
import {Fr, FrLib} from "./Fr.sol";
import {NoteInput, PublicInputs} from "./Utils.sol";
import {UltraVerifier as RollupVerifier} from "../noir/target/rollup.sol";

// Note: keep in sync with other languages
uint32 constant MAX_NOTES_PER_ROLLUP = 64;
// Note: keep in sync with other languages
uint32 constant MAX_NULLIFIERS_PER_ROLLUP = 64;

// Note: keep in sync with other languages
uint256 constant NOTE_HASH_OR_NULLIFIER_STATE_NOT_EXISTS = 0;
// Note: keep in sync with other languages
uint256 constant NOTE_HASH_OR_NULLIFIER_STATE_PENDING = 1;
// Note: keep in sync with other languages
uint256 constant NOTE_HASH_OR_NULLIFIER_STATE_ROLLED_UP = 2;

struct PendingTx {
    bool rolledUp;
    Fr[] noteHashes;
    Fr[] nullifiers;
}

contract PoolGeneric {
    using FrLib for Fr;
    using PublicInputs for PublicInputs.Type;

    error TxAlreadyRolledUp(uint256 txIndex);

    RollupVerifier public immutable rollupVerifier;

    PendingTx[] allPendingTxs;

    // TODO(perf): emit only the ciphertext
    event EncryptedNotes(NoteInput[] encryptedNotes);

    // TODO(perf): use dynamic array to save on gas costs
    event NoteHashes(
        uint256 indexed index,
        Fr[MAX_NOTES_PER_ROLLUP] noteHashes
    );
    error NoteHashExists(Fr noteHash);
    mapping(Fr => uint256) public noteHashState; // TODO: nuke this
    HeaderLib.AppendOnlyTreeSnapshot noteHashTree;
    uint256 noteHashBatchIndex;

    // TODO(perf): use dynamic array to save on gas costs
    event Nullifiers(
        uint256 indexed index,
        Fr[MAX_NULLIFIERS_PER_ROLLUP] nullifiers
    );
    error NullifierExists(Fr nullifier);
    mapping(Fr => uint256) public nullifierState; // TODO: nuke this
    HeaderLib.AppendOnlyTreeSnapshot nullifierTree;
    uint256 nullifierBatchIndex;

    constructor(RollupVerifier rollupVerifier_) {
        rollupVerifier = rollupVerifier_;

        noteHashTree
            .root = 0x1fd848aa69e1633722fe249a5b7f53b094f1c9cef9f5c694b073fd1cc5850dfb; // empty tree
        nullifierTree
            .root = 0x0aa63c509390ad66ecd821998aabb16a818bcc5db5cf4accc0ce1821745244e9; // nullifier tree filled with 1 canonical subtree of nullifiers
        nullifierTree.nextAvailableLeafIndex = MAX_NULLIFIERS_PER_ROLLUP;
    }

    function rollup(
        bytes calldata proof,
        uint256[] calldata txIndices,
        HeaderLib.AppendOnlyTreeSnapshot calldata newNoteHashTree,
        HeaderLib.AppendOnlyTreeSnapshot calldata newNullifierTree
    ) external {
        Fr[MAX_NOTES_PER_ROLLUP] memory pendingNoteHashes;
        Fr[MAX_NULLIFIERS_PER_ROLLUP] memory pendingNullifiers;
        {
            uint256 noteHashesIdx = 0;
            uint256 nullifiersIdx = 0;
            for (uint256 i = 0; i < txIndices.length; i++) {
                PendingTx memory pendingTx = allPendingTxs[txIndices[i]];
                for (uint256 j = 0; j < pendingTx.noteHashes.length; j++) {
                    pendingNoteHashes[noteHashesIdx++] = pendingTx.noteHashes[
                        j
                    ];
                }
                for (uint256 j = 0; j < pendingTx.nullifiers.length; j++) {
                    pendingNullifiers[nullifiersIdx++] = pendingTx.nullifiers[
                        j
                    ];
                }
            }
        }

        PublicInputs.Type memory pi = PublicInputs.create(
            (MAX_NOTES_PER_ROLLUP + 4) + (MAX_NULLIFIERS_PER_ROLLUP + 4)
        );
        // note hashes
        for (uint256 i = 0; i < pendingNoteHashes.length; i++) {
            pi.push(pendingNoteHashes[i].toBytes32());
        }
        pi.push(noteHashTree.root);
        pi.push(uint256(noteHashTree.nextAvailableLeafIndex));
        pi.push(newNoteHashTree.root);
        pi.push(uint256(newNoteHashTree.nextAvailableLeafIndex));

        // nullifiers
        for (uint256 i = 0; i < pendingNullifiers.length; i++) {
            pi.push(pendingNullifiers[i].toBytes32());
        }
        pi.push(nullifierTree.root);
        pi.push(uint256(nullifierTree.nextAvailableLeafIndex));
        pi.push(newNullifierTree.root);
        pi.push(uint256(newNullifierTree.nextAvailableLeafIndex));
        require(
            rollupVerifier.verify(proof, pi.finish()),
            "Invalid rollup proof"
        );

        // mark as rolled up
        for (uint256 i = 0; i < txIndices.length; i++) {
            uint256 txIndex = txIndices[i];
            require(
                !allPendingTxs[txIndex].rolledUp,
                TxAlreadyRolledUp(txIndex)
            );
            allPendingTxs[txIndex].rolledUp = true;
        }

        // state update
        emit NoteHashes(noteHashBatchIndex++, pendingNoteHashes);
        emit Nullifiers(nullifierBatchIndex++, pendingNullifiers);
        noteHashTree = newNoteHashTree;
        nullifierTree = newNullifierTree;
        // TODO: remove this disgusting gas waste
        for (uint256 i = 0; i < pendingNoteHashes.length; i++) {
            noteHashState[
                pendingNoteHashes[i]
            ] = NOTE_HASH_OR_NULLIFIER_STATE_ROLLED_UP;
        }
        // TODO: remove this disgusting gas waste
        for (uint256 i = 0; i < pendingNullifiers.length; i++) {
            nullifierState[
                pendingNullifiers[i]
            ] = NOTE_HASH_OR_NULLIFIER_STATE_ROLLED_UP;
        }
    }

    function _PoolGeneric_addPendingTx(
        NoteInput[] memory noteInputs,
        bytes32[] memory nullifiers
    ) internal {
        require(noteInputs.length <= MAX_NOTES_PER_ROLLUP, "too many notes");
        require(
            nullifiers.length <= MAX_NULLIFIERS_PER_ROLLUP,
            "too many nullifiers"
        );

        allPendingTxs.push();
        PendingTx storage pendingTx = allPendingTxs[allPendingTxs.length - 1];

        for (uint256 i = 0; i < noteInputs.length; i++) {
            Fr noteHash = FrLib.create(noteInputs[i].noteHash);
            require(
                noteHashState[noteHash] ==
                    NOTE_HASH_OR_NULLIFIER_STATE_NOT_EXISTS,
                NoteHashExists(noteHash)
            );
            noteHashState[noteHash] = NOTE_HASH_OR_NULLIFIER_STATE_PENDING;
            // TODO(perf): this is a waste of gas
            pendingTx.noteHashes.push(noteHash);
        }

        for (uint256 i = 0; i < nullifiers.length; i++) {
            Fr nullifier = FrLib.create(nullifiers[i]);
            require(
                nullifierState[nullifier] ==
                    NOTE_HASH_OR_NULLIFIER_STATE_NOT_EXISTS,
                NullifierExists(nullifier)
            );
            nullifierState[nullifier] = NOTE_HASH_OR_NULLIFIER_STATE_PENDING;
            // TODO(perf): this is a waste of gas
            pendingTx.nullifiers.push(nullifier);
        }

        emit EncryptedNotes(noteInputs);
    }

    function getAllPendingTxs() external view returns (PendingTx[] memory) {
        return allPendingTxs;
    }

    function getNoteHashTree()
        external
        view
        returns (HeaderLib.AppendOnlyTreeSnapshot memory)
    {
        return noteHashTree;
    }

    function getNullifierTree()
        external
        view
        returns (HeaderLib.AppendOnlyTreeSnapshot memory)
    {
        return nullifierTree;
    }
}
