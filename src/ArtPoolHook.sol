// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";

/// @title ArtPoolHook
/// @notice Permissioned Uniswap v4 hook for fractional art shares (ArtShare / stablecoin pools).
///  - only the admin can create pools, and only share/approved-stablecoin pairs (Arc USDC, EURC; Tempo USDC.e, EURC.e)
///  - swaps only through trusted routers and only for KYC-approved wallets
///  - dynamic LP fee: high at launch, decaying linearly to the base fee (anti-sniping)
///  - liquidity can only be added while the admin keeps the liquidity window open (protocol-owned liquidity)
contract ArtPoolHook is IHooks {
    using PoolIdLibrary for PoolKey;

    struct ShareCfg { uint24 startFee; uint24 baseFee; uint32 decay; bool registered; }
    struct PoolCfg { uint24 startFee; uint24 baseFee; uint32 decay; uint64 launch; }

    IPoolManager public immutable poolManager;
    address public admin;
    address public pendingAdmin;
    address public kycOperator;
    bool public liquidityWindowOpen;

    mapping(address => bool) public allowedQuote;
    mapping(address => bool) public trustedRouter;
    mapping(address => bool) public kyc;
    mapping(address => ShareCfg) public shareCfg;
    mapping(PoolId => PoolCfg) public poolCfg;

    error NotPoolManager();
    error NotAdmin();
    error NotAllowed();
    error NotImplemented();

    event KycSet(address indexed user, bool ok);
    event PoolRegistered(PoolId indexed id, address share, address quote, uint64 launch);

    modifier onlyPM() { if (msg.sender != address(poolManager)) revert NotPoolManager(); _; }
    modifier onlyAdmin() { if (msg.sender != admin) revert NotAdmin(); _; }

    constructor(IPoolManager pm, address admin_, address[] memory quotes) {
        poolManager = pm;
        admin = admin_;
        kycOperator = admin_;
        for (uint256 i; i < quotes.length; i++) allowedQuote[quotes[i]] = true;
        Hooks.validateHookPermissions(
            IHooks(address(this)),
            Hooks.Permissions({
                beforeInitialize: true, afterInitialize: false,
                beforeAddLiquidity: true, afterAddLiquidity: false,
                beforeRemoveLiquidity: false, afterRemoveLiquidity: false,
                beforeSwap: true, afterSwap: false,
                beforeDonate: false, afterDonate: false,
                beforeSwapReturnDelta: false, afterSwapReturnDelta: false,
                afterAddLiquidityReturnDelta: false, afterRemoveLiquidityReturnDelta: false
            })
        );
    }

    // ---------------- admin ----------------
    function transferAdmin(address next) external onlyAdmin { pendingAdmin = next; }
    function acceptAdmin() external { require(msg.sender == pendingAdmin, "not pending"); admin = msg.sender; pendingAdmin = address(0); }
    function setKycOperator(address op) external onlyAdmin { kycOperator = op; }
    function setQuote(address token, bool ok) external onlyAdmin { allowedQuote[token] = ok; }
    function setRouter(address router, bool ok) external onlyAdmin { trustedRouter[router] = ok; }
    function setLiquidityWindow(bool open) external onlyAdmin { liquidityWindowOpen = open; }

    function registerShare(address share, uint24 startFee, uint24 baseFee, uint32 decay) external onlyAdmin {
        require(startFee <= 100_000 && baseFee <= startFee, "fee");
        shareCfg[share] = ShareCfg(startFee, baseFee, decay, true);
    }

    function setKyc(address[] calldata users, bool ok) external {
        require(msg.sender == kycOperator || msg.sender == admin, "not operator");
        for (uint256 i; i < users.length; i++) { kyc[users[i]] = ok; emit KycSet(users[i], ok); }
    }

    // ---------------- hook callbacks ----------------
    function beforeInitialize(address sender, PoolKey calldata key, uint160) external onlyPM returns (bytes4) {
        if (sender != admin) revert NotAdmin();
        if (!LPFeeLibrary.isDynamicFee(key.fee)) revert NotAllowed();
        address c0 = _addr(key.currency0);
        address c1 = _addr(key.currency1);
        (address share, address quote) = shareCfg[c0].registered ? (c0, c1) : (c1, c0);
        ShareCfg memory s = shareCfg[share];
        if (!s.registered || !allowedQuote[quote]) revert NotAllowed();
        PoolId id = key.toId();
        poolCfg[id] = PoolCfg(s.startFee, s.baseFee, s.decay, uint64(block.timestamp));
        emit PoolRegistered(id, share, quote, uint64(block.timestamp));
        return IHooks.beforeInitialize.selector;
    }

    function beforeAddLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        external view onlyPM returns (bytes4)
    {
        if (!liquidityWindowOpen) revert NotAllowed();
        return IHooks.beforeAddLiquidity.selector;
    }

    function beforeSwap(address sender, PoolKey calldata key, SwapParams calldata, bytes calldata hookData)
        external view onlyPM returns (bytes4, BeforeSwapDelta, uint24)
    {
        if (!trustedRouter[sender] || hookData.length != 32) revert NotAllowed();
        address user = abi.decode(hookData, (address));
        if (!kyc[user]) revert NotAllowed();
        return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, currentFee(key.toId()) | LPFeeLibrary.OVERRIDE_FEE_FLAG);
    }

    /// @notice LP fee in hundredths of a bip (3000 = 0.30%), decaying from startFee to baseFee after launch.
    function currentFee(PoolId id) public view returns (uint24) {
        PoolCfg memory c = poolCfg[id];
        uint256 elapsed = block.timestamp - c.launch;
        if (c.decay == 0 || elapsed >= c.decay) return c.baseFee;
        return uint24(c.startFee - (uint256(c.startFee - c.baseFee) * elapsed) / c.decay);
    }

    function _addr(Currency c) private pure returns (address) { return Currency.unwrap(c); }

    // ---------------- unused callbacks ----------------
    function afterInitialize(address, PoolKey calldata, uint160, int24) external pure returns (bytes4) { revert NotImplemented(); }
    function afterAddLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, BalanceDelta, BalanceDelta, bytes calldata) external pure returns (bytes4, BalanceDelta) { revert NotImplemented(); }
    function beforeRemoveLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata) external pure returns (bytes4) { revert NotImplemented(); }
    function afterRemoveLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, BalanceDelta, BalanceDelta, bytes calldata) external pure returns (bytes4, BalanceDelta) { revert NotImplemented(); }
    function afterSwap(address, PoolKey calldata, SwapParams calldata, BalanceDelta, bytes calldata) external pure returns (bytes4, int128) { revert NotImplemented(); }
    function beforeDonate(address, PoolKey calldata, uint256, uint256, bytes calldata) external pure returns (bytes4) { revert NotImplemented(); }
    function afterDonate(address, PoolKey calldata, uint256, uint256, bytes calldata) external pure returns (bytes4) { revert NotImplemented(); }
}
