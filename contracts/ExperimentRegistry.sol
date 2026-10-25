// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Append-only, owner-attested paper-experiment commitments on Arc Testnet.
/// @dev No funds, token transfers, price oracle, trading execution or performance verification.
/// File commitments are SHA-256 of exact delivered UTF-8/binary bytes, not self-excluding
/// JSON content checksums. A record proves only that this owner submitted those commitments
/// by its block timestamp. Claimed price timestamps, fill contents and data quality remain
/// unverified owner statements. An owner can omit records or create another experiment.
contract ExperimentRegistry {
    uint256 public constant ARC_TESTNET_CHAIN_ID = 5042002;
    uint256 public nextExperimentId = 1;

    struct Experiment {
        address owner;
        bytes32 strategyFileSha256;
        bytes32 marketPolicyFileSha256;
        bytes32 experimentTermsFileSha256;
        uint64 registeredAt;
        uint64 entryCount;
        uint64 lastClaimedPriceTimestampMs;
        bytes32 lastEntryCommitment;
        bool isSealed;
        bytes32 finalReportFileSha256;
    }

    struct FillAttestation {
        bytes32 fillFileSha256;
        uint64 claimedPriceTimestampMs;
        uint64 recordedAt;
        bytes32 entryCommitment;
    }

    mapping(uint256 => Experiment) private _experiments;
    mapping(uint256 => mapping(uint64 => FillAttestation)) private _fills;
    mapping(uint256 => mapping(bytes32 => bool)) public recordedFillDigests;

    error WrongChain(uint256 actual);
    error MissingCommitment();
    error ExperimentNotFound();
    error NotExperimentOwner();
    error ExperimentSealed();
    error SequenceMismatch();
    error PreviousCommitmentMismatch();
    error DuplicateFillDigest();
    error InvalidClaimedPriceTimestamp();
    error EntryCountMismatch();
    error FillNotFound();

    event ExperimentRegistered(
        uint256 indexed experimentId,
        address indexed owner,
        bytes32 strategyFileSha256,
        bytes32 marketPolicyFileSha256,
        bytes32 experimentTermsFileSha256,
        uint64 registeredAt
    );
    event PaperFillAttested(
        uint256 indexed experimentId,
        uint64 indexed sequence,
        address indexed owner,
        bytes32 fillFileSha256,
        uint64 claimedPriceTimestampMs,
        uint64 recordedAt,
        bytes32 previousCommitment,
        bytes32 entryCommitment
    );
    event ExperimentReportSealed(
        uint256 indexed experimentId,
        address indexed owner,
        uint64 entryCount,
        bytes32 lastEntryCommitment,
        bytes32 finalReportFileSha256
    );

    modifier onTestnet() {
        if (block.chainid != ARC_TESTNET_CHAIN_ID) revert WrongChain(block.chainid);
        _;
    }

    constructor() {
        if (block.chainid != ARC_TESTNET_CHAIN_ID) revert WrongChain(block.chainid);
    }

    /// @param marketPolicyFileSha256 Provider/pair/quote/clock/data-terms policy file.
    /// This is not a commitment to a future market dataset or an authenticated price feed.
    function registerExperiment(
        bytes32 strategyFileSha256,
        bytes32 marketPolicyFileSha256,
        bytes32 experimentTermsFileSha256
    ) external onTestnet returns (uint256 experimentId) {
        if (
            strategyFileSha256 == bytes32(0) || marketPolicyFileSha256 == bytes32(0)
                || experimentTermsFileSha256 == bytes32(0)
        ) revert MissingCommitment();
        experimentId = nextExperimentId++;
        Experiment storage e = _experiments[experimentId];
        e.owner = msg.sender;
        e.strategyFileSha256 = strategyFileSha256;
        e.marketPolicyFileSha256 = marketPolicyFileSha256;
        e.experimentTermsFileSha256 = experimentTermsFileSha256;
        e.registeredAt = uint64(block.timestamp);
        emit ExperimentRegistered(
            experimentId,
            msg.sender,
            strategyFileSha256,
            marketPolicyFileSha256,
            experimentTermsFileSha256,
            e.registeredAt
        );
    }

    /// @notice Attest to a paper-fill file, preserving sequence and predecessor commitment.
    /// @dev The timestamp is explicitly owner-claimed, not supplied or authenticated by an oracle.
    /// It must be at/after the registration block's second, nondecreasing, and not
    /// beyond the current block's second. Block timestamps have second precision.
    /// Reusing an identical file digest within this experiment is rejected; this cannot detect
    /// semantically duplicate or falsified fills encoded with different bytes.
    function attestFill(
        uint256 experimentId,
        uint64 expectedSequence,
        bytes32 fillFileSha256,
        uint64 claimedPriceTimestampMs,
        bytes32 expectedPreviousCommitment
    ) external onTestnet {
        Experiment storage e = _ownedOpenExperiment(experimentId);
        if (expectedSequence != e.entryCount + 1) revert SequenceMismatch();
        if (expectedPreviousCommitment != e.lastEntryCommitment) revert PreviousCommitmentMismatch();
        if (fillFileSha256 == bytes32(0)) revert MissingCommitment();
        if (recordedFillDigests[experimentId][fillFileSha256]) revert DuplicateFillDigest();
        if (
            claimedPriceTimestampMs < uint256(e.registeredAt) * 1000
                || claimedPriceTimestampMs < e.lastClaimedPriceTimestampMs
                || claimedPriceTimestampMs >= (block.timestamp + 1) * 1000
        ) revert InvalidClaimedPriceTimestamp();

        bytes32 previous = e.lastEntryCommitment;
        bytes32 entryCommitment = keccak256(
            abi.encode(
                block.chainid,
                address(this),
                experimentId,
                expectedSequence,
                msg.sender,
                e.strategyFileSha256,
                fillFileSha256,
                claimedPriceTimestampMs,
                previous
            )
        );
        _fills[experimentId][expectedSequence] = FillAttestation({
            fillFileSha256: fillFileSha256,
            claimedPriceTimestampMs: claimedPriceTimestampMs,
            recordedAt: uint64(block.timestamp),
            entryCommitment: entryCommitment
        });
        recordedFillDigests[experimentId][fillFileSha256] = true;
        e.entryCount = expectedSequence;
        e.lastClaimedPriceTimestampMs = claimedPriceTimestampMs;
        e.lastEntryCommitment = entryCommitment;
        emit PaperFillAttested(
            experimentId,
            expectedSequence,
            msg.sender,
            fillFileSha256,
            claimedPriceTimestampMs,
            uint64(block.timestamp),
            previous,
            entryCommitment
        );
    }

    /// @notice Irreversibly stop appends and attach an owner-supplied final report file digest.
    /// This does not certify that the report matches the attestations or that it includes all activity.
    function sealExperiment(
        uint256 experimentId,
        uint64 expectedEntryCount,
        bytes32 expectedLastEntryCommitment,
        bytes32 finalReportFileSha256
    ) external onTestnet {
        Experiment storage e = _ownedOpenExperiment(experimentId);
        if (expectedEntryCount != e.entryCount) revert EntryCountMismatch();
        if (expectedLastEntryCommitment != e.lastEntryCommitment) revert PreviousCommitmentMismatch();
        if (finalReportFileSha256 == bytes32(0)) revert MissingCommitment();
        e.isSealed = true;
        e.finalReportFileSha256 = finalReportFileSha256;
        emit ExperimentReportSealed(
            experimentId, msg.sender, e.entryCount, e.lastEntryCommitment, finalReportFileSha256
        );
    }

    function getExperiment(uint256 experimentId) external view returns (Experiment memory) {
        return _getExperiment(experimentId);
    }

    function getFill(uint256 experimentId, uint64 sequence) external view returns (FillAttestation memory) {
        Experiment storage e = _getExperiment(experimentId);
        if (sequence == 0 || sequence > e.entryCount) revert FillNotFound();
        return _fills[experimentId][sequence];
    }

    function _getExperiment(uint256 experimentId) private view returns (Experiment storage e) {
        e = _experiments[experimentId];
        if (e.owner == address(0)) revert ExperimentNotFound();
    }

    function _ownedOpenExperiment(uint256 experimentId) private view returns (Experiment storage e) {
        e = _getExperiment(experimentId);
        if (e.owner != msg.sender) revert NotExperimentOwner();
        if (e.isSealed) revert ExperimentSealed();
    }
}
