// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Fixed-version software-use entitlements, paid directly to the seller in Arc USDC.
/// @dev Hashes are seller commitments to SHA-256 file digests, not proof of performance,
/// authorship, artifact availability, or exclusive ownership. No secret delivery is provided.
/// No trading deposits, performance payouts, platform custody, upgrade or license revocation.
contract StrategyLicenseMarket is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant ARC_MAINNET_CHAIN_ID = 5042;
    uint256 public constant ARC_TESTNET_CHAIN_ID = 5042002;
    address public constant USDC = 0x3600000000000000000000000000000000000000;
    uint8 public constant USDC_DECIMALS = 6;
    uint256 public immutable expectedChainId;
    uint256 public nextListingId = 1;

    struct Listing {
        address seller;
        bytes32 strategySha256;
        bytes32 reportSha256;
        bytes32 termsSha256;
        uint256 price6;
        string artifactURI;
        string reportURI;
        bool salesPaused;
    }

    struct Purchase {
        uint256 paidPrice6;
        uint256 purchasedAt;
    }

    mapping(uint256 => Listing) private _listings;
    mapping(uint256 => mapping(address => Purchase)) public purchases;

    error UnsupportedChain(uint256 chainId);
    error WrongChain(uint256 expected, uint256 actual);
    error WrongTokenDecimals(uint8 actual);
    error MissingCommitment();
    error InvalidURI();
    error InvalidPrice();
    error ListingNotFound();
    error NotSeller();
    error SalesPaused();
    error SelfPurchase();
    error AlreadyLicensed();
    error PriceMismatch();
    error StrategyMismatch();

    event ListingCreated(
        uint256 indexed listingId,
        address indexed seller,
        bytes32 strategySha256,
        bytes32 reportSha256,
        bytes32 termsSha256,
        uint256 price6,
        string artifactURI,
        string reportURI
    );
    event SalesPauseChanged(uint256 indexed listingId, address indexed seller, bool paused);
    event LicensePurchased(
        uint256 indexed listingId,
        address indexed buyer,
        address indexed seller,
        uint256 paidPrice6,
        bytes32 strategySha256,
        bytes32 reportSha256,
        bytes32 termsSha256
    );

    modifier onExpectedChain() {
        if (block.chainid != expectedChainId) revert WrongChain(expectedChainId, block.chainid);
        _;
    }

    /// @dev Arc native USDC has an optional ERC20 interface with six decimals at USDC.
    /// Native gas amounts use different precision; this contract accepts only ERC20 amounts.
    constructor(uint256 chainId) {
        if (chainId != ARC_MAINNET_CHAIN_ID && chainId != ARC_TESTNET_CHAIN_ID) {
            revert UnsupportedChain(chainId);
        }
        if (block.chainid != chainId) revert WrongChain(chainId, block.chainid);
        uint8 decimals = IERC20Metadata(USDC).decimals();
        if (decimals != USDC_DECIMALS) revert WrongTokenDecimals(decimals);
        expectedChainId = chainId;
    }

    /// @notice Register a new version. No field except sales availability can ever be edited.
    /// @param termsSha256 SHA-256 digest of the license terms provided with the artifact.
    function createListing(
        bytes32 strategySha256,
        bytes32 reportSha256,
        bytes32 termsSha256,
        uint256 price6,
        string calldata artifactURI,
        string calldata reportURI
    ) external onExpectedChain returns (uint256 listingId) {
        if (strategySha256 == bytes32(0) || reportSha256 == bytes32(0) || termsSha256 == bytes32(0)) {
            revert MissingCommitment();
        }
        if (price6 == 0) revert InvalidPrice();
        if (
            bytes(artifactURI).length == 0 || bytes(artifactURI).length > 2048 || bytes(reportURI).length == 0
                || bytes(reportURI).length > 2048
        ) revert InvalidURI();
        listingId = nextListingId++;
        _listings[listingId] = Listing({
            seller: msg.sender,
            strategySha256: strategySha256,
            reportSha256: reportSha256,
            termsSha256: termsSha256,
            price6: price6,
            artifactURI: artifactURI,
            reportURI: reportURI,
            salesPaused: false
        });
        emit ListingCreated(
            listingId, msg.sender, strategySha256, reportSha256, termsSha256, price6, artifactURI, reportURI
        );
    }

    /// @notice Pause or resume new purchases without changing any paid entitlement.
    function setSalesPaused(uint256 listingId, bool paused) external onExpectedChain {
        Listing storage listing = _getListing(listingId);
        if (listing.seller != msg.sender) revert NotSeller();
        listing.salesPaused = paused;
        emit SalesPauseChanged(listingId, msg.sender, paused);
    }

    /// @notice Acquire the listed version's software-use entitlement under its committed terms.
    /// @dev Buyer supplies the price and strategy digest reviewed by their client.
    /// USDC moves buyer -> seller; a failed payment rolls back the entitlement and event.
    function buyLicense(uint256 listingId, uint256 expectedPrice6, bytes32 expectedStrategySha256)
        external
        onExpectedChain
        nonReentrant
    {
        Listing storage listing = _getListing(listingId);
        if (listing.salesPaused) revert SalesPaused();
        if (listing.seller == msg.sender) revert SelfPurchase();
        if (hasLicense(listingId, msg.sender)) revert AlreadyLicensed();
        if (listing.price6 != expectedPrice6) revert PriceMismatch();
        if (listing.strategySha256 != expectedStrategySha256) revert StrategyMismatch();

        purchases[listingId][msg.sender] = Purchase(listing.price6, block.timestamp);
        IERC20(USDC).safeTransferFrom(msg.sender, listing.seller, listing.price6);
        emit LicensePurchased(
            listingId,
            msg.sender,
            listing.seller,
            listing.price6,
            listing.strategySha256,
            listing.reportSha256,
            listing.termsSha256
        );
    }

    function hasLicense(uint256 listingId, address buyer) public view returns (bool) {
        return purchases[listingId][buyer].paidPrice6 != 0;
    }

    function getListing(uint256 listingId) external view returns (Listing memory) {
        return _getListing(listingId);
    }

    function _getListing(uint256 listingId) private view returns (Listing storage listing) {
        listing = _listings[listingId];
        if (listing.seller == address(0)) revert ListingNotFound();
    }
}
