// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface IKycSource { function kyc(address user) external view returns (bool); }

/// @notice Fixed-supply fractional share of one artwork (18 decimals). Whole supply is minted to `treasury`.
/// Transfers are restricted: the receiver must be KYC-approved on the ArtPoolHook, or be an exempt address
/// (PoolManager, Morpho Blue, treasury, Safe). This closes the gap where shares could be sent OTC to unverified wallets.
contract ArtShare is ERC20 {
    string public artworkURI; // ipfs:// or https:// metadata of the artwork (image, optional video via animation_url)
    bool public artworkLocked; // once true, artworkURI can never change again
    IKycSource public immutable kycSource;
    address public admin;
    address public pendingAdmin;
    mapping(address => bool) public exempt;

    error NotAdmin();
    error ReceiverNotApproved(address to);
    error ArtworkIsLocked();

    event ExemptSet(address indexed account, bool ok);
    event ArtworkURISet(string uri);
    event ArtworkLockedForever();

    constructor(
        string memory name_, string memory symbol_, string memory artworkURI_,
        uint256 supply, address treasury, address kycSource_, address admin_, address[] memory infra
    ) ERC20(name_, symbol_) {
        artworkURI = artworkURI_;
        emit ArtworkURISet(artworkURI_);
        kycSource = IKycSource(kycSource_);
        admin = admin_;
        exempt[treasury] = true;
        exempt[admin_] = true;
        for (uint256 i; i < infra.length; i++) exempt[infra[i]] = true;
        _mint(treasury, supply);
    }

    function setExempt(address account, bool ok) external {
        if (msg.sender != admin) revert NotAdmin();
        exempt[account] = ok;
        emit ExemptSet(account, ok);
    }

    /// @notice Admin (the Safe) can replace the artwork link, e.g. a better photo or a new video. Every change is logged.
    function setArtworkURI(string calldata uri) external {
        if (msg.sender != admin) revert NotAdmin();
        if (artworkLocked) revert ArtworkIsLocked();
        artworkURI = uri;
        emit ArtworkURISet(uri);
    }

    /// @notice Irreversible: after this the artwork link is fixed for good (investor-friendly once the final media is published).
    function lockArtwork() external {
        if (msg.sender != admin) revert NotAdmin();
        artworkLocked = true;
        emit ArtworkLockedForever();
    }

    function transferAdmin(address next) external { if (msg.sender != admin) revert NotAdmin(); pendingAdmin = next; }
    function acceptAdmin() external { require(msg.sender == pendingAdmin, "not pending"); admin = msg.sender; pendingAdmin = address(0); }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0) && !exempt[to] && !kycSource.kyc(to)) revert ReceiverNotApproved(to);
        super._update(from, to, value);
    }
}
