// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IKycSource { function kyc(address) external view returns (bool); }
interface IAppraisal { function pricePerShare() external view returns (uint256); function isStale() external view returns (bool); }

/// @notice Fixed-return "buyback note" for an art share.
/// A verified client buys shares at a fixed entry price. TimaxArt promises to buy them back at maturity at
///   entry price x (1 + apr x term / 365 days).
/// The promise is backed in full on-chain: when a note is sold, the whole payout must already sit in this contract as
/// reserve, and the admin can only withdraw reserve that is not owed to anybody.
///  - the client pays the entry price straight to the treasury; the shares stay locked here until maturity
///  - at maturity the client chooses: redeem() = receive the fixed payout (the shares go back to TimaxArt's inventory),
///    or takeShares() = keep the shares instead (no payout). If the client does nothing, anyone can trigger redeem() after a grace period
///  - nobody, including the admin, can change a note after it is sold; pausing only stops NEW notes
/// The share token must list this contract as exempt (ArtShare.setExempt) so it can hold the shares.
contract ArtBuybackNote is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant MAX_APR_BPS = 3000;      // 30% a year, hard cap
    uint256 public constant MIN_TERM = 7 days;
    uint256 public constant MAX_TERM = 730 days;
    uint256 public constant GRACE = 30 days;         // after maturity + grace anyone may trigger the payout to the client
    uint256 private constant YEAR = 365 days;

    address public admin;
    address public pendingAdmin;
    address public treasury;
    IKycSource public immutable kycSource;           // the ArtPoolHook, same list that gates the shares
    bool public paused;

    struct Series {
        IERC20 share; IERC20 quote; IAppraisal oracle;
        uint128 entryPrice;          // quote raw units per 1 whole share (18 decimals), fixed for the series
        uint128 capacity;            // max shares (18 decimals) this series may sell
        uint128 sold;
        uint32 aprBps; uint32 term;  // fixed return a year, and note length in seconds
        uint16 maxAboveOracleBps;    // buyers are never charged more than the appraisal x (1 + this)
        uint64 saleEnds; bool open;
    }
    struct Note { address owner; uint32 seriesId; uint64 maturity; uint128 shares; uint128 paid; uint128 payout; uint8 status; } // 0 open, 1 redeemed, 2 shares taken

    Series[] private _series;
    Note[] private _notes;
    mapping(address => uint256[]) private _ownerNotes;
    mapping(address => uint256) public liabilities;  // quote tokens owed to open notes
    mapping(address => uint256) public lockedShares; // share tokens locked in open notes

    error NotAdmin(); error Paused(); error NotVerified(); error SaleClosed(); error StaleAppraisal(); error PriceAboveAppraisal();
    error OverCapacity(); error ReserveTooLow(); error NoInventory(); error NotMature(); error NotAllowed(); error Settled(); error BadParam();
    event SeriesCreated(uint256 indexed id, address share, address quote, uint128 entryPrice, uint32 aprBps, uint32 term, uint128 capacity, uint64 saleEnds);
    event SeriesOpen(uint256 indexed id, bool open);
    event NoteBought(uint256 indexed noteId, uint256 indexed seriesId, address indexed owner, uint256 shares, uint256 paid, uint256 payout, uint64 maturity);
    event Redeemed(uint256 indexed noteId, address indexed owner, uint256 payout);
    event SharesTaken(uint256 indexed noteId, address indexed owner, uint256 shares);
    event ReserveWithdrawn(address indexed token, address to, uint256 amount);
    event InventoryWithdrawn(address indexed token, address to, uint256 amount);

    modifier onlyAdmin() { if (msg.sender != admin) revert NotAdmin(); _; }

    constructor(address admin_, address treasury_, address kycSource_) {
        require(admin_ != address(0) && treasury_ != address(0) && treasury_ != address(this) && kycSource_ != address(0), "zero");
        admin = admin_; treasury = treasury_; kycSource = IKycSource(kycSource_);
    }

    // ---------------- admin ----------------
    function transferAdmin(address next) external onlyAdmin { pendingAdmin = next; }
    function acceptAdmin() external { require(msg.sender == pendingAdmin, "not pending"); admin = msg.sender; pendingAdmin = address(0); }
    function setTreasury(address t) external onlyAdmin { require(t != address(0) && t != address(this), "bad"); treasury = t; }
    function setPaused(bool p) external onlyAdmin { paused = p; }

    function createSeries(address share, address quote, address oracle, uint128 entryPrice, uint32 aprBps, uint32 term, uint16 maxAboveOracleBps, uint128 capacity, uint64 saleEnds)
        external onlyAdmin returns (uint256 id)
    {
        if (share == address(0) || quote == address(0) || oracle == address(0) || entryPrice == 0 || capacity == 0) revert BadParam();
        if (aprBps == 0 || aprBps > MAX_APR_BPS || term < MIN_TERM || term > MAX_TERM || maxAboveOracleBps > 1000 || saleEnds <= block.timestamp) revert BadParam();
        id = _series.length;
        _series.push(Series(IERC20(share), IERC20(quote), IAppraisal(oracle), entryPrice, capacity, 0, aprBps, term, maxAboveOracleBps, saleEnds, true));
        emit SeriesCreated(id, share, quote, entryPrice, aprBps, term, capacity, saleEnds);
    }
    function setSeriesOpen(uint256 id, bool open) external onlyAdmin { _series[id].open = open; emit SeriesOpen(id, open); }

    /// @notice Take back quote tokens that are not owed to any open note.
    function withdrawReserve(address token, address to, uint256 amount) external onlyAdmin {
        if (amount > reserveFree(token)) revert ReserveTooLow();
        IERC20(token).safeTransfer(to, amount); emit ReserveWithdrawn(token, to, amount);
    }
    /// @notice Take back shares that are not locked in an open note.
    function withdrawInventory(address token, address to, uint256 amount) external onlyAdmin {
        if (amount > inventoryFree(token)) revert NoInventory();
        IERC20(token).safeTransfer(to, amount); emit InventoryWithdrawn(token, to, amount);
    }

    // ---------------- views ----------------
    function reserveFree(address quote) public view returns (uint256) { uint256 b = IERC20(quote).balanceOf(address(this)); uint256 l = liabilities[quote]; return b > l ? b - l : 0; }
    function inventoryFree(address share) public view returns (uint256) { uint256 b = IERC20(share).balanceOf(address(this)); uint256 l = lockedShares[share]; return b > l ? b - l : 0; }
    function seriesCount() external view returns (uint256) { return _series.length; }
    function noteCount() external view returns (uint256) { return _notes.length; }
    function getSeries(uint256 id) external view returns (Series memory) { return _series[id]; }
    function getNote(uint256 id) external view returns (Note memory) { return _notes[id]; }
    function notesOf(address user) external view returns (uint256[] memory) { return _ownerNotes[user]; }

    /// @notice What buying `shares` of a series would cost and pay back.
    function quoteBuy(uint256 id, uint256 shares) public view returns (uint256 cost, uint256 payout) {
        Series storage s = _series[id];
        cost = (shares * uint256(s.entryPrice) + 1e18 - 1) / 1e18;
        payout = cost + (cost * s.aprBps * s.term) / (10_000 * YEAR);
    }

    // ---------------- client ----------------
    function buy(uint256 id, uint256 shares) external nonReentrant returns (uint256 noteId) {
        if (paused) revert Paused();
        Series storage s = _series[id];
        if (!s.open || block.timestamp > s.saleEnds) revert SaleClosed();
        if (!kycSource.kyc(msg.sender)) revert NotVerified();
        if (shares == 0) revert BadParam();
        if (s.oracle.isStale()) revert StaleAppraisal();
        if (uint256(s.entryPrice) > s.oracle.pricePerShare() * (10_000 + s.maxAboveOracleBps) / 10_000) revert PriceAboveAppraisal();
        if (uint256(s.sold) + shares > s.capacity) revert OverCapacity();
        (uint256 cost, uint256 payout) = quoteBuy(id, shares);
        address q = address(s.quote);
        if (payout > reserveFree(q)) revert ReserveTooLow();
        if (shares > inventoryFree(address(s.share))) revert NoInventory();

        s.sold += uint128(shares);
        liabilities[q] += payout; lockedShares[address(s.share)] += shares;
        uint64 maturity = uint64(block.timestamp + s.term);
        noteId = _notes.length;
        _notes.push(Note(msg.sender, uint32(id), maturity, uint128(shares), uint128(cost), uint128(payout), 0));
        _ownerNotes[msg.sender].push(noteId);
        s.quote.safeTransferFrom(msg.sender, treasury, cost);
        emit NoteBought(noteId, id, msg.sender, shares, cost, payout, maturity);
    }

    /// @notice At maturity: receive the fixed payout. The shares return to TimaxArt's inventory.
    function redeem(uint256 noteId) external nonReentrant {
        Note storage n = _notes[noteId];
        if (n.status != 0) revert Settled();
        if (block.timestamp < n.maturity) revert NotMature();
        if (msg.sender != n.owner && block.timestamp < uint256(n.maturity) + GRACE) revert NotAllowed();
        Series storage s = _series[n.seriesId];
        n.status = 1;
        liabilities[address(s.quote)] -= n.payout; lockedShares[address(s.share)] -= n.shares;
        s.quote.safeTransfer(n.owner, n.payout);
        emit Redeemed(noteId, n.owner, n.payout);
    }

    /// @notice At maturity: keep the shares instead of the payout. Needs the wallet to still be verified.
    function takeShares(uint256 noteId) external nonReentrant {
        Note storage n = _notes[noteId];
        if (n.status != 0) revert Settled();
        if (msg.sender != n.owner) revert NotAllowed();
        if (block.timestamp < n.maturity) revert NotMature();
        Series storage s = _series[n.seriesId];
        n.status = 2;
        liabilities[address(s.quote)] -= n.payout; lockedShares[address(s.share)] -= n.shares;
        s.share.safeTransfer(n.owner, n.shares);
        emit SharesTaken(noteId, n.owner, n.shares);
    }
}
