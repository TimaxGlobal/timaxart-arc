// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Morpho Blue oracle for one art share priced in one loan token (USDC, EURC, USDC.e, EURC.e).
/// The price comes from a signed independent appraisal, never from the thin Uniswap pool, so it cannot be moved by trading.
///  - price() never reverts, so liquidations always work
///  - decreases apply at once (e.g. condition problem found); increases are capped and rate-limited
///  - every update stores the hash of the valuation report (IPFS/PDF) for audit
///  - isStale() lets the UI and keeper warn when the appraisal is older than maxAge
contract ArtAppraisalOracle {
    address public owner;
    address public pendingOwner;

    uint256 public pricePerShare;   // loan-token raw units per 1 whole share (18 decimals)
    bytes32 public reportHash;
    uint64 public updatedAt;
    uint64 public lastIncreaseAt;

    uint256 public immutable maxUpBps;         // e.g. 1000 = +10% per increase
    uint256 public immutable minIncreaseGap;   // seconds between increases
    uint256 public immutable maxAge;           // seconds before isStale() turns true

    error NotOwner();
    event Appraisal(uint256 pricePerShare, bytes32 reportHash, uint64 at);

    constructor(address owner_, uint256 initialPricePerShare, bytes32 report, uint256 maxUpBps_, uint256 minIncreaseGap_, uint256 maxAge_) {
        require(initialPricePerShare > 0, "price");
        owner = owner_;
        pricePerShare = initialPricePerShare;
        reportHash = report;
        updatedAt = uint64(block.timestamp);
        lastIncreaseAt = uint64(block.timestamp);
        maxUpBps = maxUpBps_;
        minIncreaseGap = minIncreaseGap_;
        maxAge = maxAge_;
        emit Appraisal(initialPricePerShare, report, uint64(block.timestamp));
    }

    /// @dev Morpho scale: price of 1 raw collateral unit in raw loan units, times 1e36. Share has 18 decimals.
    function price() external view returns (uint256) { return pricePerShare * 1e18; }

    function isStale() external view returns (bool) { return block.timestamp > uint256(updatedAt) + maxAge; }

    function setAppraisal(uint256 newPricePerShare, bytes32 report) external {
        if (msg.sender != owner) revert NotOwner();
        require(newPricePerShare > 0, "price");
        if (newPricePerShare > pricePerShare) {
            require(newPricePerShare <= pricePerShare * (10_000 + maxUpBps) / 10_000, "increase too large");
            require(block.timestamp >= uint256(lastIncreaseAt) + minIncreaseGap, "increase too soon");
            lastIncreaseAt = uint64(block.timestamp);
        }
        pricePerShare = newPricePerShare;
        reportHash = report;
        updatedAt = uint64(block.timestamp);
        emit Appraisal(newPricePerShare, report, uint64(block.timestamp));
    }

    function transferOwnership(address next) external { if (msg.sender != owner) revert NotOwner(); pendingOwner = next; }
    function acceptOwnership() external { require(msg.sender == pendingOwner, "not pending"); owner = msg.sender; pendingOwner = address(0); }
}
