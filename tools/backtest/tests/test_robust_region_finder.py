"""
Unit tests for robust_region_finder.py

Tests:
1. DD penalty curve (gentle at 30%, brutal at 60%)
2. Stress lane simulation
3. Median vs mean TestR
4. Parameter island clustering
5. Gate checks
"""

import sys
from pathlib import Path

# Add lib to path
sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest
from lib.robust_region_finder import (
    DDPenaltyConfig,
    compute_dd_penalty_robust,
    StressConfig,
    simulate_stress_r,
    FoldResult,
    RobustObjectiveConfig,
    compute_robust_objective,
    cluster_parameters,
    ParameterIsland,
)


class TestDDPenalty:
    """Test exponential DD penalty curve."""
    
    def test_no_penalty_below_gentle_threshold(self):
        """DD <= 30% should have zero penalty."""
        config = DDPenaltyConfig(gentle_threshold=0.30, brutal_threshold=0.60)
        
        for dd in [0.0, 0.10, 0.20, 0.25, 0.29, 0.30]:
            penalty, category = config.compute(dd)
            assert penalty == 0.0, f"Expected 0 penalty for {dd:.0%} DD"
            assert category == "clean", f"Expected 'clean' for {dd:.0%} DD"
    
    def test_gentle_penalty_between_30_45(self):
        """DD between 30-45% should have gentle (small) penalty."""
        config = DDPenaltyConfig(gentle_threshold=0.30, brutal_threshold=0.60, penalty_at_brutal=20.0)
        
        penalty_35, cat_35 = config.compute(0.35)
        penalty_40, cat_40 = config.compute(0.40)
        penalty_45, cat_45 = config.compute(0.45)
        
        # Penalties should be small but increasing
        assert 0 < penalty_35 < penalty_40 < penalty_45
        assert cat_35 == "acceptable"
        assert cat_40 == "acceptable"
        assert cat_45 == "acceptable"
        
        # At 45% (halfway), penalty should be much less than penalty_at_brutal
        assert penalty_45 < 10.0, f"Penalty at 45% too high: {penalty_45}"
    
    def test_aggressive_penalty_between_45_60(self):
        """DD between 45-60% should have aggressive (steep) penalty."""
        config = DDPenaltyConfig(gentle_threshold=0.30, brutal_threshold=0.60, penalty_at_brutal=20.0)
        
        penalty_50, cat_50 = config.compute(0.50)
        penalty_55, cat_55 = config.compute(0.55)
        penalty_59, cat_59 = config.compute(0.59)
        
        # Penalties should be significant and steeply increasing
        assert penalty_50 < penalty_55 < penalty_59
        assert cat_50 == "risky"
        assert cat_55 == "risky"
        
        # At 59%, penalty should approach penalty_at_brutal (20)
        assert penalty_59 > 10.0, f"59% DD penalty too low: {penalty_59}"
        assert penalty_59 < 25.0, f"59% DD penalty too high: {penalty_59}"
    
    def test_disqualified_above_brutal_threshold(self):
        """DD > 60% should be disqualified with heavy penalty."""
        config = DDPenaltyConfig(gentle_threshold=0.30, brutal_threshold=0.60)
        
        penalty_61, cat_61 = config.compute(0.61)
        penalty_65, cat_65 = config.compute(0.65)
        
        assert cat_61 == "disqualified"
        assert cat_65 == "disqualified"
        assert penalty_61 > 20.0, f"Disqualified penalty too low: {penalty_61}"
    
    def test_nuclear_above_70(self):
        """DD > 70% should be nuclear (max penalty)."""
        config = DDPenaltyConfig(gentle_threshold=0.30, brutal_threshold=0.60, nuclear_threshold=0.70)
        
        penalty_75, cat_75 = config.compute(0.75)
        penalty_90, cat_90 = config.compute(0.90)
        
        assert cat_75 == "nuclear"
        assert cat_90 == "nuclear"
        assert penalty_75 == config.max_penalty
        assert penalty_90 == config.max_penalty
    
    def test_penalty_curve_is_monotonic(self):
        """Penalty should always increase with DD."""
        config = DDPenaltyConfig()
        
        prev_penalty = 0.0
        for dd_pct in range(0, 70, 1):
            dd = dd_pct / 100.0
            penalty, _ = config.compute(dd)
            assert penalty >= prev_penalty, f"Penalty decreased at {dd:.0%}"
            prev_penalty = penalty
    
    def test_robust_dd_penalty_uses_worse_of_median_p75(self):
        """compute_dd_penalty_robust should penalize fat tails."""
        config = DDPenaltyConfig()
        
        # Case 1: Low median, low p75
        penalty1, cat1, _ = compute_dd_penalty_robust(0.25, 0.30, config)
        
        # Case 2: Low median, high p75
        penalty2, cat2, _ = compute_dd_penalty_robust(0.25, 0.55, config)
        
        # Case 2 should have higher penalty due to fat tail
        assert penalty2 > penalty1, "Fat tail should increase penalty"
        assert cat2 == "risky"  # Worst category


class TestStressLane:
    """Test stress lane simulation."""
    
    def test_stress_reduces_r(self):
        """Stress should always reduce R."""
        config = StressConfig(slippage_mult=2.0, stop_gap_prob=0.15, stop_gap_mult=1.5)
        
        base_test_r = 10.0
        stressed_r, breakdown = simulate_stress_r(
            base_test_r=base_test_r,
            avg_r=0.5,
            win_rate=0.40,
            n_trades=100,
            avg_r_loss=-1.0,
            config=config,
        )
        
        assert stressed_r < base_test_r, "Stress should reduce R"
        assert breakdown["total_stress_hit"] > 0
    
    def test_stress_scales_with_trades(self):
        """More trades = more stress impact."""
        config = StressConfig()
        
        _, breakdown_10 = simulate_stress_r(10.0, 0.5, 0.40, 10, -1.0, config)
        _, breakdown_100 = simulate_stress_r(10.0, 0.5, 0.40, 100, -1.0, config)
        
        assert breakdown_100["total_stress_hit"] > breakdown_10["total_stress_hit"]
    
    def test_slippage_impact(self):
        """Higher slippage multiplier = bigger hit."""
        config_1x = StressConfig(slippage_mult=1.0, stop_gap_prob=0.0)
        config_3x = StressConfig(slippage_mult=3.0, stop_gap_prob=0.0)
        
        _, breakdown_1x = simulate_stress_r(10.0, 0.5, 0.40, 100, -1.0, config_1x)
        _, breakdown_3x = simulate_stress_r(10.0, 0.5, 0.40, 100, -1.0, config_3x)
        
        assert breakdown_3x["slippage_hit_r"] > breakdown_1x["slippage_hit_r"]
    
    def test_stop_gap_impact(self):
        """Stop gaps increase losses."""
        config_no_gap = StressConfig(slippage_mult=1.0, stop_gap_prob=0.0)
        config_with_gap = StressConfig(slippage_mult=1.0, stop_gap_prob=0.30, stop_gap_mult=2.0)
        
        _, breakdown_no = simulate_stress_r(10.0, 0.5, 0.40, 100, -1.0, config_no_gap)
        _, breakdown_with = simulate_stress_r(10.0, 0.5, 0.40, 100, -1.0, config_with_gap)
        
        assert breakdown_no["stop_gap_hit_r"] == 0.0
        assert breakdown_with["stop_gap_hit_r"] > 0


class TestRobustObjective:
    """Test the robust objective function."""
    
    def _make_fold_results(self, test_rs: list, train_rs: list = None) -> list:
        """Create fold results for testing."""
        if train_rs is None:
            train_rs = [r * 1.5 for r in test_rs]  # Default: train is 1.5x test
        
        return [
            FoldResult(
                fold_name=f"fold_{i}",
                train_r=train_rs[i],
                test_r=test_rs[i],
                avg_r=test_rs[i] / 10.0,
                win_rate=0.40,
                n_trades=50,
                avg_r_loss=-1.0,
                median_dd_pre2x=0.25,
                p75_dd_pre2x=0.35,
                hit2x_pct=0.40,
            )
            for i in range(len(test_rs))
        ]
    
    def test_uses_median_not_mean(self):
        """Objective should use median(TestR) not mean."""
        # Create folds with an outlier
        test_rs = [10.0, 12.0, 11.0, -50.0]  # Outlier: -50
        folds = self._make_fold_results(test_rs)
        
        result = compute_robust_objective(folds)
        
        # Median of [10, 12, 11, -50] = 10.5
        # Mean of [10, 12, 11, -50] = -4.25
        assert result.median_test_r == pytest.approx(10.5, rel=0.01)
        assert result.mean_test_r == pytest.approx(-4.25, rel=0.01)
        
        # Robust score should be based on median (positive), not mean (negative)
        # Note: DD penalty and stress will reduce it, but base should be positive
        assert result.median_test_r > 0
    
    def test_ratio_calculation(self):
        """Ratio should be median(TestR) / median(TrainR)."""
        test_rs = [10.0, 12.0, 11.0]
        train_rs = [20.0, 24.0, 22.0]  # 2x test
        folds = self._make_fold_results(test_rs, train_rs)
        
        result = compute_robust_objective(folds)
        
        # Median ratio should be ~0.5 (test is half of train)
        assert result.median_ratio == pytest.approx(0.5, rel=0.1)
    
    def test_pessimistic_r_calculation(self):
        """Pessimistic R should penalize train/test gap."""
        config = RobustObjectiveConfig(pessimistic_lambda=0.15)
        
        test_rs = [10.0]
        train_rs = [30.0]  # Big gap
        folds = self._make_fold_results(test_rs, train_rs)
        
        result = compute_robust_objective(folds, config)
        
        # Pessimistic = TestR - λ * |TrainR - TestR|
        # = 10 - 0.15 * |30 - 10| = 10 - 3 = 7
        assert result.pessimistic_r == pytest.approx(7.0, rel=0.01)
    
    def test_gate_failures(self):
        """Gates should fail for bad metrics."""
        config = RobustObjectiveConfig(
            gate_min_test_r=0.0,
            gate_min_ratio=0.20,
        )
        
        # Negative test R
        neg_folds = self._make_fold_results([-5.0])
        result_neg = compute_robust_objective(neg_folds, config)
        assert not result_neg.passes_gates
        assert any("test_r" in f for f in result_neg.gate_failures)
        
        # Bad ratio (train >> test)
        ratio_folds = self._make_fold_results([2.0], [100.0])
        result_ratio = compute_robust_objective(ratio_folds, config)
        assert not result_ratio.passes_gates
    
    def test_fold_survival_gate(self):
        """Should fail if too few folds are positive."""
        config = RobustObjectiveConfig(min_folds_positive=0.60)
        
        # 1 of 4 positive = 25% < 60%
        folds = self._make_fold_results([10.0, -5.0, -3.0, -2.0])
        result = compute_robust_objective(folds, config)
        
        assert not result.passes_gates
        assert any("fold_survival" in f for f in result.gate_failures)
    
    def test_stress_penalty_included(self):
        """Stress penalty should reduce robust score."""
        config = RobustObjectiveConfig(
            stress_config=StressConfig(slippage_mult=3.0, stop_gap_prob=0.30),
            stress_weight=0.50,
        )
        
        folds = self._make_fold_results([20.0, 22.0, 21.0])
        result = compute_robust_objective(folds, config)
        
        assert result.stress_penalty > 0, "Stress should add penalty"
        assert result.median_stressed_r < result.median_test_r


class TestParameterIslandClustering:
    """Test parameter island clustering."""
    
    def _make_candidates(self, n: int = 30) -> list:
        """Create mock candidates."""
        import random
        random.seed(42)
        
        candidates = []
        for i in range(n):
            # Create 3 clusters
            cluster = i % 3
            if cluster == 0:
                tp = 1.8 + random.uniform(-0.2, 0.2)
                sl = 0.35 + random.uniform(-0.05, 0.05)
            elif cluster == 1:
                tp = 2.5 + random.uniform(-0.2, 0.2)
                sl = 0.45 + random.uniform(-0.05, 0.05)
            else:
                tp = 3.0 + random.uniform(-0.2, 0.2)
                sl = 0.55 + random.uniform(-0.05, 0.05)
            
            candidates.append({
                "params": {"tp_mult": tp, "sl_mult": sl},
                "robust_result": {
                    "robust_score": 10.0 - cluster * 2 + random.uniform(-1, 1),
                    "median_test_r": 15.0 - cluster * 3,
                    "median_ratio": 0.6,
                    "passes_gates": i % 4 != 0,  # 75% pass
                },
            })
        
        return candidates
    
    def test_clustering_produces_islands(self):
        """Should produce 2-4 parameter islands."""
        candidates = self._make_candidates(30)
        islands = cluster_parameters(candidates, n_clusters=3, top_n=30)
        
        assert len(islands) >= 2
        assert len(islands) <= 4
    
    def test_islands_have_distinct_centroids(self):
        """Island centroids should be distinct."""
        candidates = self._make_candidates(30)
        islands = cluster_parameters(candidates, n_clusters=3, top_n=30)
        
        centroids = [(i.centroid["tp_mult"], i.centroid["sl_mult"]) for i in islands]
        
        # Check centroids are distinct
        for i, c1 in enumerate(centroids):
            for c2 in centroids[i+1:]:
                dist = ((c1[0] - c2[0])**2 + (c1[1] - c2[1])**2) ** 0.5
                assert dist > 0.1, f"Centroids too close: {c1} vs {c2}"
    
    def test_islands_have_stats(self):
        """Islands should have computed statistics."""
        candidates = self._make_candidates(30)
        islands = cluster_parameters(candidates, n_clusters=3, top_n=30)
        
        for island in islands:
            assert island.mean_robust_score > 0
            assert island.median_robust_score > 0
            assert len(island.members) > 0
            assert "tp_mult" in island.param_spread
            assert "sl_mult" in island.param_spread
    
    def test_islands_sorted_by_score(self):
        """Islands should be sorted by mean robust score."""
        candidates = self._make_candidates(30)
        islands = cluster_parameters(candidates, n_clusters=3, top_n=30)
        
        for i in range(len(islands) - 1):
            assert islands[i].mean_robust_score >= islands[i+1].mean_robust_score


class TestEdgeCases:
    """Test edge cases and error handling."""
    
    def test_empty_folds(self):
        """Should handle empty fold list."""
        result = compute_robust_objective([])
        
        assert result.robust_score < 0
        assert not result.passes_gates
        assert "no_folds" in result.gate_failures
    
    def test_single_fold(self):
        """Should work with single fold."""
        folds = [FoldResult(
            fold_name="single",
            train_r=20.0,
            test_r=15.0,
            avg_r=1.5,
            win_rate=0.40,
            n_trades=50,
            avg_r_loss=-1.0,
            median_dd_pre2x=0.25,
            p75_dd_pre2x=0.35,
            hit2x_pct=0.40,
        )]
        
        result = compute_robust_objective(folds)
        
        # With single fold, median = mean = the value
        assert result.median_test_r == 15.0
        assert result.mean_test_r == 15.0
    
    def test_zero_train_r(self):
        """Should handle zero train R."""
        folds = [FoldResult(
            fold_name="zero_train",
            train_r=0.0,
            test_r=10.0,
            avg_r=1.0,
            win_rate=0.40,
            n_trades=50,
            avg_r_loss=-1.0,
        )]
        
        result = compute_robust_objective(folds)
        
        # Ratio should be capped
        assert abs(result.median_ratio) <= 10.0
    
    def test_empty_candidates_for_clustering(self):
        """Should handle empty candidate list."""
        islands = cluster_parameters([], n_clusters=3, top_n=30)
        assert islands == []
    
    def test_fewer_candidates_than_clusters(self):
        """Should handle fewer candidates than requested clusters."""
        candidates = [
            {"params": {"tp_mult": 2.0, "sl_mult": 0.4}, "robust_result": {"robust_score": 10.0}},
            {"params": {"tp_mult": 2.5, "sl_mult": 0.5}, "robust_result": {"robust_score": 8.0}},
        ]
        
        islands = cluster_parameters(candidates, n_clusters=5, top_n=30)
        
        # Should produce at most 2 islands
        assert len(islands) <= 2


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

