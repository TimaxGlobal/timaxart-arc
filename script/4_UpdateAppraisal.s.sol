// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script} from "forge-std/Script.sol";
import {ArtAppraisalOracle} from "../src/ArtAppraisalOracle.sol";

/// Re-appraisal. Env: ORACLE, NEW_PRICE (loan raw units per whole share), REPORT_HASH. Run from the oracle owner (the Safe, or the deployer before transfer).
contract UpdateAppraisal is Script {
    function run() external {
        vm.startBroadcast();
        ArtAppraisalOracle(vm.envAddress("ORACLE")).setAppraisal(vm.envUint("NEW_PRICE"), vm.envBytes32("REPORT_HASH"));
        vm.stopBroadcast();
    }
}
