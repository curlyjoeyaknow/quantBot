"""
Backtest library modules.

Reusable components for baseline and TP/SL backtesting pipelines.
"""

from .alerts import Alert, load_alerts
from .slice_exporter import (
    ClickHouseCfg, 
    export_slice_streaming, 
    export_slice_streaming_with_quality,
    ExportResult,
    query_coverage_batched,
)
from .slice_quality import (
    QualityMetrics,
    QualityThresholds,
    analyze_candles,
    analyze_parquet_quality,
    fill_gaps_with_forward_fill,
)
from .partitioner import (
    partition_slice,
    is_hive_partitioned,
    is_per_token_directory,
    detect_slice_type,
)
from .baseline_query import run_baseline_query
from .tp_sl_query import run_tp_sl_query
from .extended_exits import (
    ExitConfig,
    run_extended_exit_query,
)
from .storage import (
    store_baseline_run,
    store_tp_sl_run,
    ensure_baseline_schema,
    ensure_bt_schema,
)
from .summary import (
    summarize_baseline,
    summarize_tp_sl,
    aggregate_by_caller,
    print_caller_leaderboard,
    print_caller_returns_table,
)
from .helpers import (
    parse_yyyy_mm_dd,
    ceil_ms_to_interval_ts_ms,
    compute_slice_fingerprint,
    write_csv,
    pct,
)
from .strategy_config import (
    StrategyConfig,
    TakeProfitConfig,
    TakeProfitLevel,
    StopLossConfig,
    TimeLimitConfig,
    EntryConfig,
    ReentryConfig,
    CostConfig,
)
from .caller_groups import (
    CallerGroup,
    save_caller_group,
    load_caller_group,
    list_caller_groups,
    delete_caller_group,
    get_callers_from_duckdb,
    create_group_from_top_callers,
)
from .optimizer_config import (
    OptimizerConfig,
    RangeSpec,
    TpSlParamSpace,
    LadderTpParamSpace,
    TrailingStopParamSpace,
    BreakevenParamSpace,
    TimeLimitParamSpace,
    DelayedEntryParamSpace,
    ReentryParamSpace,
    create_basic_optimizer_config,
    create_grid_search_config,
)
from .optimizer import (
    GridOptimizer,
    OptimizationResult,
    OptimizationRun,
    run_optimization,
)
from .run_contract import (
    RunConfig,
    RunIdentity,
    RunRecord,
    ensure_runs_schema,
    store_run,
    store_run_summary,
    store_caller_scores,
    load_run,
    find_run_by_fingerprint,
    list_recent_runs,
    get_caller_scores_for_run,
)
from .metrics_contract import (
    MetricCategory,
    PathMetricDef,
    PATH_METRICS,
    StrategyMetricDef,
    STRATEGY_METRICS,
    ScoringMetricDef,
    SCORING_METRICS,
    ScoreVersion,
    SCORE_VERSIONS,
    get_score_version,
    list_score_versions,
    print_metrics_doc,
)
from .scoring_views import (
    CURRENT_SCORE_VERSION,
    VIEW_DEFINITIONS,
    ensure_baseline_trades_schema,
    create_scoring_views,
    get_caller_leaderboard,
    insert_trades_from_results,
    print_leaderboard,
)
from .risk_sizing import (
    DEFAULT_RISK_BUDGET,
    DEFAULT_MAX_POSITION_PCT,
    DEFAULT_MIN_STOP_DISTANCE,
    compute_stop_distance,
    compute_stop_distance_from_mult,
    compute_effective_stop_distance,
    compute_position_pct,
    compute_portfolio_pnl,
    compute_r_multiple,
    TradeRisk,
    compute_trade_risk,
    enrich_results_with_risk,
    summarize_risk_adjusted,
)
from .timing import (
    TimingRecord,
    TimingContext,
    timed,
    now_ms,
    format_ms,
    format_timing_parts,
    timed_function,
)
from .scoring import (
    ScoringConfig,
    DEFAULT_SCORING_CONFIG,
    compute_risk_penalty,
    compute_timing_boost,
    compute_discipline_bonus,
    compute_tail_bonus,
    compute_confidence,
    score_caller_v2,
    score_callers_v2,
    print_scored_leaderboard,
    generate_caller_scored_v2_sql,
)
from .trial_ledger import (
    ensure_trial_schema,
    store_optimizer_run,
    store_walk_forward_run,
    list_runs,
    get_best_trials,
    get_walk_forward_summary,
    print_recent_runs,
    # Pipeline phases (audit trail)
    PIPELINE_PHASES,
    store_phase_start,
    store_phase_complete,
    store_phase_failed,
    get_phase_status,
    get_run_phases,
    can_resume_from_phase,
    get_last_completed_phase,
    # Islands
    store_islands,
    load_islands,
    # Island champions
    store_island_champions,
    load_island_champions,
    # Stress lane validation
    store_stress_lane_result,
    get_completed_lanes_for_champion,
    load_stress_lane_results,
    # Champion validation
    store_champion_validation,
    load_champion_validations,
    get_maximin_winner,
    # Resume helpers
    get_resumable_run_state,
    print_run_state,
)
from .optimizer_objective import (
    ObjectiveConfig,
    ObjectiveResult,
    ObjectiveComponents,  # Alias for ObjectiveResult
    DEFAULT_OBJECTIVE_CONFIG,
    # Tiered DD penalty functions
    compute_dd_penalty_single,
    compute_dd_penalty_tiered,
    compute_dd_penalty,
    # Tiered time boost functions
    compute_time_boost_single,
    compute_time_boost_tiered,
    compute_time_boost,
    compute_discipline_bonus,
    compute_tail_bonus,
    compute_confidence,
    compute_objective,
    score_from_summary,
    compute_implied_avg_loss_r,
    check_loss_r_sanity,
    print_objective_breakdown,
)
from .robust_region_finder import (
    # DD Penalty
    DDPenaltyConfig,
    DEFAULT_DD_PENALTY,
    compute_dd_penalty_robust,
    # Stress Config (legacy single-lane)
    StressConfig,
    simulate_stress_r,
    # Gates
    GateConfig,
    DEFAULT_GATE_CONFIG,
    GateCheckResult,
    check_gates,
    print_gate_check,
    # Robust objective
    FoldResult,
    RobustObjectiveResult,
    RobustObjectiveConfig,
    DEFAULT_ROBUST_CONFIG,
    compute_robust_objective,
    # Parameter islands
    ParameterIsland,
    cluster_parameters,
    print_islands,
    # Island champions
    IslandChampion,
    extract_island_champions,
    print_island_champions,
    # Entry point
    evaluate_candidate_robust,
)
from .stress_lanes import (
    # Stress lane types
    StressLane,
    # Lane presets
    STRESS_LANES_BASIC,
    STRESS_LANES_FULL,
    STRESS_LANES_EXTENDED,
    STRESS_LANES_ADVERSARIAL,
    STRESS_LANE_MATRIX,
    get_stress_lanes,
    # Analytical simulation
    simulate_lane_stress_analytical,
    simulate_all_lanes_analytical,
    # Scoring
    LaneScoreResult,
    compute_lane_scores,
    # Champion validation
    ChampionValidationResult,
    print_lane_matrix,
)
from .run_mode import (
    # Types
    ModeType,
    LanePack,
    # Sub-configs
    GateThresholds,
    ObjectiveWeights,
    DataWindow,
    SearchConfig,
    StressTestConfig,
    # Main contract
    RunMode,
    # Fingerprints
    compute_data_fingerprint,
    get_git_commit,
    get_git_dirty,
    # Presets
    create_cheap_mode,
    create_serious_mode,
    create_war_room_mode,
    create_mode,
    # Lane packs
    LANE_PACK_DEFINITIONS,
    get_lane_pack,
    # Utils
    print_mode_summary,
)

__all__ = [
    # Alerts
    "Alert",
    "load_alerts",
    # Slice export
    "ClickHouseCfg",
    "export_slice_streaming",
    "query_coverage_batched",
    # Partitioning
    "partition_slice",
    "is_hive_partitioned",
    "is_per_token_directory",
    "detect_slice_type",
    # Queries
    "run_baseline_query",
    "run_tp_sl_query",
    # Extended exits
    "ExitConfig",
    "run_extended_exit_query",
    # Storage
    "store_baseline_run",
    "store_tp_sl_run",
    "ensure_baseline_schema",
    "ensure_bt_schema",
    # Summary
    "summarize_baseline",
    "summarize_tp_sl",
    "aggregate_by_caller",
    "print_caller_leaderboard",
    "print_caller_returns_table",
    # Helpers
    "parse_yyyy_mm_dd",
    "ceil_ms_to_interval_ts_ms",
    "compute_slice_fingerprint",
    "write_csv",
    "pct",
    # Strategy config
    "StrategyConfig",
    "TakeProfitConfig",
    "TakeProfitLevel",
    "StopLossConfig",
    "TimeLimitConfig",
    "EntryConfig",
    "ReentryConfig",
    "CostConfig",
    # Caller groups
    "CallerGroup",
    "save_caller_group",
    "load_caller_group",
    "list_caller_groups",
    "delete_caller_group",
    "get_callers_from_duckdb",
    "create_group_from_top_callers",
    # Optimizer config
    "OptimizerConfig",
    "RangeSpec",
    "TpSlParamSpace",
    "LadderTpParamSpace",
    "TrailingStopParamSpace",
    "BreakevenParamSpace",
    "TimeLimitParamSpace",
    "DelayedEntryParamSpace",
    "ReentryParamSpace",
    "create_basic_optimizer_config",
    "create_grid_search_config",
    # Optimizer
    "GridOptimizer",
    "OptimizationResult",
    "OptimizationRun",
    "run_optimization",
    # Optimizer objective
    "ObjectiveConfig",
    "ObjectiveComponents",
    "DEFAULT_OBJECTIVE_CONFIG",
    "CONSERVATIVE_OBJECTIVE_CONFIG",
    "AGGRESSIVE_OBJECTIVE_CONFIG",
    "compute_dd_penalty",
    "compute_timing_boost",
    "compute_tail_bonus",
    "compute_win_rate_penalty",
    "compute_loss_r_penalty",
    "compute_objective",
    "score_result",
    "print_objective_breakdown",
    # Run contract
    "RunConfig",
    "RunIdentity",
    "RunRecord",
    "ensure_runs_schema",
    "store_run",
    "store_run_summary",
    "store_caller_scores",
    "load_run",
    "find_run_by_fingerprint",
    "list_recent_runs",
    "get_caller_scores_for_run",
    # Metrics contract
    "MetricCategory",
    "PathMetricDef",
    "PATH_METRICS",
    "StrategyMetricDef",
    "STRATEGY_METRICS",
    "ScoringMetricDef",
    "SCORING_METRICS",
    "ScoreVersion",
    "SCORE_VERSIONS",
    "get_score_version",
    "list_score_versions",
    "print_metrics_doc",
    # Scoring views
    "CURRENT_SCORE_VERSION",
    "VIEW_DEFINITIONS",
    "ensure_baseline_trades_schema",
    "create_scoring_views",
    "get_caller_leaderboard",
    "insert_trades_from_results",
    "print_leaderboard",
    # Risk sizing
    "DEFAULT_RISK_BUDGET",
    "DEFAULT_MAX_POSITION_PCT",
    "DEFAULT_MIN_STOP_DISTANCE",
    "compute_stop_distance",
    "compute_stop_distance_from_mult",
    "compute_effective_stop_distance",
    "compute_position_pct",
    "compute_portfolio_pnl",
    "compute_r_multiple",
    "TradeRisk",
    "compute_trade_risk",
    "enrich_results_with_risk",
    "summarize_risk_adjusted",
    # Timing
    "TimingRecord",
    "TimingContext",
    "timed",
    "now_ms",
    "format_ms",
    "format_timing_parts",
    "timed_function",
    # Scoring v2
    "ScoringConfig",
    "DEFAULT_SCORING_CONFIG",
    "compute_risk_penalty",
    "compute_timing_boost",
    "compute_discipline_bonus",
    "compute_tail_bonus",
    "compute_confidence",
    "score_caller_v2",
    "score_callers_v2",
    "print_scored_leaderboard",
    "generate_caller_scored_v2_sql",
    # Trial Ledger (experiment tracking)
    "ensure_trial_schema",
    "store_optimizer_run",
    "store_walk_forward_run",
    "list_runs",
    "get_best_trials",
    "get_walk_forward_summary",
    "print_recent_runs",
    # Pipeline phases (audit trail + resume)
    "PIPELINE_PHASES",
    "store_phase_start",
    "store_phase_complete",
    "store_phase_failed",
    "get_phase_status",
    "get_run_phases",
    "can_resume_from_phase",
    "get_last_completed_phase",
    # Islands storage
    "store_islands",
    "load_islands",
    # Island champions storage
    "store_island_champions",
    "load_island_champions",
    # Stress lane validation storage
    "store_stress_lane_result",
    "get_completed_lanes_for_champion",
    "load_stress_lane_results",
    # Champion validation storage
    "store_champion_validation",
    "load_champion_validations",
    "get_maximin_winner",
    # Resume helpers
    "get_resumable_run_state",
    "print_run_state",
    # Optimizer Objective
    "ObjectiveConfig",
    "ObjectiveResult",
    "DEFAULT_OBJECTIVE_CONFIG",
    # Tiered DD penalty
    "compute_dd_penalty_single",
    "compute_dd_penalty_tiered",
    "compute_dd_penalty",
    # Tiered time boost
    "compute_time_boost_single",
    "compute_time_boost_tiered",
    "compute_time_boost",
    "compute_discipline_bonus",
    "compute_tail_bonus",
    "compute_confidence",
    "compute_objective",
    "score_from_summary",
    "compute_implied_avg_loss_r",
    "check_loss_r_sanity",
    "print_objective_breakdown",
    # Robust Region Finder
    "DDPenaltyConfig",
    "DEFAULT_DD_PENALTY",
    "compute_dd_penalty_robust",
    "StressConfig",
    "simulate_stress_r",
    "GateConfig",
    "DEFAULT_GATE_CONFIG",
    "GateCheckResult",
    "check_gates",
    "print_gate_check",
    "FoldResult",
    "RobustObjectiveResult",
    "RobustObjectiveConfig",
    "DEFAULT_ROBUST_CONFIG",
    "compute_robust_objective",
    "ParameterIsland",
    "cluster_parameters",
    "print_islands",
    "IslandChampion",
    "extract_island_champions",
    "print_island_champions",
    "evaluate_candidate_robust",
    # Stress Lanes
    "StressLane",
    "STRESS_LANES_BASIC",
    "STRESS_LANES_FULL",
    "STRESS_LANES_EXTENDED",
    "STRESS_LANES_ADVERSARIAL",
    "STRESS_LANE_MATRIX",
    "get_stress_lanes",
    "simulate_lane_stress_analytical",
    "simulate_all_lanes_analytical",
    "LaneScoreResult",
    "compute_lane_scores",
    "ChampionValidationResult",
    "print_lane_matrix",
    # Run Mode Contract
    "ModeType",
    "LanePack",
    "GateThresholds",
    "ObjectiveWeights",
    "DataWindow",
    "SearchConfig",
    "StressTestConfig",
    "RunMode",
    "compute_data_fingerprint",
    "get_git_commit",
    "get_git_dirty",
    "create_cheap_mode",
    "create_serious_mode",
    "create_war_room_mode",
    "create_mode",
    "LANE_PACK_DEFINITIONS",
    "get_lane_pack",
    "print_mode_summary",
]

