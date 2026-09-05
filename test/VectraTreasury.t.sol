// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";

import {VectraTreasury} from "../contracts/VectraTreasury.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {console2} from "forge-std/console2.sol";

contract VectraTreasuryTest is Test {
    MockUSDC usdc;
    VectraTreasury treasury;

    uint256 signerPrivateKey = 0xA11CE;
    address signer;

    address alice = address(0x1);
    address bob = address(0x2);
    address charlie = address(0x3);

    bytes32 groupId = keccak256("group-1");

    uint256 constant INITIAL_BALANCE = 1_000_000;

    function setUp() public {
        signer = vm.addr(signerPrivateKey);

        usdc = new MockUSDC();
        treasury = new VectraTreasury(address(usdc));

        vm.prank(signer);
        treasury.registerGroup(groupId);

        usdc.mint(bob, INITIAL_BALANCE);
        usdc.mint(charlie, INITIAL_BALANCE);
    }

    function testValidSettlementIntent() public {
        uint256 amount = 250_000;
        uint256 nonce = 0;
        uint256 deadline = block.timestamp + 1 hours;

        vm.prank(bob);
        usdc.approve(address(treasury), amount);

        address[] memory from = new address[](1);
        address[] memory to = new address[](1);
        uint256[] memory amounts = new uint256[](1);

        from[0] = bob;
        to[0] = alice;
        amounts[0] = amount;

        bytes32 transfersHash = _hashTransfers(from, to, amounts);

        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("Settlement(bytes32 groupId,uint256 nonce,uint256 deadline,bytes32 transfersHash)"),
                groupId,
                nonce,
                deadline,
                transfersHash
            )
        );

        bytes32 digest = _hashTypedDataV4(structHash);

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPrivateKey, digest);

        bytes memory signature = abi.encodePacked(r, s, v);

        VectraTreasury.SettlementIntent memory intent;

        intent.groupId = groupId;
        intent.nonce = nonce;
        intent.deadline = deadline;
        intent.from = from;
        intent.to = to;
        intent.amounts = amounts;

        treasury.executeSettlementIntent(intent, signature);

        assertEq(usdc.balanceOf(bob), INITIAL_BALANCE - amount);

        assertEq(usdc.balanceOf(alice), amount);

        assertEq(treasury.nonces(groupId), 1);
    }

    function testExpiredIntentReverts() public {
        uint256 nonce = 0;
        uint256 deadline = block.timestamp - 1;

        address[] memory from = new address[](1);
        address[] memory to = new address[](1);
        uint256[] memory amounts = new uint256[](1);

        from[0] = bob;
        to[0] = alice;
        amounts[0] = 100_000;

        VectraTreasury.SettlementIntent memory intent;

        intent.groupId = groupId;
        intent.nonce = nonce;
        intent.deadline = deadline;
        intent.from = from;
        intent.to = to;
        intent.amounts = amounts;

        vm.expectRevert(VectraTreasury.IntentExpired.selector);

        treasury.executeSettlementIntent(intent, "");
    }

    function testModifiedIntentFailsSignatureCheck() public {
        uint256 amount = 250_000;
        uint256 nonce = 0;
        uint256 deadline = block.timestamp + 1 hours;

        vm.prank(bob);
        usdc.approve(address(treasury), amount);

        address[] memory signedFrom = new address[](1);
        address[] memory signedTo = new address[](1);
        uint256[] memory signedAmounts = new uint256[](1);

        signedFrom[0] = bob;
        signedTo[0] = alice;
        signedAmounts[0] = amount;

        bytes32 signedTransfersHash = _hashTransfers(signedFrom, signedTo, signedAmounts);

        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("Settlement(bytes32 groupId,uint256 nonce,uint256 deadline,bytes32 transfersHash)"),
                groupId,
                nonce,
                deadline,
                signedTransfersHash
            )
        );

        bytes32 digest = _hashTypedDataV4(structHash);

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPrivateKey, digest);

        bytes memory signature = abi.encodePacked(r, s, v);

        // Change the recipient after signing.
        signedTo[0] = charlie;

        VectraTreasury.SettlementIntent memory intent;

        intent.groupId = groupId;
        intent.nonce = nonce;
        intent.deadline = deadline;
        intent.from = signedFrom;
        intent.to = signedTo;
        intent.amounts = signedAmounts;

        vm.expectRevert(VectraTreasury.InvalidSignature.selector);

        treasury.executeSettlementIntent(intent, signature);
    }

    function _hashTransfers(address[] memory from, address[] memory to, uint256[] memory amounts)
        internal
        pure
        returns (bytes32)
    {
        bytes32 transferTypeHash = keccak256("Transfer(address from,address to,uint256 amount)");

        bytes32[] memory transferHashes = new bytes32[](from.length);

        for (uint256 i = 0; i < from.length; i++) {
            transferHashes[i] = keccak256(abi.encode(transferTypeHash, from[i], to[i], amounts[i]));
        }

        return keccak256(abi.encodePacked(transferHashes));
    }

    function _hashTypedDataV4(bytes32 structHash) internal view returns (bytes32) {
        bytes32 domainSeparator = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("Vectra")),
                keccak256(bytes("1")),
                block.chainid,
                address(treasury)
            )
        );

        return keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
    }

    function testOnlyCallerBecomesCoordinator() public {
        address attacker = makeAddr("attacker");
        bytes32 attackerGroup = keccak256("attacker-group");

        vm.prank(attacker);
        treasury.registerGroup(attackerGroup);

        assertEq(treasury.coordinators(attackerGroup), attacker);
    }

    function testGroupCannotBeRegisteredTwice() public {
        vm.expectRevert(VectraTreasury.CoordinatorAlreadySet.selector);

        vm.prank(signer);
        treasury.registerGroup(groupId);
    }

    function testSettlementIntentCannotBeReplayed() public {
        uint256 amount = 250_000;
        uint256 nonce = 0;
        uint256 deadline = block.timestamp + 1 hours;

        vm.prank(bob);
        usdc.approve(address(treasury), amount);

        address[] memory from = new address[](1);
        address[] memory to = new address[](1);
        uint256[] memory amounts = new uint256[](1);

        from[0] = bob;
        to[0] = alice;
        amounts[0] = amount;

        bytes32 transfersHash = _hashTransfers(from, to, amounts);

        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("Settlement(bytes32 groupId,uint256 nonce,uint256 deadline,bytes32 transfersHash)"),
                groupId,
                nonce,
                deadline,
                transfersHash
            )
        );

        bytes32 digest = _hashTypedDataV4(structHash);

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPrivateKey, digest);

        bytes memory signature = abi.encodePacked(r, s, v);

        VectraTreasury.SettlementIntent memory intent;

        intent.groupId = groupId;
        intent.nonce = nonce;
        intent.deadline = deadline;
        intent.from = from;
        intent.to = to;
        intent.amounts = amounts;

        // First execution must succeed.
        treasury.executeSettlementIntent(intent, signature);

        assertEq(treasury.nonces(groupId), 1);

        assertEq(usdc.balanceOf(alice), amount);

        // Same intent + same signature must fail.
        vm.expectRevert(VectraTreasury.InvalidSignature.selector);

        treasury.executeSettlementIntent(intent, signature);
    }

    function testSettlementIntentIsAtomic() public {
        uint256 bobAmount = 100_000;
        uint256 charlieAmount = 100_000;

        uint256 nonce = 0;
        uint256 deadline = block.timestamp + 1 hours;

        vm.prank(bob);
        usdc.approve(address(treasury), bobAmount);

        address[] memory from = new address[](2);
        address[] memory to = new address[](2);
        uint256[] memory amounts = new uint256[](2);

        from[0] = bob;
        to[0] = alice;
        amounts[0] = bobAmount;

        from[1] = charlie;
        to[1] = alice;
        amounts[1] = charlieAmount;

        bytes32 transfersHash = _hashTransfers(from, to, amounts);

        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("Settlement(bytes32 groupId,uint256 nonce,uint256 deadline,bytes32 transfersHash)"),
                groupId,
                nonce,
                deadline,
                transfersHash
            )
        );

        bytes32 digest = _hashTypedDataV4(structHash);

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPrivateKey, digest);

        bytes memory signature = abi.encodePacked(r, s, v);

        VectraTreasury.SettlementIntent memory intent;

        intent.groupId = groupId;
        intent.nonce = nonce;
        intent.deadline = deadline;
        intent.from = from;
        intent.to = to;
        intent.amounts = amounts;

        vm.expectRevert(VectraTreasury.InsufficientAllowance.selector);

        treasury.executeSettlementIntent(intent, signature);

        // The first transfer must also have been rolled back.
        assertEq(usdc.balanceOf(bob), INITIAL_BALANCE);

        assertEq(usdc.balanceOf(charlie), INITIAL_BALANCE);

        assertEq(usdc.balanceOf(alice), 0);

        // Nonce must also remain unchanged.
        assertEq(treasury.nonces(groupId), 0);
    }
}