// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {StdStorage, stdStorage} from "forge-std/StdStorage.sol";
import {WorldTokenBSCV2} from "../src/WorldTokenBSCV2.sol";
import {WorldCoreBSCV2} from "../src/WorldCoreBSCV2.sol";
import {WorldLandProfileBSCV2} from "../src/WorldLandProfileBSCV2.sol";
import {WorldDeploymentBSCV2} from "../src/WorldDeploymentBSCV2.sol";

/// @dev Local test participant. Protocol sees this contract as the actor, never tx.origin.
contract BSCV2Participant {
    WorldCoreBSCV2 public immutable core;
    WorldTokenBSCV2 public immutable token;
    WorldLandProfileBSCV2 public immutable profile;
    constructor(WorldCoreBSCV2 c, WorldTokenBSCV2 t, WorldLandProfileBSCV2 p) {
        core = c; token = t; profile = p;
    }
    receive() external payable {}
    function buy(uint256 q) external { core.buyWorld{value: core.quoteBuy(q)}(q, address(this)); }
    function approve(uint256 q) external { token.approve(address(core), q); }
    function attack(uint256 id, uint256 e, uint256 q) external returns (bool) { return core.attack(id, e, q); }
    function defend(uint256 id, uint256 e, uint256 q) external { core.defend(id, e, q); }
    function settle(uint256 id) external { core.settleLand(id); }
    function withdraw(uint256 q) external { core.withdrawRewards(payable(address(this)), q); }
    function edit(uint256 id, uint256 e) external { profile.setProfile(id, e, "contract land", "", ""); }
    function transfer(address to, uint256 q) external { token.transfer(to, q); }
    function burn(uint256 q) external { token.burn(q); }
    function attackThenFail(uint256 id, uint256 e, uint256 q) external {
        core.attack(id, e, q);
        revert("later local transaction step failed");
    }
}

abstract contract BSCV2TestBase is Test {
    using stdStorage for StdStorage;
    uint256 internal constant Q = 1e18;
    uint256 internal constant S = 1 << 64;
    uint256 internal constant B = 1 << 96;
    uint256 internal constant W = 65;
    uint256 internal constant WB = W * B;
    uint256 internal constant H = 45 days;
    uint256 internal constant T = 60 days;
    WorldTokenBSCV2 internal token;
    WorldCoreBSCV2 internal core;
    WorldLandProfileBSCV2 internal profile;
    BSCV2Participant internal participant;
    address internal alice = makeAddr("V2 alice");
    address internal bob = makeAddr("V2 bob");
    address internal carol = makeAddr("V2 carol");
    address[] internal actors;

    function setUp() public virtual {
        vm.warp(1_000_000);
        WorldDeploymentBSCV2 deployment = new WorldDeploymentBSCV2();
        token = deployment.token(); core = deployment.core(); profile = deployment.profile();
        participant = new BSCV2Participant(core, token, profile);
        actors.push(alice); actors.push(bob); actors.push(carol); actors.push(address(participant));
        vm.deal(address(this), 100 ether);
        for (uint256 i; i < actors.length; ++i) {
            vm.deal(actors[i], 100 ether);
            _approve(actors[i], type(uint256).max);
        }
    }
    function _approve(address who, uint256 q) internal {
        if (who == address(participant)) participant.approve(q);
        else { vm.prank(who); token.approve(address(core), q); }
    }
    function _buy(address who, uint256 q) internal {
        if (who == address(participant)) participant.buy(q);
        else { uint256 cost = core.quoteBuy(q); vm.prank(who); core.buyWorld{value: cost}(q, who); }
    }
    function _attack(address who, uint256 id, uint256 q) internal returns (bool) {
        (,,, uint256 e,) = core.lands(id);
        if (who == address(participant)) return participant.attack(id, e, q);
        vm.prank(who); return core.attack(id, e, q);
    }
    function _defend(address who, uint256 id, uint256 q) internal {
        (,,, uint256 e,) = core.lands(id);
        if (who == address(participant)) participant.defend(id, e, q);
        else { vm.prank(who); core.defend(id, e, q); }
    }
    function _withdraw(address who, uint256 q) internal {
        if (who == address(participant)) participant.withdraw(q);
        else { vm.prank(who); core.withdrawRewards(payable(who), q); }
    }
    function _edit(address who, uint256 id) internal {
        (,,, uint256 e,) = core.lands(id);
        if (who == address(participant)) participant.edit(id, e);
        else { vm.prank(who); profile.setProfile(id, e, "wallet land", "", ""); }
    }
    function _transfer(address who, address to, uint256 q) internal {
        if (who == address(participant)) participant.transfer(to, q);
        else { vm.prank(who); token.transfer(to, q); }
    }
    function _burn(address who, uint256 q) internal {
        if (who == address(participant)) participant.burn(q);
        else { vm.prank(who); token.burn(q); }
    }
    function _donate(uint256 q) internal {
        (bool ok,) = address(core).call{value: q}(""); assertTrue(ok);
    }
    function _land(uint256 id, address owner, uint256 raw, uint256 e) internal view {
        (address a, uint256 r,, uint256 epoch,) = core.lands(id);
        assertEq(a, owner, "land controller"); assertEq(r, raw, "stored resistance"); assertEq(epoch, e, "land epoch");
    }
    function _anchor(uint256 id) internal view returns (bytes32) {
        (, uint256 raw, uint64 time,,) = core.lands(id); return keccak256(abi.encode(raw, time));
    }
    function _warState() internal view returns (bytes32 h) {
        for (uint256 id = 1; id <= 50; ++id) {
            (address a, uint256 r, uint64 t, uint256 e,) = core.lands(id);
            h = keccak256(abi.encode(h, a, r, t, e));
        }
    }
    function _snapshot() internal view returns (bytes32 h) {
        h = keccak256(abi.encode(core.U0(), core.J0(), core.t0(), core.accountedBNB(), address(core).balance,
            token.totalSupply(), token.balanceOf(address(core)), address(this).balance));
        for (uint256 id = 1; id <= 50; ++id) {
            (address a, uint256 r, uint64 t, uint256 e, uint256 j) = core.lands(id);
            (bool valid, address pc, uint256 pe, string memory n, string memory l, string memory w) = profile.getCurrentProfile(id);
            h = keccak256(abi.encode(h, a, r, t, e, j, valid, pc, pe, n, l, w));
        }
        for (uint256 i; i < actors.length; ++i) {
            address a = actors[i];
            h = keccak256(abi.encode(h, a.balance, token.balanceOf(a), token.allowance(a, address(core)), core.claimable(a)));
        }
    }
    function _assertAccounting() internal view {
        (uint256 u, uint256 j) = core.checkpoint();
        uint256 liability; uint256 weights; uint256 balances = token.balanceOf(address(core));
        for (uint256 id = 1; id <= 50; ++id) {
            (address owner, uint256 raw, uint64 t, uint256 e, uint256 landJ) = core.lands(id);
            weights += core.weightOf(id);
            liability += core.weightOf(id) * (j - landJ);
            assertLt(raw, uint256(1) << 192, "explicit resistance domain");
            if (owner == address(0)) {
                assertEq(raw, 0); assertEq(t, 0); assertEq(e, 0); assertEq(landJ, 0);
            } else { assertGt(e, 0); assertLe(t, block.timestamp); }
        }
        for (uint256 i; i < actors.length; ++i) {
            liability += core.claimable(actors[i]); balances += token.balanceOf(actors[i]);
        }
        assertEq(weights, 65);
        assertEq(liability, 65 * (core.accountedBNB() * B - u), "all-land BNB numerator conservation");
        assertGe(address(core).balance, core.accountedBNB(), "BNB coverage");
        assertEq(balances, token.totalSupply(), "supply equals actual balances, excludes walls");
    }
    function _assertFail(address caller, bytes memory data, uint256 value) internal {
        bytes32 before_ = _snapshot();
        vm.prank(caller); (bool ok,) = address(core).call{value: value}(data);
        assertFalse(ok, "expected local rejection"); assertEq(_snapshot(), before_, "atomic rollback");
    }
}
