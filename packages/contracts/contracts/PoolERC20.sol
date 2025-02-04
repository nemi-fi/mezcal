// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity ^0.8.23;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Fr, FrLib, keccak256ToFr} from "./Fr.sol";
import {NoteInput, TokenAmount, Call, Execution, MAX_TOKENS_IN_PER_EXECUTION, MAX_TOKENS_OUT_PER_EXECUTION, PublicInputs, U256_LIMBS} from "./Utils.sol";
import {PoolGeneric} from "./PoolGeneric.sol";
import {UltraVerifier as ShieldVerifier} from "../noir/target/erc20_shield.sol";
import {UltraVerifier as UnshieldVerifier} from "../noir/target/erc20_unshield.sol";
import {UltraVerifier as JoinVerifier} from "../noir/target/erc20_join.sol";
import {UltraVerifier as TransferVerifier} from "../noir/target/erc20_transfer.sol";
import {UltraVerifier as RollupVerifier} from "../noir/target/rollup.sol";

// Note: keep in sync with other languages
uint32 constant MAX_NOTES_TO_JOIN = 2;

contract PoolERC20 is PoolGeneric {
    using SafeERC20 for IERC20;
    using FrLib for Fr;
    using PublicInputs for PublicInputs.Type;

    struct PoolERC20Storage {
        ShieldVerifier shieldVerifier;
        UnshieldVerifier unshieldVerifier;
        JoinVerifier joinVerifier;
        TransferVerifier transferVerifier;
    }

    constructor(
        ShieldVerifier shieldVerifier,
        UnshieldVerifier unshieldVerifier,
        JoinVerifier joinVerifier,
        TransferVerifier transferVerifier,
        RollupVerifier rollupVerifier
    ) PoolGeneric(rollupVerifier) {
        _poolErc20Storage().shieldVerifier = shieldVerifier;
        _poolErc20Storage().unshieldVerifier = unshieldVerifier;
        _poolErc20Storage().joinVerifier = joinVerifier;
        _poolErc20Storage().transferVerifier = transferVerifier;
    }

    function shield(
        bytes calldata proof,
        IERC20 token,
        uint256 amount,
        NoteInput calldata note
    ) external {
        token.safeTransferFrom(msg.sender, address(this), amount);

        PublicInputs.Type memory pi = PublicInputs.create(2 + U256_LIMBS);
        pi.push(address(token));
        pi.pushUint256Limbs(amount);
        pi.push(note.noteHash);
        require(
            _poolErc20Storage().shieldVerifier.verify(proof, pi.finish()),
            "Invalid shield proof"
        );

        {
            NoteInput[] memory noteInputs = new NoteInput[](1);
            noteInputs[0] = note;
            bytes32[] memory nullifiers;
            _PoolGeneric_addPendingTx(noteInputs, nullifiers);
        }
    }

    function unshield(
        bytes calldata proof,
        IERC20 token,
        address to,
        uint256 amount,
        bytes32 nullifier,
        NoteInput calldata changeNote
    ) external {
        PublicInputs.Type memory pi = PublicInputs.create(6 + U256_LIMBS);
        // params
        pi.push(getNoteHashTree().root);
        pi.push(getNullifierTree().root);
        pi.push(to);
        pi.push(address(token));
        pi.pushUint256Limbs(amount);
        // result
        pi.push(changeNote.noteHash);
        pi.push(nullifier);
        require(
            _poolErc20Storage().unshieldVerifier.verify(proof, pi.finish()),
            "Invalid unshield proof"
        );

        {
            NoteInput[] memory noteInputs = new NoteInput[](1);
            noteInputs[0] = changeNote;
            bytes32[] memory nullifiers = new bytes32[](1);
            nullifiers[0] = nullifier;
            _PoolGeneric_addPendingTx(noteInputs, nullifiers);
        }

        // effects
        token.safeTransfer(to, amount);
    }

    function join(
        bytes calldata proof,
        bytes32[MAX_NOTES_TO_JOIN] calldata nullifiers,
        NoteInput calldata joinNote
    ) external {
        PublicInputs.Type memory pi = PublicInputs.create(
            2 + MAX_NOTES_TO_JOIN + 1
        );
        pi.push(getNoteHashTree().root);
        pi.push(getNullifierTree().root);
        pi.push(joinNote.noteHash);
        for (uint256 i = 0; i < MAX_NOTES_TO_JOIN; i++) {
            pi.push(nullifiers[i]);
        }
        require(
            _poolErc20Storage().joinVerifier.verify(proof, pi.finish()),
            "Invalid join proof"
        );

        {
            NoteInput[] memory noteInputs = new NoteInput[](1);
            noteInputs[0] = joinNote;
            bytes32[] memory nullifiersDyn = new bytes32[](nullifiers.length);
            for (uint256 i = 0; i < nullifiers.length; i++) {
                nullifiersDyn[i] = nullifiers[i];
            }
            _PoolGeneric_addPendingTx(noteInputs, nullifiersDyn);
        }
    }

    function transfer(
        bytes calldata proof,
        bytes32 nullifier,
        NoteInput calldata changeNote,
        NoteInput calldata toNote
    ) external {
        PublicInputs.Type memory pi = PublicInputs.create(5);
        pi.push(getNoteHashTree().root);
        pi.push(getNullifierTree().root);
        pi.push(changeNote.noteHash);
        pi.push(toNote.noteHash);
        pi.push(nullifier);
        require(
            _poolErc20Storage().transferVerifier.verify(proof, pi.finish()),
            "Invalid transfer proof"
        );

        {
            NoteInput[] memory noteInputs = new NoteInput[](2);
            noteInputs[0] = changeNote;
            noteInputs[1] = toNote;
            bytes32[] memory nullifiers = new bytes32[](1);
            nullifiers[0] = nullifier;
            _PoolGeneric_addPendingTx(noteInputs, nullifiers);
        }
    }

    function _poolErc20Storage()
        private
        pure
        returns (PoolERC20Storage storage s)
    {
        assembly {
            s.slot := STORAGE_SLOT
        }
    }
}

// keccak256("storage.PoolERC20") - 1
bytes32 constant STORAGE_SLOT = 0x2f64cf42bfffdfbf199004d3529d110e06f94674b975e86640e5dc11173fedfe;
