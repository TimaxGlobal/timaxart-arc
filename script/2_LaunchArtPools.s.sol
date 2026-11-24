// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {IPositionManager} from "v4-periphery/src/interfaces/IPositionManager.sol";
import {Actions} from "v4-periphery/src/libraries/Actions.sol";
import {LiquidityAmounts} from "v4-periphery/src/libraries/LiquidityAmounts.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ArtShare} from "../src/ArtShare.sol";
import {ArtPoolHook} from "../src/ArtPoolHook.sol";

interface IPermit2 { function approve(address token, address spender, uint160 amount, uint48 expiration) external; }

/// Creates the share token, registers it on the hook, initialises share/USDC and share/EURC pools and seeds protocol-owned liquidity.
/// Env: POOL_MANAGER, POSITION_MANAGER, HOOK, USDC, EURC, SHARE_NAME, SHARE_SYMBOL, ARTWORK_URI,
///      PRICE_USDC, PRICE_EURC (quote raw units per 1 whole share, e.g. 12500000 = 12.5 USDC),
///      SEED_SHARES (whole shares per pool), optional: SUPPLY_SHARES (default 1,000,000), ONE_SIDED=1 (sell-only offering, SEED_SHARES split equally across the two pools: no quote
///      tokens needed, investors buy shares from the range and the quote accumulates in the position), MORPHO (exempt from the transfer
///      restriction so shares can be posted as collateral), PERMIT2, RANGE_TICKS, START_FEE, BASE_FEE, DECAY_SECONDS, SAFE
contract LaunchArtPools is Script {
    int24 constant SPACING = 60;
    address constant CANONICAL_PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    ArtPoolHook hook;
    IPositionManager posm;
    address share;
    address owner;
    address permit2;

    function run() external {
        IPoolManager pm = IPoolManager(vm.envAddress("POOL_MANAGER"));
        posm = IPositionManager(vm.envAddress("POSITION_MANAGER"));
        hook = ArtPoolHook(vm.envAddress("HOOK"));
        permit2 = vm.envOr("PERMIT2", CANONICAL_PERMIT2);
        uint256 seed = vm.envUint("SEED_SHARES") * 1e18;
        // sell-only offering: SEED_SHARES is the TOTAL on offer, split equally between the USDC and EURC pools
        if (vm.envOr("ONE_SIDED", uint256(0)) == 1) seed = seed / 2;

        vm.startBroadcast();
        (, address deployer,) = vm.readCallers();
        owner = vm.envOr("SAFE", deployer); // liquidity NFTs go to the Safe when SAFE is set

        address[] memory infra = new address[](vm.envOr("MORPHO", address(0)) == address(0) ? 1 : 2);
        infra[0] = address(pm);
        if (infra.length == 2) infra[1] = vm.envAddress("MORPHO");
        share = address(new ArtShare(
            vm.envString("SHARE_NAME"), vm.envString("SHARE_SYMBOL"), vm.envString("ARTWORK_URI"),
            vm.envOr("SUPPLY_SHARES", uint256(1_000_000)) * 1e18, deployer, address(hook), owner, infra
        ));
        hook.registerShare(share, uint24(vm.envOr("START_FEE", uint256(50_000))), uint24(vm.envOr("BASE_FEE", uint256(5_000))), uint32(vm.envOr("DECAY_SECONDS", uint256(3 days))));
        hook.setLiquidityWindow(true);

        _launch(pm, vm.envAddress("USDC"), vm.envUint("PRICE_USDC"), seed);
        _launch(pm, vm.envAddress("EURC"), vm.envUint("PRICE_EURC"), seed);

        hook.setLiquidityWindow(false);
        vm.stopBroadcast();
        console.log("SHARE=", share);
    }

    function _launch(IPoolManager pm, address quote, uint256 priceRaw, uint256 shareSeed) internal {
        bool shareIs0 = share < quote;
        (address c0, address c1) = shareIs0 ? (share, quote) : (quote, share);
        PoolKey memory key = PoolKey(Currency.wrap(c0), Currency.wrap(c1), LPFeeLibrary.DYNAMIC_FEE_FLAG, SPACING, IHooks(address(hook)));

        // price of token1 in token0 (raw): shareIs0 ? priceRaw/1e18 : 1e18/priceRaw
        uint160 sqrtP = shareIs0
            ? uint160(Math.sqrt(Math.mulDiv(priceRaw, uint256(1) << 192, 1e18)))
            : uint160(Math.sqrt(Math.mulDiv(1e18, uint256(1) << 192, priceRaw)));
        int24 tick = pm.initialize(key, sqrtP);

        bool oneSided = vm.envOr("ONE_SIDED", uint256(0)) == 1;
        int24 w = int24(int256(vm.envOr("RANGE_TICKS", oneSided ? uint256(1020) : uint256(4000))));
        int24 lower;
        int24 upper;
        if (oneSided) {
            // all-share position: above the price when share is token0, below it when share is token1
            if (shareIs0) { lower = _floor(tick) + SPACING; upper = lower + w; }
            else { upper = _floor(tick); lower = upper - w; }
        } else {
            lower = _floor(tick - w);
            upper = _floor(tick + w) + SPACING;
        }

        uint256 quoteSeed = oneSided ? 0 : Math.mulDiv(shareSeed, priceRaw, 1e18);
        (uint256 a0, uint256 a1) = shareIs0 ? (shareSeed, quoteSeed) : (quoteSeed, shareSeed);
        uint128 liq = LiquidityAmounts.getLiquidityForAmounts(sqrtP, TickMath.getSqrtPriceAtTick(lower), TickMath.getSqrtPriceAtTick(upper), a0, a1);

        _approve(share);
        _approve(quote);

        bytes memory actions = abi.encodePacked(uint8(Actions.MINT_POSITION), uint8(Actions.SETTLE_PAIR));
        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(key, lower, upper, uint256(liq), uint128(a0 + a0 / 100), uint128(a1 + a1 / 100), owner, bytes(""));
        params[1] = abi.encode(key.currency0, key.currency1);
        posm.modifyLiquidities(abi.encode(actions, params), block.timestamp + 600);

        console.log("pool quote=", quote);
        console.log("tickLower=", int256(lower));
        console.log("tickUpper=", int256(upper));
    }

    function _approve(address token) internal {
        IERC20(token).approve(permit2, type(uint256).max);
        IPermit2(permit2).approve(token, address(posm), type(uint160).max, uint48(block.timestamp + 3600));
    }

    function _floor(int24 t) internal pure returns (int24) {
        int24 c = t / SPACING;
        if (t % SPACING != 0 && t < 0) c--;
        return c * SPACING;
    }
}
