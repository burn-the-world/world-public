// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {WorldTokenBSCV2} from "../src/WorldTokenBSCV2.sol";
import {WorldCoreBSCV2} from "../src/WorldCoreBSCV2.sol";
import {WorldLandProfileBSCV2} from "../src/WorldLandProfileBSCV2.sol";
import {WorldDeploymentBSCV2} from "../src/WorldDeploymentBSCV2.sol";

/// @dev Used only to exercise constructor rejection; accepted tests use the real factory/Core.
contract ProfileCoreConfigurationFixtureV2 {
    uint256 public constant RESISTANCE_HALF_LIFE = 45 days;
    uint256 public constant WORLD_PRICE = 1e12;
    uint256 public constant TOKEN_UNIT = 1e18;
    uint256 public immutable N;
    uint256 public immutable W;
    uint256 public immutable T;
    WorldTokenBSCV2 public immutable token;

    constructor(uint256 n, uint256 w, uint256 t, WorldTokenBSCV2 token_) {
        N = n;
        W = w;
        T = t;
        token = token_;
    }
}

contract ProfileControllerFixtureV2 {
    WorldCoreBSCV2 private immutable core;
    address private immutable manager;

    constructor(WorldCoreBSCV2 core_, address manager_) {
        core = core_;
        manager = manager_;
    }

    function acquire(uint256 id, uint256 amount) external payable {
        require(msg.sender == manager, "fixture manager only");
        core.buyWorld{value: msg.value}(amount, address(this));
        core.token().approve(address(core), amount);
        (,,, uint256 epoch,) = core.lands(id);
        require(core.attack(id, epoch, amount), "fixture did not take LAND");
    }

    function edit(WorldLandProfileBSCV2 profile, uint256 id, uint256 epoch, string calldata name) external {
        require(msg.sender == manager, "fixture manager only");
        profile.setProfile(id, epoch, name, "", "");
    }

    function buyApproveDefendAndAttack(uint256 id, uint256 epoch, uint256 amount) external payable {
        require(msg.sender == manager, "fixture manager only");
        core.buyWorld{value: msg.value}(2 * amount, address(this));
        core.token().approve(address(core), 2 * amount);
        core.defend(id, epoch, amount);
        require(!core.attack(id, epoch, amount), "non-crossing fixture");
    }

    function settleAndWithdraw(uint256 id, uint256 amount) external {
        require(msg.sender == manager, "fixture manager only");
        core.settleLand(id);
        core.withdrawRewards(payable(manager), amount);
    }
}

contract UnavailableProfileFixtureV2 {
    fallback() external {
        revert("profile unavailable");
    }
}

contract WorldLandProfileBSCV2Test is Test {
    uint256 private constant Q = 1e18;
    WorldDeploymentBSCV2 private deployment;
    WorldTokenBSCV2 private token;
    WorldCoreBSCV2 private core;
    WorldLandProfileBSCV2 private profile;
    address private alice = makeAddr("profile alice");
    address private bob = makeAddr("profile bob");
    address private supporter = makeAddr("profile supporter");

    event ProfileUpdated(
        uint256 indexed landId,
        uint256 indexed epoch,
        address indexed controller,
        string name,
        string logoURI,
        string website
    );

    function setUp() public {
        vm.warp(1000);
        deployment = new WorldDeploymentBSCV2();
        token = deployment.token();
        core = deployment.core();
        profile = deployment.profile();
        vm.deal(address(this), 100 ether);
        address[3] memory actors = [alice, bob, supporter];
        for (uint256 i; i < actors.length; ++i) {
            vm.deal(actors[i], 100 ether);
            _buy(actors[i], 10_000 * Q);
            vm.prank(actors[i]);
            token.approve(address(core), type(uint256).max);
        }
    }

    function _buy(address buyer, uint256 amount) private {
        uint256 cost = core.quoteBuy(amount);
        vm.prank(buyer);
        core.buyWorld{value: cost}(amount, buyer);
    }

    function _attack(address who, uint256 id, uint256 amount) private returns (bool) {
        (,,, uint256 epoch,) = core.lands(id);
        vm.prank(who);
        return core.attack(id, epoch, amount);
    }

    function _captureAndWrite() private {
        assertTrue(_attack(alice, 8, 100 * Q));
        vm.prank(alice);
        profile.setProfile(8, 1, unicode"天才明", "ipfs://land-eight", "https://example.com");
    }

    function _assertCurrent(
        uint256 id,
        bool expectedValid,
        address expectedController,
        uint256 expectedEpoch,
        string memory expectedName,
        string memory expectedLogo,
        string memory expectedWebsite
    ) private view {
        (bool valid, address controller, uint256 epoch, string memory name, string memory logo, string memory website) =
            profile.getCurrentProfile(id);
        assertEq(valid, expectedValid, "profile validity");
        assertEq(controller, expectedController, "current Core controller");
        assertEq(epoch, expectedEpoch, "current Core epoch");
        assertEq(name, expectedName, "name");
        assertEq(logo, expectedLogo, "logoURI");
        assertEq(website, expectedWebsite, "website");
    }

    function _assertAliceProfile() private view {
        _assertCurrent(8, true, alice, 1, unicode"天才明", "ipfs://land-eight", "https://example.com");
    }

    function _repeat(string memory text, uint256 count) private pure returns (string memory) {
        bytes memory unit = bytes(text);
        bytes memory result = new bytes(unit.length * count);
        for (uint256 i; i < count; ++i) {
            for (uint256 j; j < unit.length; ++j) result[i * unit.length + j] = unit[j];
        }
        return string(result);
    }

    function _economicSnapshot() private view returns (bytes32 snapshot) {
        snapshot = keccak256(
            abi.encode(core.U0(), core.J0(), core.t0(), core.accountedBNB())
        );
        (uint256 u, uint256 j) = core.checkpoint();
        snapshot = keccak256(
            abi.encode(snapshot, u, j, address(core).balance, address(profile).balance, token.totalSupply(), token.balanceOf(address(core)))
        );
        for (uint256 id = 1; id <= core.N(); ++id) {
            (address controller, uint256 resistanceRaw, uint64 lastResistanceUpdate, uint256 epoch, uint256 landJ) = core.lands(id);
            snapshot = keccak256(abi.encode(snapshot, controller, resistanceRaw, lastResistanceUpdate, epoch, landJ));
        }
        address[4] memory actors = [alice, bob, supporter, address(profile)];
        for (uint256 i; i < actors.length; ++i) {
            snapshot = keccak256(
                abi.encode(
                    snapshot,
                    core.claimable(actors[i]),
                    token.balanceOf(actors[i]),
                    token.allowance(actors[i], address(core)),
                    token.allowance(actors[i], address(profile))
                )
            );
        }
    }

    function test_BindsRealFiftyLandCoreAndExposesByteLimits() public view {
        assertEq(address(profile.core()), address(core));
        assertEq(core.N(), 50);
        assertEq(core.W(), 65);
        assertEq(core.T(), 60 days);
        assertEq(address(core.token()), address(token));
        assertEq(token.core(), address(core));
        assertEq(profile.MAX_NAME_BYTES(), 64);
        assertEq(profile.MAX_LOGO_URI_BYTES(), 256);
        assertEq(profile.MAX_WEBSITE_BYTES(), 256);
    }

    function test_ConstructorRejectsZeroAndEOA() public {
        vm.expectRevert(WorldLandProfileBSCV2.InvalidCore.selector);
        new WorldLandProfileBSCV2(WorldCoreBSCV2(payable(address(0))));
        vm.expectRevert(WorldLandProfileBSCV2.InvalidCore.selector);
        new WorldLandProfileBSCV2(WorldCoreBSCV2(payable(alice)));
    }

    function test_ConstructorRejectsWrongMapOrHalfLife() public {
        ProfileCoreConfigurationFixtureV2 badN = new ProfileCoreConfigurationFixtureV2(300, 65, 60 days, token);
        ProfileCoreConfigurationFixtureV2 badW = new ProfileCoreConfigurationFixtureV2(50, 387, 60 days, token);
        ProfileCoreConfigurationFixtureV2 badT = new ProfileCoreConfigurationFixtureV2(50, 65, 59 days, token);
        address[3] memory invalid = [address(badN), address(badW), address(badT)];
        for (uint256 i; i < invalid.length; ++i) {
            vm.expectRevert(WorldLandProfileBSCV2.InvalidCore.selector);
            new WorldLandProfileBSCV2(WorldCoreBSCV2(payable(invalid[i])));
        }
    }

    function test_ConstructorRejectsMissingOrMismatchedTokenBinding() public {
        ProfileCoreConfigurationFixtureV2 noToken =
            new ProfileCoreConfigurationFixtureV2(50, 65, 60 days, WorldTokenBSCV2(alice));
        vm.expectRevert(WorldLandProfileBSCV2.InvalidCore.selector);
        new WorldLandProfileBSCV2(WorldCoreBSCV2(payable(address(noToken))));

        ProfileCoreConfigurationFixtureV2 wrongToken = new ProfileCoreConfigurationFixtureV2(50, 65, 60 days, token);
        vm.expectRevert(WorldLandProfileBSCV2.InvalidCore.selector);
        new WorldLandProfileBSCV2(WorldCoreBSCV2(payable(address(wrongToken))));
    }

    function test_UnsetNeutralAndControlledLandReturnCurrentCoreStateAndEmptyFields() public {
        _assertCurrent(8, false, address(0), 0, "", "", "");
        assertTrue(_attack(alice, 8, 100 * Q));
        _assertCurrent(8, false, alice, 1, "", "", "");
    }

    function test_CurrentControllerCanSetChineseNameAndRepeatUpdate() public {
        _captureAndWrite();
        _assertAliceProfile();
        vm.prank(alice);
        profile.setProfile(8, 1, unicode"新的名字😀", "https://example.com/new.svg", "https://example.org");
        _assertCurrent(8, true, alice, 1, unicode"新的名字😀", "https://example.com/new.svg", "https://example.org");
    }

    function test_ThirdPartySupporterFactoryAndDeployerHaveNoEditingPrivilege() public {
        _captureAndWrite();
        vm.prank(supporter);
        core.defend(8, 1, Q);
        address[4] memory rejected = [bob, supporter, address(deployment), address(this)];
        for (uint256 i; i < rejected.length; ++i) {
            vm.expectRevert(abi.encodeWithSelector(WorldLandProfileBSCV2.NotController.selector, rejected[i], alice));
            vm.prank(rejected[i]);
            profile.setProfile(8, 1, "unauthorized", "", "");
        }
        _assertAliceProfile();
    }

    function test_NeutralLandCannotBeEdited() public {
        vm.expectRevert(WorldLandProfileBSCV2.NeutralLand.selector);
        vm.prank(alice);
        profile.setProfile(8, 0, "neutral", "", "");
        _assertCurrent(8, false, address(0), 0, "", "", "");
    }

    function test_InvalidZeroFiftyOneAndThreeHundredRejectedByBothProfileEntries() public {
        uint256[3] memory invalid = [uint256(0), 51, 300];
        for (uint256 i; i < invalid.length; ++i) {
            vm.expectRevert(WorldLandProfileBSCV2.InvalidLand.selector);
            vm.prank(alice);
            profile.setProfile(invalid[i], 0, "invalid", "", "");
            vm.expectRevert(WorldLandProfileBSCV2.InvalidLand.selector);
            profile.getCurrentProfile(invalid[i]);
        }
    }

    function test_LegalLandBoundariesIncludingFiftyAreEditable() public {
        uint256[5] memory ids = [uint256(1), 2, 6, 7, 50];
        for (uint256 i; i < ids.length; ++i) {
            assertTrue(_attack(alice, ids[i], Q));
            vm.prank(alice);
            profile.setProfile(ids[i], 1, "legal", "", "");
            _assertCurrent(ids[i], true, alice, 1, "legal", "", "");
        }
    }

    function test_StaleAndFutureExpectedEpochRevertWithoutReplacingProfile() public {
        _captureAndWrite();
        vm.expectRevert(abi.encodeWithSelector(WorldLandProfileBSCV2.StaleEpoch.selector, 0, 1));
        vm.prank(alice);
        profile.setProfile(8, 0, "stale", "", "");
        vm.expectRevert(abi.encodeWithSelector(WorldLandProfileBSCV2.StaleEpoch.selector, 2, 1));
        vm.prank(alice);
        profile.setProfile(8, 2, "future", "", "");
        _assertAliceProfile();
    }

    function test_TakeoverInvalidatesImmediatelyAndOldControllerCannotEdit() public {
        _captureAndWrite();
        assertTrue(_attack(bob, 8, 101 * Q));
        _assertCurrent(8, false, bob, 2, "", "", "");
        vm.expectRevert(abi.encodeWithSelector(WorldLandProfileBSCV2.NotController.selector, alice, bob));
        vm.prank(alice);
        profile.setProfile(8, 1, "old controller", "", "");
        vm.prank(bob);
        profile.setProfile(8, 2, "Bob", "", "");
        _assertCurrent(8, true, bob, 2, "Bob", "", "");
    }

    function test_RecaptureBySameAddressDoesNotReviveOldEpoch() public {
        _captureAndWrite();
        assertTrue(_attack(bob, 8, 101 * Q));
        assertTrue(_attack(alice, 8, 2 * Q));
        _assertCurrent(8, false, alice, 3, "", "", "");
        vm.prank(alice);
        profile.setProfile(8, 3, "New reign", "", "");
        _assertCurrent(8, true, alice, 3, "New reign", "", "");
    }

    function test_SelfAttackAcrossGapCreatesNewEpochAndInvalidates() public {
        _captureAndWrite();
        assertTrue(_attack(alice, 8, 101 * Q));
        _assertCurrent(8, false, alice, 2, "", "", "");
    }

    function test_NaturalResistanceDecayAndProfileEditDoNotReanchorOrInvalidate() public {
        _captureAndWrite();
        (, uint256 stored, uint64 anchored,,) = core.lands(8);
        vm.warp(block.timestamp + 45 days);
        assertEq(core.currentResistanceRaw(8), stored / 2);
        _assertAliceProfile();
        vm.prank(alice);
        profile.setProfile(8, 1, "after decay", "", "");
        (, uint256 afterRaw, uint64 afterAnchor,,) = core.lands(8);
        assertEq(afterRaw, stored);
        assertEq(afterAnchor, anchored);
        _assertCurrent(8, true, alice, 1, "after decay", "", "");
    }

    function test_EqualGapUnderGapAndThirdPartyDefensePreserveProfile() public {
        _captureAndWrite();
        assertFalse(_attack(bob, 8, 100 * Q));
        _assertAliceProfile();
        vm.prank(supporter);
        core.defend(8, 1, 7 * Q);
        _assertAliceProfile();
        assertFalse(_attack(bob, 8, 3 * Q));
        _assertAliceProfile();
    }

    function test_SettlementWithdrawalAndIncomeSyncPreserveProfile() public {
        _captureAndWrite();
        vm.warp(block.timestamp + 60 days);
        core.settleLand(8);
        assertGt(core.claimable(alice) / (core.W() * core.B()), 0);
        vm.prank(alice);
        core.withdrawRewards(payable(alice), 1);
        (bool sent,) = address(core).call{value: 1}("");
        assertTrue(sent);
        core.syncSurplus();
        _assertAliceProfile();
    }

    function test_EmptyFieldsAndFullClearRemainValidForCurrentEpoch() public {
        _captureAndWrite();
        vm.prank(alice);
        profile.setProfile(8, 1, "", "", "https://example.org");
        _assertCurrent(8, true, alice, 1, "", "", "https://example.org");
        vm.prank(alice);
        profile.setProfile(8, 1, "", "", "");
        _assertCurrent(8, true, alice, 1, "", "", "");
        assertTrue(_attack(bob, 8, 101 * Q));
        _assertCurrent(8, false, bob, 2, "", "", "");
    }

    function test_ByteLimitsAcceptExactChineseEmojiAndUriBoundariesAndEmitAllFields() public {
        assertTrue(_attack(alice, 8, Q));
        string memory name = string.concat(_repeat(unicode"天", 21), "a");
        string memory logo = _repeat(unicode"😀", 64);
        string memory website = _repeat("w", 256);
        assertEq(bytes(name).length, 64);
        assertEq(bytes(logo).length, 256);
        assertEq(bytes(website).length, 256);
        vm.expectEmit(true, true, true, true, address(profile));
        emit ProfileUpdated(8, 1, alice, name, logo, website);
        vm.prank(alice);
        profile.setProfile(8, 1, name, logo, website);
        _assertCurrent(8, true, alice, 1, name, logo, website);

        name = _repeat(unicode"😀", 16);
        assertEq(bytes(name).length, 64);
        vm.prank(alice);
        profile.setProfile(8, 1, name, "", "");
        _assertCurrent(8, true, alice, 1, name, "", "");
    }

    function test_OverByteLimitsRevertAtomicallyIncludingChineseAndEmoji() public {
        _captureAndWrite();
        string memory chineseTooLong = string.concat(_repeat(unicode"天", 21), "ab");
        string memory emojiTooLong = string.concat(_repeat(unicode"😀", 16), "a");
        assertEq(bytes(chineseTooLong).length, 65);
        assertEq(bytes(emojiTooLong).length, 65);
        vm.expectRevert(WorldLandProfileBSCV2.NameTooLong.selector);
        vm.prank(alice);
        profile.setProfile(8, 1, chineseTooLong, "", "");
        vm.expectRevert(WorldLandProfileBSCV2.NameTooLong.selector);
        vm.prank(alice);
        profile.setProfile(8, 1, emojiTooLong, "", "");
        string memory longUri = _repeat("u", 257);
        vm.expectRevert(WorldLandProfileBSCV2.LogoURITooLong.selector);
        vm.prank(alice);
        profile.setProfile(8, 1, "changed", longUri, "");
        vm.expectRevert(WorldLandProfileBSCV2.WebsiteTooLong.selector);
        vm.prank(alice);
        profile.setProfile(8, 1, "changed", "", longUri);
        _assertAliceProfile();
    }

    function test_TwoLandsAreIndependentAndNamesNeedNotBeUnique() public {
        _captureAndWrite();
        assertTrue(_attack(bob, 9, 100 * Q));
        vm.prank(bob);
        profile.setProfile(9, 1, unicode"天才明", "other logo", "other site");
        vm.prank(alice);
        profile.setProfile(8, 1, "changed only eight", "", "");
        _assertCurrent(9, true, bob, 1, unicode"天才明", "other logo", "other site");
        assertTrue(_attack(bob, 8, 101 * Q));
        _assertCurrent(8, false, bob, 2, "", "", "");
        _assertCurrent(9, true, bob, 1, unicode"天才明", "other logo", "other site");
    }

    function test_FreeUpdateNeedsNoWorldBalanceOrAllowanceAndRejectsAttachedBNB() public {
        _captureAndWrite();
        vm.startPrank(alice);
        token.transfer(bob, token.balanceOf(alice));
        token.approve(address(core), 0);
        assertEq(token.balanceOf(alice), 0);
        assertEq(token.allowance(alice, address(profile)), 0);
        profile.setProfile(8, 1, "no WORLD required", "", "");
        (bool success,) = address(profile).call{value: 1}(
            abi.encodeCall(profile.setProfile, (8, 1, "must not replace", "", ""))
        );
        assertFalse(success, "nonpayable update accepted BNB");
        vm.stopPrank();
        assertEq(address(profile).balance, 0);
        _assertCurrent(8, true, alice, 1, "no WORLD required", "", "");
    }

    function test_ThirdPartyContractReallyAcquiresLandAndCallsAsController() public {
        ProfileControllerFixtureV2 controller = new ProfileControllerFixtureV2(core, alice);
        uint256 cost = core.quoteBuy(100 * Q);
        vm.prank(alice, alice);
        controller.acquire{value: cost}(8, 100 * Q);
        (address landController,,, uint256 epoch,) = core.lands(8);
        assertEq(landController, address(controller));
        assertEq(epoch, 1);
        vm.expectRevert(abi.encodeWithSelector(WorldLandProfileBSCV2.NotController.selector, alice, address(controller)));
        vm.prank(alice, alice);
        profile.setProfile(8, 1, "manager is not controller", "", "");
        vm.prank(alice, alice);
        controller.edit(profile, 8, 1, "contract controller");
        _assertCurrent(8, true, address(controller), 1, "contract controller", "", "");
        assertEq(token.allowance(address(controller), address(profile)), 0);
    }

    function test_ThirdPartyContractFullBuyBurnDefenseAttackRewardsAndProfileLifecycle() public {
        ProfileControllerFixtureV2 controller = new ProfileControllerFixtureV2(core, alice);
        uint256 acquireCost = core.quoteBuy(100 * Q);
        vm.prank(alice, alice);
        controller.acquire{value: acquireCost}(8, 100 * Q);
        vm.prank(alice, alice);
        controller.edit(profile, 8, 1, "contract lifecycle");
        uint256 warCost = core.quoteBuy(2 * Q);
        uint256 supplyBefore = token.totalSupply();
        vm.prank(alice, alice);
        controller.buyApproveDefendAndAttack{value: warCost}(8, 1, Q);
        assertEq(token.totalSupply(), supplyBefore);
        assertEq(token.balanceOf(address(controller)), 0);
        assertEq(token.allowance(address(controller), address(core)), 0);
        assertEq(core.currentResistanceRaw(8), 100 * Q << 64);
        _assertCurrent(8, true, address(controller), 1, "contract lifecycle", "", "");
        vm.warp(block.timestamp + 60 days);
        uint256 bnbBefore = alice.balance;
        vm.prank(alice, alice);
        controller.settleAndWithdraw(8, 1);
        assertEq(alice.balance, bnbBefore + 1);
        _assertCurrent(8, true, address(controller), 1, "contract lifecycle", "", "");
    }

    function test_UpdatingProfileDoesNotTouchAnyCoreOrTokenAccounting() public {
        assertTrue(_attack(alice, 8, 100 * Q));
        vm.warp(block.timestamp + 60 days);
        core.settleLand(8);
        vm.warp(block.timestamp + 1 days);
        (bool sent,) = address(core).call{value: 1}("");
        assertTrue(sent);
        bytes32 before_ = _economicSnapshot();
        vm.prank(alice);
        profile.setProfile(8, 1, unicode"天才明", "https://example.com/logo.svg", "https://example.com");
        assertEq(_economicSnapshot(), before_, "profile changed Core/token/claimable at same timestamp");
        vm.prank(alice);
        profile.setProfile(8, 1, "", "", "");
        assertEq(_economicSnapshot(), before_, "clear changed economic state");
    }

    function test_CoreStillOperatesWhenProfileIsUnavailable() public {
        UnavailableProfileFixtureV2 unavailable = new UnavailableProfileFixtureV2();
        vm.etch(address(profile), address(unavailable).code);
        _buy(alice, Q);
        assertTrue(_attack(alice, 8, 100 * Q));
        vm.prank(supporter);
        core.defend(8, 1, Q);
        vm.warp(block.timestamp + 60 days);
        core.settleLand(8);
        vm.prank(alice);
        core.withdrawRewards(payable(alice), 1);
        assertTrue(_attack(bob, 8, 102 * Q));
        (address controller,,, uint256 epoch,) = core.lands(8);
        assertEq(controller, bob);
        assertEq(epoch, 2);
    }

    function test_NoSetCoreAdminEditingOrMintPermission() public {
        (bool setCore,) = address(profile).call(abi.encodeWithSignature("setCore(address)", alice));
        (bool changeCore,) = address(profile).call(abi.encodeWithSignature("changeCore(address)", alice));
        (bool setOwner,) = address(profile).call(abi.encodeWithSignature("transferOwnership(address)", alice));
        assertFalse(setCore);
        assertFalse(changeCore);
        assertFalse(setOwner);
        assertEq(address(profile.core()), address(core));
        vm.expectRevert(abi.encodeWithSelector(WorldTokenBSCV2.UnauthorizedMinter.selector, address(profile)));
        vm.prank(address(profile));
        token.mint(alice, Q);
    }
}
