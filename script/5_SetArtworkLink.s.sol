// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script} from "forge-std/Script.sol";
import {ArtShare} from "../src/ArtShare.sol";

/// Change the artwork link of a launched share. Env: SHARE, NEW_URI. Optional LOCK=1 to freeze it forever afterwards.
/// Must be sent by the share admin (the Safe). With a Safe, use the printed values in Safe's "Transaction Builder" instead of --broadcast.
contract SetArtworkLink is Script {
    function run() external {
        ArtShare s = ArtShare(vm.envAddress("SHARE"));
        string memory uri = vm.envString("NEW_URI");
        vm.startBroadcast();
        s.setArtworkURI(uri);
        if (vm.envOr("LOCK", uint256(0)) == 1) s.lockArtwork();
        vm.stopBroadcast();
    }
}
