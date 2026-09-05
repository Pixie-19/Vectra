// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {VectraTreasury} from "../contracts/VectraTreasury.sol";

contract DeployVectraTreasury is Script {
    address constant ARC_TESTNET_USDC = 0x3600000000000000000000000000000000000000;

    function run() external returns (VectraTreasury treasury) {
        vm.startBroadcast();

        treasury = new VectraTreasury(ARC_TESTNET_USDC);

        vm.stopBroadcast();
    }
}
