// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity ^0.8.23;

import {Fr, FrLib} from "./Fr.sol";
import {NoteInput, PublicInputs, AppendOnlyTreeSnapshot, NoteHashToSilo, NullifierToSilo} from "./Utils.sol";
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
    address siloContractAddress;
    Fr[] innerNoteHashes;
    Fr[] innerNullifiers;
}

contract PoolGeneric {
    using FrLib for Fr;
    using PublicInputs for PublicInputs.Type;

    error TxAlreadyRolledUp(uint256 txIndex);

    struct PoolGenericStorage {
        RollupVerifier rollupVerifier;
        PendingTx[] allPendingTxs;
        AppendOnlyTreeSnapshot noteHashTree;
        mapping(address => mapping(Fr => uint256)) noteHashState; // TODO(perf): nuke this
        uint256 noteHashBatchIndex;
        AppendOnlyTreeSnapshot nullifierTree;
        mapping(address => mapping(Fr => uint256)) nullifierState; // TODO(perf): nuke this
        uint256 nullifierBatchIndex;
    }

    // TODO(perf): emit only the ciphertext
    event EncryptedNotes(NoteInput[] encryptedNotes);

    // TODO(perf): use dynamic array to save on gas costs
    event NoteHashes(
        uint256 indexed index,
        NoteHashToSilo[MAX_NOTES_PER_ROLLUP] noteHashes
    );
    error NoteHashExists(NoteHashToSilo noteHash);

    // TODO(perf): use dynamic array to save on gas costs
    event Nullifiers(
        uint256 indexed index,
        NullifierToSilo[MAX_NULLIFIERS_PER_ROLLUP] nullifiers
    );
    error NullifierExists(NullifierToSilo nullifier);

    constructor(RollupVerifier rollupVerifier_) {
        _poolGenericStorage().rollupVerifier = rollupVerifier_;

        _poolGenericStorage()
            .noteHashTree
            .root = 0x1fd848aa69e1633722fe249a5b7f53b094f1c9cef9f5c694b073fd1cc5850dfb; // empty tree

        // nullifier tree filled with 1 canonical subtree of nullifiers
        _poolGenericStorage().nullifierTree = AppendOnlyTreeSnapshot({
            root: 0x0aa63c509390ad66ecd821998aabb16a818bcc5db5cf4accc0ce1821745244e9,
            nextAvailableLeafIndex: MAX_NULLIFIERS_PER_ROLLUP
        });
    }

    function rollup(
        bytes calldata proof,
        uint256[] calldata txIndices,
        AppendOnlyTreeSnapshot calldata newNoteHashTree,
        AppendOnlyTreeSnapshot calldata newNullifierTree
    ) external {
        NoteHashToSilo[MAX_NOTES_PER_ROLLUP] memory pendingNoteHashes;
        NullifierToSilo[MAX_NULLIFIERS_PER_ROLLUP] memory pendingNullifiers;
        {
            uint256 noteHashesIdx = 0;
            uint256 nullifiersIdx = 0;
            for (uint256 i = 0; i < txIndices.length; i++) {
                PendingTx memory pendingTx = _poolGenericStorage()
                    .allPendingTxs[txIndices[i]];
                for (uint256 j = 0; j < pendingTx.innerNoteHashes.length; j++) {
                    pendingNoteHashes[noteHashesIdx++] = NoteHashToSilo({
                        siloContractAddress: pendingTx.siloContractAddress,
                        innerNoteHash: pendingTx.innerNoteHashes[j]
                    });
                }
                for (uint256 j = 0; j < pendingTx.innerNullifiers.length; j++) {
                    pendingNullifiers[nullifiersIdx++] = NullifierToSilo({
                        siloContractAddress: pendingTx.siloContractAddress,
                        innerNullifier: pendingTx.innerNullifiers[j]
                    });
                }
            }
        }

        PublicInputs.Type memory pi = PublicInputs.create(
            (MAX_NOTES_PER_ROLLUP + 4) + (MAX_NULLIFIERS_PER_ROLLUP + 4)
        );
        // note hashes
        for (uint256 i = 0; i < pendingNoteHashes.length; i++) {
            pi.push(pendingNoteHashes[i]);
        }
        pi.push(_poolGenericStorage().noteHashTree.root);
        pi.push(
            uint256(_poolGenericStorage().noteHashTree.nextAvailableLeafIndex)
        );
        pi.push(newNoteHashTree.root);
        pi.push(uint256(newNoteHashTree.nextAvailableLeafIndex));

        // nullifiers
        for (uint256 i = 0; i < pendingNullifiers.length; i++) {
            pi.push(pendingNullifiers[i]);
        }
        pi.push(_poolGenericStorage().nullifierTree.root);
        pi.push(
            uint256(_poolGenericStorage().nullifierTree.nextAvailableLeafIndex)
        );
        pi.push(newNullifierTree.root);
        pi.push(uint256(newNullifierTree.nextAvailableLeafIndex));
        require(
            _poolGenericStorage().rollupVerifier.verify(proof, pi.finish()),
            "Invalid rollup proof"
        );

        // mark as rolled up
        for (uint256 i = 0; i < txIndices.length; i++) {
            uint256 txIndex = txIndices[i];
            require(
                !_poolGenericStorage().allPendingTxs[txIndex].rolledUp,
                TxAlreadyRolledUp(txIndex)
            );
            _poolGenericStorage().allPendingTxs[txIndex].rolledUp = true;
        }

        // state update
        emit NoteHashes(
            _poolGenericStorage().noteHashBatchIndex++,
            pendingNoteHashes
        );
        emit Nullifiers(
            _poolGenericStorage().nullifierBatchIndex++,
            pendingNullifiers
        );
        _poolGenericStorage().noteHashTree = newNoteHashTree;
        _poolGenericStorage().nullifierTree = newNullifierTree;
        // TODO(perf): remove this disgusting gas waste
        for (uint256 i = 0; i < pendingNoteHashes.length; i++) {
            _poolGenericStorage().noteHashState[
                pendingNoteHashes[i].siloContractAddress
            ][
                    pendingNoteHashes[i].innerNoteHash
                ] = NOTE_HASH_OR_NULLIFIER_STATE_ROLLED_UP;
        }
        // TODO(perf): remove this disgusting gas waste
        for (uint256 i = 0; i < pendingNullifiers.length; i++) {
            _poolGenericStorage().nullifierState[
                pendingNullifiers[i].siloContractAddress
            ][
                    pendingNullifiers[i].innerNullifier
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

        _poolGenericStorage().allPendingTxs.push();
        PendingTx storage pendingTx = _poolGenericStorage().allPendingTxs[
            _poolGenericStorage().allPendingTxs.length - 1
        ];
        address siloContractAddress = msg.sender;
        pendingTx.siloContractAddress = siloContractAddress;

        for (uint256 i = 0; i < noteInputs.length; i++) {
            Fr innerNoteHash = FrLib.tryFrom(noteInputs[i].innerNoteHash);
            require(
                _poolGenericStorage().noteHashState[siloContractAddress][
                    innerNoteHash
                ] == NOTE_HASH_OR_NULLIFIER_STATE_NOT_EXISTS,
                NoteHashExists(
                    NoteHashToSilo({
                        siloContractAddress: siloContractAddress,
                        innerNoteHash: innerNoteHash
                    })
                )
            );
            _poolGenericStorage().noteHashState[siloContractAddress][
                    innerNoteHash
                ] = NOTE_HASH_OR_NULLIFIER_STATE_PENDING;
            // TODO(perf): this is a waste of gas
            pendingTx.innerNoteHashes.push(innerNoteHash);
        }

        for (uint256 i = 0; i < nullifiers.length; i++) {
            Fr innerNullifier = FrLib.tryFrom(nullifiers[i]);
            require(
                _poolGenericStorage().nullifierState[siloContractAddress][
                    innerNullifier
                ] == NOTE_HASH_OR_NULLIFIER_STATE_NOT_EXISTS,
                NullifierExists(
                    NullifierToSilo({
                        siloContractAddress: siloContractAddress,
                        innerNullifier: innerNullifier
                    })
                )
            );
            _poolGenericStorage().nullifierState[siloContractAddress][
                    innerNullifier
                ] = NOTE_HASH_OR_NULLIFIER_STATE_PENDING;
            // TODO(perf): this is a waste of gas
            pendingTx.innerNullifiers.push(innerNullifier);
        }

        emit EncryptedNotes(noteInputs);
    }

    function getAllPendingTxs() external view returns (PendingTx[] memory) {
        return _poolGenericStorage().allPendingTxs;
    }

    function getNoteHashTree()
        public
        view
        returns (AppendOnlyTreeSnapshot memory)
    {
        return _poolGenericStorage().noteHashTree;
    }

    function getNullifierTree()
        public
        view
        returns (AppendOnlyTreeSnapshot memory)
    {
        return _poolGenericStorage().nullifierTree;
    }

    function noteHashState(
        address siloContractAddress,
        bytes32 innerNoteHash
    ) external view returns (uint256) {
        return
            _poolGenericStorage().noteHashState[siloContractAddress][
                FrLib.tryFrom(innerNoteHash)
            ];
    }

    function nullifierState(
        address siloContractAddress,
        bytes32 innerNullifier
    ) external view returns (uint256) {
        return
            _poolGenericStorage().nullifierState[siloContractAddress][
                FrLib.tryFrom(innerNullifier)
            ];
    }

    function _poolGenericStorage()
        private
        pure
        returns (PoolGenericStorage storage s)
    {
        assembly {
            s.slot := STORAGE_SLOT
        }
    }
}

// keccak256("storage.PoolGeneric") - 1
bytes32 constant STORAGE_SLOT = 0x09da1568b6ec0e15d0b57cf3c57223ce89cd8df517a4a7e116dc5a1712234cc2;
