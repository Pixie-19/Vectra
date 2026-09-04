// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

contract VectraTreasury is EIP712 {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdc;

    struct SettlementIntent {
        bytes32 groupId;
        uint256 nonce;
        uint256 deadline;
        address[] from;
        address[] to;
        uint256[] amounts;
    }

    bytes32 private constant TRANSFER_TYPEHASH = keccak256("Transfer(address from,address to,uint256 amount)");

    bytes32 private constant SETTLEMENT_TYPEHASH =
        keccak256("Settlement(bytes32 groupId,uint256 nonce,uint256 deadline,bytes32 transfersHash)");

    mapping(bytes32 => address) public coordinators;

    mapping(bytes32 => uint256) public nonces;

    error InvalidUSDC();
    error InvalidRecipient();
    error InvalidAmount();
    error InsufficientAllowance();
    error InvalidSignature();
    error InvalidCoordinator();
    error CoordinatorAlreadySet();
    error IntentExpired();
    error InvalidTransfers();

    event GroupRegistered(bytes32 indexed groupId, address indexed coordinator);

    event SettlementExecuted(bytes32 indexed groupId, address indexed from, address indexed to, uint256 amount);

    event SettlementIntentExecuted(bytes32 indexed groupId, address indexed signer, uint256 nonce);

    constructor(address usdcAddress) EIP712("Vectra", "1") {
        if (usdcAddress == address(0)) {
            revert InvalidUSDC();
        }

        usdc = IERC20(usdcAddress);
    }

    // ------------------------------------------------------------
    // GROUP REGISTRATION
    // ------------------------------------------------------------

    function registerGroup(bytes32 groupId) external {
        if (coordinators[groupId] != address(0)) {
            revert CoordinatorAlreadySet();
        }

        coordinators[groupId] = msg.sender;

        emit GroupRegistered(groupId, msg.sender);
    }

    // ------------------------------------------------------------
    // EIP-712 SETTLEMENT INTENT
    // ------------------------------------------------------------

    function executeSettlementIntent(SettlementIntent calldata intent, bytes calldata signature) external {
        if (block.timestamp > intent.deadline) {
            revert IntentExpired();
        }

        uint256 length = intent.from.length;

        if (length == 0 || intent.to.length != length || intent.amounts.length != length) {
            revert InvalidTransfers();
        }

        address coordinator = coordinators[intent.groupId];

        if (coordinator == address(0)) {
            revert InvalidCoordinator();
        }

        bytes32 transfersHash = _hashTransfers(intent.from, intent.to, intent.amounts);

        bytes32 structHash =
            keccak256(abi.encode(SETTLEMENT_TYPEHASH, intent.groupId, intent.nonce, intent.deadline, transfersHash));

        bytes32 digest = _hashTypedDataV4(structHash);

        address signer = ECDSA.recover(digest, signature);

        if (signer != coordinator) {
            revert InvalidSignature();
        }

        if (nonces[intent.groupId] != intent.nonce) {
            revert InvalidSignature();
        }

        nonces[intent.groupId] = intent.nonce + 1;

        for (uint256 i = 0; i < length; i++) {
            _executeTransfer(intent.groupId, intent.from[i], intent.to[i], intent.amounts[i]);
        }

        emit SettlementIntentExecuted(intent.groupId, signer, intent.nonce);
    }

    // ------------------------------------------------------------
    // INTERNAL TRANSFER
    // ------------------------------------------------------------

    function _executeTransfer(bytes32 groupId, address from, address to, uint256 amount) internal {
        if (from == address(0) || to == address(0) || from == to) {
            revert InvalidRecipient();
        }

        if (amount == 0) {
            revert InvalidAmount();
        }

        uint256 allowance = usdc.allowance(from, address(this));

        if (allowance < amount) {
            revert InsufficientAllowance();
        }

        usdc.safeTransferFrom(from, to, amount);

        emit SettlementExecuted(groupId, from, to, amount);
    }

    // ------------------------------------------------------------
    // TRANSFER HASHING
    // ------------------------------------------------------------

    function _hashTransfers(address[] calldata from, address[] calldata to, uint256[] calldata amounts)
        internal
        pure
        returns (bytes32)
    {
        bytes32[] memory transferHashes = new bytes32[](from.length);

        for (uint256 i = 0; i < from.length; i++) {
            transferHashes[i] = keccak256(abi.encode(TRANSFER_TYPEHASH, from[i], to[i], amounts[i]));
        }

        return keccak256(abi.encodePacked(transferHashes));
    }
}
