// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Router for ArtPoolHook pools. Passes the real caller to the hook (hookData) so the hook can check KYC.
///         Must be registered with ArtPoolHook.setRouter(). Users approve the input token to this contract.
contract ArtSwapRouter is IUnlockCallback {
    using SafeERC20 for IERC20;
    using BalanceDeltaLibrary for BalanceDelta;

    IPoolManager public immutable poolManager;

    struct Swap { address user; PoolKey key; bool zeroForOne; uint256 amountIn; uint256 minOut; }

    constructor(IPoolManager pm) { poolManager = pm; }

    function swapExactIn(PoolKey calldata key, bool zeroForOne, uint256 amountIn, uint256 minOut, uint256 deadline)
        external returns (uint256 amountOut)
    {
        require(block.timestamp <= deadline, "expired");
        bytes memory res = poolManager.unlock(abi.encode(Swap(msg.sender, key, zeroForOne, amountIn, minOut)));
        amountOut = abi.decode(res, (uint256));
    }

    function unlockCallback(bytes calldata raw) external returns (bytes memory) {
        require(msg.sender == address(poolManager), "not PM");
        Swap memory s = abi.decode(raw, (Swap));

        BalanceDelta d = poolManager.swap(
            s.key,
            SwapParams({
                zeroForOne: s.zeroForOne,
                amountSpecified: -int256(s.amountIn),
                sqrtPriceLimitX96: s.zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            abi.encode(s.user)
        );

        (Currency cin, Currency cout) = s.zeroForOne ? (s.key.currency0, s.key.currency1) : (s.key.currency1, s.key.currency0);
        int128 dIn = s.zeroForOne ? d.amount0() : d.amount1();
        int128 dOut = s.zeroForOne ? d.amount1() : d.amount0();
        uint256 owed = uint256(uint128(-dIn));
        uint256 got = uint256(uint128(dOut));
        require(got >= s.minOut, "slippage");

        poolManager.sync(cin);
        IERC20(Currency.unwrap(cin)).safeTransferFrom(s.user, address(poolManager), owed);
        poolManager.settle();
        poolManager.take(cout, s.user, got);
        return abi.encode(got);
    }
}
