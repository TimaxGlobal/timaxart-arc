// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ArtAppraisalOracle} from "../src/ArtAppraisalOracle.sol";

struct MarketParams { address loanToken; address collateralToken; address oracle; address irm; uint256 lltv; }

interface IMorpho {
    function createMarket(MarketParams memory marketParams) external;
    function supply(MarketParams memory marketParams, uint256 assets, uint256 shares, address onBehalf, bytes memory data) external returns (uint256, uint256);
    function isIrmEnabled(address irm) external view returns (bool);
    function isLltvEnabled(uint256 lltv) external view returns (bool);
    function idToMarketParams(bytes32 id) external view returns (MarketParams memory);
}

/// Creates the credit market for an art share on an existing Morpho Blue: borrow USDC / EURC against the share.
/// Env: MORPHO, SHARE, USDC, EURC, IRM, APPRAISAL_USDC (loan raw units per whole share), APPRAISAL_EURC,
///      optional: LLTV (default 385000000000000000 = 38.5%), REPORT_HASH (bytes32 of the valuation report),
///      SAFE (oracle owner), MAX_UP_BPS (default 1000), MIN_INCREASE_DAYS (default 7), MAX_AGE_DAYS (default 180),
///      SEED_USDC, SEED_EURC (raw loan units the deployer lends into the market at creation)
contract CreateCreditMarket is Script {
    IMorpho morpho;
    address share;
    address irm;
    uint256 lltv;
    address deployer;

    function run() external {
        morpho = IMorpho(vm.envAddress("MORPHO"));
        share = vm.envAddress("SHARE");
        irm = vm.envAddress("IRM");
        lltv = vm.envOr("LLTV", uint256(385000000000000000));
        require(morpho.isIrmEnabled(irm), "IRM not enabled on this Morpho: owner must enableIrm first");
        require(morpho.isLltvEnabled(lltv), "LLTV not enabled on this Morpho: owner must enableLltv first");

        vm.startBroadcast();
        (, deployer,) = vm.readCallers();
        _market(vm.envAddress("USDC"), vm.envUint("APPRAISAL_USDC"), vm.envOr("SEED_USDC", uint256(0)));
        _market(vm.envAddress("EURC"), vm.envUint("APPRAISAL_EURC"), vm.envOr("SEED_EURC", uint256(0)));
        vm.stopBroadcast();
    }

    function _market(address loan, uint256 appraisal, uint256 seed) internal {
        ArtAppraisalOracle oracle = new ArtAppraisalOracle(
            deployer, appraisal, vm.envOr("REPORT_HASH", bytes32(0)),
            vm.envOr("MAX_UP_BPS", uint256(1000)),
            vm.envOr("MIN_INCREASE_DAYS", uint256(7)) * 1 days,
            vm.envOr("MAX_AGE_DAYS", uint256(180)) * 1 days
        );
        address safe = vm.envOr("SAFE", address(0));
        if (safe != address(0)) oracle.transferOwnership(safe); // Safe must call acceptOwnership()

        MarketParams memory mp = MarketParams(loan, share, address(oracle), irm, lltv);
        bytes32 id = keccak256(abi.encode(mp));
        morpho.createMarket(mp);

        if (seed > 0) {
            IERC20(loan).approve(address(morpho), seed);
            morpho.supply(mp, seed, 0, deployer, "");
        }
        console.log("loan token:", loan);
        console.log("oracle:", address(oracle));
        console.log("marketId:");
        console.logBytes32(id);
    }
}
