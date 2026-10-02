// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {BSCV2TestBase} from "./BSCV2TestBase.sol";

/// @dev Independently stated wei outcomes, jointly run through the actual V2 bundle.
contract World50LandRewardsBSCV2Test is BSCV2TestBase {
    uint256 internal constant INPUT = 1_300_000_000_000_000_000;
    uint256 internal constant HALF = 650_000_000_000_000_000;
    function _expected(uint256 id) internal pure returns (uint256) {
        if (id == 1) return 60_000_000_000_000_000;
        if (id <= 6) return 30_000_000_000_000_000;
        return 10_000_000_000_000_000;
    }
    function _fund() internal {
        _buy(alice, 50); _donate(INPUT - 1); core.syncSurplus();
        assertEq(core.U0(), INPUT * B); assertEq(core.accountedBNB(), INPUT);
    }
    function test_OnePointThreeBNBNeutralTreasureAll50ThenWithdraw() public {
        _fund(); vm.warp(block.timestamp + T);
        (uint256 u, uint256 j) = core.checkpoint(); assertEq(u, HALF * B); assertEq(j, HALF * B);
        uint256 total;
        for (uint256 id = 1; id <= 50; ++id) {
            core.settleLand(id); (,,,, uint256 landJ) = core.lands(id); assertEq(landJ, 0);
            uint256 before_ = core.claimable(alice); assertTrue(_attack(alice, id, 1));
            assertEq(core.claimable(alice) - before_, _expected(id) * WB);
            _land(id, alice, S, 1); total += _expected(id); _assertAccounting();
        }
        assertEq(total, HALF); assertEq(token.totalSupply(), 0); assertEq(core.claimable(alice), HALF * WB);
        _withdraw(alice, HALF); assertEq(core.claimable(alice), 0);
        assertEq(core.accountedBNB(), HALF); assertEq(address(core).balance, HALF); _assertAccounting();
    }
    function test_OnePointThreeBNB50DistinctControllersSettledAndPaid() public {
        _fund();
        for (uint256 id = 1; id <= 50; ++id) {
            address owner = address(uint160(10000 + id)); actors.push(owner);
            _transfer(alice, owner, 1); _approve(owner, 1); assertTrue(_attack(owner, id, 1));
        }
        vm.warp(block.timestamp + T); (uint256 u, uint256 j) = core.checkpoint();
        assertEq(u, HALF * B); assertEq(j, HALF * B);
        uint256 total;
        for (uint256 id = 1; id <= 50; ++id) {
            address owner = address(uint160(10000 + id)); bytes32 anchor = _anchor(id);
            core.settleLand(id); assertEq(core.claimable(owner), _expected(id) * WB);
            uint256 before_ = owner.balance; _withdraw(owner, _expected(id));
            assertEq(owner.balance, before_ + _expected(id)); assertEq(core.claimable(owner), 0);
            assertEq(_anchor(id), anchor); total += _expected(id); _assertAccounting();
        }
        assertEq(total, HALF); assertEq(token.totalSupply(), 0);
        assertEq(core.accountedBNB(), HALF); assertEq(address(core).balance, HALF);
    }
    function test_WholeMapWithdrawalLaterNewIncomeUsesLiveTreasurySnapshot() public {
        _buy(alice, 50); _donate(99); core.syncSurplus();
        for (uint256 id = 1; id <= 50; ++id) _attack(alice, id, 1);
        vm.warp(block.timestamp + T);
        for (uint256 id = 1; id <= 50; ++id) core.settleLand(id);
        _withdraw(alice, 50); assertEq(core.U0(), 100 * B); assertEq(core.J0(), 0);
        vm.warp(block.timestamp + T); (uint256 u, uint256 j) = core.checkpoint();
        assertEq(u, 25 * B); assertEq(j, 75 * B);
        _donate(10); core.syncSurplus(); assertEq(core.U0(), 35 * B); assertEq(core.J0(), 75 * B);
        vm.warp(block.timestamp + T); (u, j) = core.checkpoint();
        assertEq(u, 35 * B / 2); assertEq(j, 185 * B / 2);
        for (uint256 id = 1; id <= 50; ++id) core.settleLand(id);
        assertEq(core.claimable(alice), 85 * WB / 2); _assertAccounting();
    }
}
