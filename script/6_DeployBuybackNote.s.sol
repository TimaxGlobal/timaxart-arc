// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {ArtBuybackNote} from "../src/ArtBuybackNote.sol";

/// Deploys the buyback note contract. The Safe becomes its admin from the start.
/// Env: SAFE (admin), TREASURY (receives the clients' payments; normally the Safe), HOOK (the KYC list of the share)
contract DeployBuybackNote is Script {
    function run() external {
        vm.startBroadcast();
        ArtBuybackNote n = new ArtBuybackNote(vm.envAddress("SAFE"), vm.envAddress("TREASURY"), vm.envAddress("HOOK"));
        vm.stopBroadcast();
        console.log("NOTE=", address(n));
    }
}
