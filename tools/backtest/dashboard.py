#!/usr/bin/env python3
"""
Interactive dashboard for phased stop simulator results.

Usage:
    streamlit run tools/backtest/dashboard.py -- output/2025_v2/phased_stop_results_*.parquet
"""

import streamlit as st
import pyarrow.parquet as pq
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
from pathlib import Path
import sys
from typing import Optional

# Page config
st.set_page_config(
    page_title="QuantBot EV Dashboard",
    page_icon="📊",
    layout="wide",
    initial_sidebar_state="expanded",
)

# Custom CSS - Force dark theme for better contrast
st.markdown("""
<style>
    /* Force dark theme */
    .stApp {
        background-color: #0e1117;
        color: #fafafa;
    }
    
    /* Ensure all text is visible */
    .stMarkdown, .stText, p, span, div {
        color: #fafafa !important;
    }
    
    /* Headers */
    h1, h2, h3, h4, h5, h6 {
        color: #fafafa !important;
    }
    
    /* Metrics */
    .stMetric {
        background-color: #262730;
        padding: 15px;
        border-radius: 8px;
        border: 1px solid #31333f;
    }
    
    .stMetric label {
        color: #a0a0a0 !important;
    }
    
    .stMetric [data-testid="stMetricValue"] {
        color: #fafafa !important;
    }
    
    /* Sidebar */
    section[data-testid="stSidebar"] {
        background-color: #262730;
    }
    
    section[data-testid="stSidebar"] .stMarkdown {
        color: #fafafa !important;
    }
    
    /* Tables */
    .dataframe {
        color: #fafafa !important;
    }
    
    /* Info/Warning/Error boxes */
    .stAlert {
        color: #0e1117 !important;
    }
</style>
""", unsafe_allow_html=True)


@st.cache_data
def load_data(parquet_pattern: str) -> pd.DataFrame:
    """Load parquet data with caching."""
    try:
        from glob import glob
        
        # Handle wildcard patterns
        if '*' in parquet_pattern:
            files = glob(parquet_pattern)
            if not files:
                st.error(f"No files found matching pattern: {parquet_pattern}")
                return pd.DataFrame()
            
            # Load all matching files
            dfs = []
            for file in files:
                df = pq.read_table(file).to_pandas()
                dfs.append(df)
            
            df = pd.concat(dfs, ignore_index=True)
            st.sidebar.success(f"✅ Loaded {len(files)} file(s)")
        else:
            df = pq.read_table(parquet_pattern).to_pandas()
        
        return df
    except Exception as e:
        st.error(f"Error loading data: {e}")
        return pd.DataFrame()


def calculate_cohort_stats(df: pd.DataFrame) -> dict:
    """Calculate cohort statistics."""
    total = len(df)
    
    winners = df[df['hit_3x'] == True]
    losers = df[(df['hit_2x'] == True) & (df['hit_3x'] == False)]
    never_2x = df[df['hit_2x'] == False]
    
    # Cohort probabilities
    p_reach_2x = (df['hit_2x'].sum() / total * 100) if total > 0 else 0
    p_reach_3x = (df['hit_3x'].sum() / total * 100) if total > 0 else 0
    p_3x_given_2x = (len(winners) / df['hit_2x'].sum() * 100) if df['hit_2x'].sum() > 0 else 0
    p_2x_no3x = (len(losers) / total * 100) if total > 0 else 0
    
    # EV calculations
    all_exit_mults = df['exit_mult']
    ev_from_entry = ((all_exit_mults.mean() - 1.0) * 100) if len(all_exit_mults) > 0 else 0
    
    trades_hit_2x = df[df['hit_2x'] == True]
    if len(trades_hit_2x) > 0:
        ev_given_2x = ((trades_hit_2x['exit_mult'].mean() - 1.0) * 100)
    else:
        ev_given_2x = 0
    
    return {
        'total': total,
        'winners': len(winners),
        'losers': len(losers),
        'never_2x': len(never_2x),
        'p_reach_2x': p_reach_2x,
        'p_reach_3x': p_reach_3x,
        'p_3x_given_2x': p_3x_given_2x,
        'p_2x_no3x': p_2x_no3x,
        'ev_from_entry': ev_from_entry,
        'ev_given_2x': ev_given_2x,
        'winners_df': winners,
        'losers_df': losers,
        'never_2x_df': never_2x,
    }


def main():
    st.title("📊 QuantBot EV Dashboard")
    
    # Mode selector
    mode = st.sidebar.radio(
        "📊 Dashboard Mode",
        ["Single Strategy Analysis", "Compare Entry Strategies"],
        help="Single: Analyze one dataset. Compare: Compare multiple entry strategies side-by-side"
    )
    
    if mode == "Single Strategy Analysis":
        single_strategy_dashboard()
    else:
        comparison_dashboard()


def single_strategy_dashboard():
    """Original single-strategy analysis dashboard."""
    st.markdown("### Phased Stop Strategy Analysis")
    
    # Sidebar - File selection
    st.sidebar.header("📁 Data Source")
    
    # Discover available parquet files
    from glob import glob
    from pathlib import Path
    
    # Search common output directories
    search_patterns = [
        "output/*/phased_stop_results_*.parquet",
        "output/*/*/phased_stop_results_*.parquet",
        "results/*/phased_stop_results_*.parquet",
    ]
    
    all_files = []
    for pattern in search_patterns:
        all_files.extend(glob(pattern))
    
    # Group files by directory
    file_groups = {}
    for file in all_files:
        dir_name = str(Path(file).parent)
        if dir_name not in file_groups:
            file_groups[dir_name] = []
        file_groups[dir_name].append(file)
    
    # Create options for dropdown
    if file_groups:
        options = []
        for dir_name in sorted(file_groups.keys()):
            files = file_groups[dir_name]
            # Create a pattern for this directory
            pattern = f"{dir_name}/phased_stop_results_*.parquet"
            label = f"{dir_name} ({len(files)} file{'s' if len(files) > 1 else ''})"
            options.append((label, pattern))
        
        # Add option for custom pattern
        options.append(("Custom pattern...", "custom"))
        
        # Get default from command line or use first option
        if len(sys.argv) > 1:
            default_pattern = sys.argv[1]
            # Try to find matching option
            default_idx = 0
            for i, (label, pattern) in enumerate(options[:-1]):  # Exclude "Custom"
                if pattern == default_pattern or default_pattern.startswith(str(Path(pattern).parent)):
                    default_idx = i
                    break
        else:
            default_idx = 0
        
        selected_option = st.sidebar.selectbox(
            "Select data source:",
            options,
            format_func=lambda x: x[0],
            index=default_idx,
            help="Choose a directory with parquet files"
        )
        
        if selected_option[1] == "custom":
            parquet_pattern = st.sidebar.text_input(
                "Custom pattern:",
                value="output/2025_v2/phased_stop_results_*.parquet",
                help="Use wildcards (*) to match multiple files"
            )
        else:
            parquet_pattern = selected_option[1]
            st.sidebar.info(f"Pattern: `{parquet_pattern}`")
    else:
        st.sidebar.warning("No parquet files found in output directories")
        parquet_pattern = st.sidebar.text_input(
            "Parquet file pattern:",
            value="output/2025_v2/phased_stop_results_*.parquet",
            help="Use wildcards (*) to match multiple files"
        )
    
    # Load data
    if not parquet_pattern:
        st.warning("Please enter a parquet file pattern")
        return
    
    with st.spinner("Loading data..."):
        df = load_data(parquet_pattern)
    
    if df.empty:
        st.error("No data loaded. Check your file pattern.")
        return
    
    st.sidebar.success(f"✅ Loaded {len(df):,} trades")
    
    # Sidebar - Filters
    st.sidebar.header("🎛️ Filters")
    
    # Strategy filters - Mode first
    stop_modes = sorted(df['stop_mode'].unique())
    selected_mode = st.sidebar.selectbox("Stop Mode", stop_modes)
    
    # Filter available stops based on selected mode
    mode_df = df[df['stop_mode'] == selected_mode]
    
    # Get available phase1/phase2 combinations for this mode
    available_combos = mode_df[['phase1_stop_pct', 'phase2_stop_pct']].drop_duplicates().sort_values(['phase1_stop_pct', 'phase2_stop_pct'])
    
    # Create a list of tuples for the combo selector
    combo_options = []
    for _, row in available_combos.iterrows():
        p1 = row['phase1_stop_pct']
        p2 = row['phase2_stop_pct']
        label = f"P1: {p1*100:.0f}% / P2: {p2*100:.0f}%"
        combo_options.append((label, p1, p2))
    
    # Single combo selector instead of separate dropdowns
    selected_combo = st.sidebar.selectbox(
        "Stop Configuration",
        combo_options,
        format_func=lambda x: x[0],
        help="Select Phase 1 and Phase 2 stop percentages"
    )
    
    selected_p1 = selected_combo[1]
    selected_p2 = selected_combo[2]
    
    # Show breakdown
    st.sidebar.caption(f"Phase 1: {selected_p1*100:.0f}% | Phase 2: {selected_p2*100:.0f}%")
    
    # Show ladder steps if applicable
    if selected_mode == 'ladder' and 'ladder_steps' in df.columns:
        ladder_steps = mode_df['ladder_steps'].iloc[0] if len(mode_df) > 0 else 0.5
        st.sidebar.info(f"🪜 Ladder steps: {ladder_steps}x")
    
    # Caller filter
    callers = ['All'] + sorted(df['caller'].unique().tolist())
    selected_caller = st.sidebar.selectbox("Caller", callers)
    
    # Apply filters
    filtered_df = df[
        (df['stop_mode'] == selected_mode) &
        (df['phase1_stop_pct'] == selected_p1) &
        (df['phase2_stop_pct'] == selected_p2)
    ].copy()
    
    if selected_caller != 'All':
        filtered_df = filtered_df[filtered_df['caller'] == selected_caller]
    
    # Show filter results
    if len(filtered_df) == 0:
        st.sidebar.error(f"⚠️ 0 trades after filters")
        st.sidebar.warning("Try different stop percentages")
    else:
        st.sidebar.success(f"📊 {len(filtered_df):,} trades after filters")
    
    # Calculate stats
    stats = calculate_cohort_stats(filtered_df)
    
    # Main dashboard
    st.markdown("---")
    
    # Top metrics row
    col1, col2, col3, col4, col5 = st.columns(5)
    
    with col1:
        st.metric("Total Trades", f"{stats['total']:,}")
    
    with col2:
        st.metric("EV from Entry", f"{stats['ev_from_entry']:.1f}%", 
                 delta=None if stats['ev_from_entry'] < 0 else "positive")
    
    with col3:
        st.metric("EV given 2x", f"{stats['ev_given_2x']:.1f}%",
                 delta=None if stats['ev_given_2x'] < 0 else "positive")
    
    with col4:
        st.metric("P(reach 2x)", f"{stats['p_reach_2x']:.1f}%")
    
    with col5:
        st.metric("P(3x | 2x)", f"{stats['p_3x_given_2x']:.1f}%")
    
    st.markdown("---")
    
    # Cohort breakdown
    st.subheader("🎯 Cohort Breakdown")
    
    col1, col2, col3 = st.columns(3)
    
    with col1:
        st.markdown("### 🏆 Winners (≥3x)")
        st.metric("Count", f"{stats['winners']:,}")
        pct = (stats['winners']/stats['total']*100) if stats['total'] > 0 else 0
        st.metric("% of Total", f"{pct:.1f}%")
        if len(stats['winners_df']) > 0:
            st.metric("Mean Exit Mult", f"{stats['winners_df']['exit_mult'].mean():.2f}x")
            st.metric("Median Exit Mult", f"{stats['winners_df']['exit_mult'].median():.2f}x")
            st.metric("Mean Giveback", f"{stats['winners_df']['giveback_from_peak_pct'].mean():.1f}%")
    
    with col2:
        st.markdown("### 📉 Losers (2x, no 3x)")
        st.metric("Count", f"{stats['losers']:,}")
        pct = (stats['losers']/stats['total']*100) if stats['total'] > 0 else 0
        st.metric("% of Total", f"{pct:.1f}%")
        if len(stats['losers_df']) > 0:
            st.metric("Mean Exit Mult", f"{stats['losers_df']['exit_mult'].mean():.2f}x")
            st.metric("Median Exit Mult", f"{stats['losers_df']['exit_mult'].median():.2f}x")
    
    with col3:
        st.markdown("### ❌ Never 2x")
        st.metric("Count", f"{stats['never_2x']:,}")
        pct = (stats['never_2x']/stats['total']*100) if stats['total'] > 0 else 0
        st.metric("% of Total", f"{pct:.1f}%")
        if len(stats['never_2x_df']) > 0:
            st.metric("Mean Exit Mult", f"{stats['never_2x_df']['exit_mult'].mean():.2f}x")
            st.metric("Median Exit Mult", f"{stats['never_2x_df']['exit_mult'].median():.2f}x")
    
    st.markdown("---")
    
    # Charts
    st.subheader("📈 Distribution Analysis")
    
    tab1, tab2, tab3, tab4 = st.tabs(["Exit Multiples", "Peak vs Exit", "Giveback", "Exit Reasons"])
    
    with tab1:
        # Exit multiple distributions by cohort
        fig = go.Figure()
        
        if len(stats['winners_df']) > 0:
            fig.add_trace(go.Histogram(
                x=stats['winners_df']['exit_mult'],
                name='Winners (≥3x)',
                opacity=0.7,
                nbinsx=50
            ))
        
        if len(stats['losers_df']) > 0:
            fig.add_trace(go.Histogram(
                x=stats['losers_df']['exit_mult'],
                name='Losers (2x, no 3x)',
                opacity=0.7,
                nbinsx=50
            ))
        
        if len(stats['never_2x_df']) > 0:
            fig.add_trace(go.Histogram(
                x=stats['never_2x_df']['exit_mult'],
                name='Never 2x',
                opacity=0.7,
                nbinsx=50
            ))
        
        fig.update_layout(
            title="Exit Multiple Distribution by Cohort",
            xaxis_title="Exit Multiple",
            yaxis_title="Count",
            barmode='overlay',
            height=500
        )
        
        st.plotly_chart(fig, use_container_width=True)
    
    with tab2:
        # Peak vs Exit scatter
        fig = px.scatter(
            filtered_df,
            x='peak_mult',
            y='exit_mult',
            color='hit_3x',
            hover_data=['caller', 'mint', 'exit_reason', 'giveback_from_peak_pct'],
            title="Peak Multiple vs Exit Multiple",
            labels={'peak_mult': 'Peak Multiple', 'exit_mult': 'Exit Multiple', 'hit_3x': 'Hit 3x'},
            color_discrete_map={True: 'green', False: 'red'}
        )
        
        # Add diagonal line (exit = peak, no giveback)
        max_val = max(filtered_df['peak_mult'].max(), filtered_df['exit_mult'].max())
        fig.add_trace(go.Scatter(
            x=[0, max_val],
            y=[0, max_val],
            mode='lines',
            line=dict(dash='dash', color='gray'),
            name='No Giveback Line',
            showlegend=True
        ))
        
        fig.update_layout(height=500)
        st.plotly_chart(fig, use_container_width=True)
    
    with tab3:
        # Giveback distribution (winners only)
        if len(stats['winners_df']) > 0:
            fig = px.histogram(
                stats['winners_df'],
                x='giveback_from_peak_pct',
                nbins=50,
                title="Giveback from Peak Distribution (Winners Only)",
                labels={'giveback_from_peak_pct': 'Giveback from Peak (%)'}
            )
            fig.update_layout(height=500)
            st.plotly_chart(fig, use_container_width=True)
            
            # Giveback percentiles
            col1, col2, col3, col4 = st.columns(4)
            with col1:
                st.metric("P25 Giveback", f"{stats['winners_df']['giveback_from_peak_pct'].quantile(0.25):.1f}%")
            with col2:
                st.metric("P50 Giveback", f"{stats['winners_df']['giveback_from_peak_pct'].quantile(0.50):.1f}%")
            with col3:
                st.metric("P75 Giveback", f"{stats['winners_df']['giveback_from_peak_pct'].quantile(0.75):.1f}%")
            with col4:
                st.metric("P90 Giveback", f"{stats['winners_df']['giveback_from_peak_pct'].quantile(0.90):.1f}%")
        else:
            st.info("No winners in this strategy")
    
    with tab4:
        # Exit reasons breakdown
        exit_reasons = filtered_df['exit_reason'].value_counts()
        
        fig = px.pie(
            values=exit_reasons.values,
            names=exit_reasons.index,
            title="Exit Reasons Distribution"
        )
        fig.update_layout(height=500)
        st.plotly_chart(fig, use_container_width=True)
        
        # Exit reasons by cohort
        col1, col2 = st.columns(2)
        
        with col1:
            st.markdown("#### Winners Exit Reasons")
            if len(stats['winners_df']) > 0:
                winner_reasons = stats['winners_df']['exit_reason'].value_counts()
                st.dataframe(winner_reasons, use_container_width=True)
        
        with col2:
            st.markdown("#### Losers Exit Reasons")
            if len(stats['losers_df']) > 0:
                loser_reasons = stats['losers_df']['exit_reason'].value_counts()
                st.dataframe(loser_reasons, use_container_width=True)
    
    st.markdown("---")
    
    # Top trades table
    st.subheader("🏆 Top Trades by Exit Multiple")
    
    top_n = st.slider("Number of trades to show", 10, 100, 20)
    
    top_trades = filtered_df.nlargest(top_n, 'exit_mult')[
        ['caller', 'mint', 'entry_mult', 'peak_mult', 'exit_mult', 
         'giveback_from_peak_pct', 'hit_2x', 'hit_3x', 'hit_4x', 'hit_5x', 'hit_10x', 'exit_reason']
    ].copy()
    
    # Format for display
    top_trades['mint'] = top_trades['mint'].str[:20] + '...'
    top_trades['exit_mult'] = top_trades['exit_mult'].round(2)
    top_trades['peak_mult'] = top_trades['peak_mult'].round(2)
    top_trades['giveback_from_peak_pct'] = top_trades['giveback_from_peak_pct'].round(1)
    
    st.dataframe(top_trades, use_container_width=True, height=400)
    
    st.markdown("---")
    
    # Strategy comparison (if multiple strategies available)
    st.subheader("🔄 Strategy Comparison")
    
    if st.checkbox("Show strategy comparison"):
        # Get all unique strategies
        strategies = df.groupby(['stop_mode', 'phase1_stop_pct', 'phase2_stop_pct']).size().reset_index(name='count')
        
        comparison_data = []
        
        for _, row in strategies.iterrows():
            strategy_df = df[
                (df['stop_mode'] == row['stop_mode']) &
                (df['phase1_stop_pct'] == row['phase1_stop_pct']) &
                (df['phase2_stop_pct'] == row['phase2_stop_pct'])
            ]
            
            if selected_caller != 'All':
                strategy_df = strategy_df[strategy_df['caller'] == selected_caller]
            
            if len(strategy_df) > 0:
                strategy_stats = calculate_cohort_stats(strategy_df)
                
                comparison_data.append({
                    'Stop Mode': row['stop_mode'],
                    'Phase1 Stop': f"{row['phase1_stop_pct']*100:.0f}%",
                    'Phase2 Stop': f"{row['phase2_stop_pct']*100:.0f}%",
                    'Total Trades': strategy_stats['total'],
                    'EV from Entry': f"{strategy_stats['ev_from_entry']:.1f}%",
                    'EV given 2x': f"{strategy_stats['ev_given_2x']:.1f}%",
                    'P(reach 2x)': f"{strategy_stats['p_reach_2x']:.1f}%",
                    'P(3x | 2x)': f"{strategy_stats['p_3x_given_2x']:.1f}%",
                    'Winners': strategy_stats['winners'],
                    'Losers': strategy_stats['losers'],
                })
        
        comparison_df = pd.DataFrame(comparison_data)
        
        # Sort by EV from Entry
        comparison_df['EV_sort'] = comparison_df['EV from Entry'].str.rstrip('%').astype(float)
        comparison_df = comparison_df.sort_values('EV_sort', ascending=False).drop('EV_sort', axis=1)
        
        st.dataframe(comparison_df, use_container_width=True, height=400)
        
        # EV comparison chart
        fig = px.bar(
            comparison_df,
            x=comparison_df['Stop Mode'] + ' ' + comparison_df['Phase1 Stop'] + '/' + comparison_df['Phase2 Stop'],
            y=comparison_df['EV from Entry'].str.rstrip('%').astype(float),
            title="EV from Entry by Strategy",
            labels={'x': 'Strategy', 'y': 'EV from Entry (%)'}
        )
        fig.update_layout(height=400)
        st.plotly_chart(fig, use_container_width=True)
    
    # Footer
    st.markdown("---")
    st.markdown("**QuantBot EV Dashboard** | Data source: `{}`".format(parquet_pattern))


def comparison_dashboard():
    """Compare multiple entry strategies side-by-side."""
    st.markdown("### Compare Entry Strategies")
    st.markdown("Compare immediate entry vs delayed entry strategies across all stop configurations")
    
    # Sidebar - Select multiple datasets
    st.sidebar.header("📁 Select Datasets to Compare")
    
    # Discover available parquet files
    from glob import glob
    from pathlib import Path
    
    search_patterns = [
        "output/*/phased_stop_results_*.parquet",
        "output/*/*/phased_stop_results_*.parquet",
        "results/*/phased_stop_results_*.parquet",
    ]
    
    all_files = []
    for pattern in search_patterns:
        all_files.extend(glob(pattern))
    
    # Group files by directory
    file_groups = {}
    for file in all_files:
        dir_name = str(Path(file).parent)
        if dir_name not in file_groups:
            file_groups[dir_name] = []
        file_groups[dir_name].append(file)
    
    if not file_groups:
        st.error("No parquet files found in output/ or results/ directories")
        return
    
    # Create multiselect for datasets
    dataset_options = {}
    for dir_name in sorted(file_groups.keys()):
        files = file_groups[dir_name]
        pattern = f"{dir_name}/phased_stop_results_*.parquet"
        
        # Extract entry strategy from directory name
        dir_basename = Path(dir_name).name
        if 'immediate' in dir_basename.lower():
            label = "Immediate (0%)"
        elif 'dip_' in dir_basename:
            # Extract dip percentage
            parts = dir_basename.split('_')
            for part in parts:
                if part.startswith('-') or part.startswith('dip'):
                    dip_val = part.replace('dip', '').replace('pct', '')
                    label = f"{dip_val}% dip"
                    break
            else:
                label = dir_basename
        else:
            label = dir_basename
        
        dataset_options[label] = pattern
    
    selected_datasets = st.sidebar.multiselect(
        "Select datasets to compare:",
        options=list(dataset_options.keys()),
        default=list(dataset_options.keys())[:min(3, len(dataset_options))],
        help="Select 2 or more datasets to compare"
    )
    
    if len(selected_datasets) < 2:
        st.warning("⚠️ Please select at least 2 datasets to compare")
        return
    
    # Load all selected datasets
    datasets = {}
    for label in selected_datasets:
        pattern = dataset_options[label]
        df = load_data(pattern)
        if not df.empty:
            datasets[label] = df
    
    if len(datasets) < 2:
        st.error("Failed to load datasets")
        return
    
    st.sidebar.success(f"✅ Loaded {len(datasets)} datasets")
    
    # Strategy filter
    st.sidebar.header("🎯 Strategy Filter")
    
    # Get all unique stop modes
    all_stop_modes = set()
    for df in datasets.values():
        all_stop_modes.update(df['stop_mode'].unique())
    
    selected_stop_mode = st.sidebar.selectbox(
        "Stop Mode:",
        options=sorted(all_stop_modes),
        help="Filter by stop mode"
    )
    
    # Get available stop configurations for selected mode
    stop_configs = set()
    for df in datasets.values():
        mode_df = df[df['stop_mode'] == selected_stop_mode]
        for _, row in mode_df[['phase1_stop_pct', 'phase2_stop_pct']].drop_duplicates().iterrows():
            stop_configs.add((row['phase1_stop_pct'], row['phase2_stop_pct']))
    
    stop_config_options = [
        f"{int(p1*100)}% / {int(p2*100)}%"
        for p1, p2 in sorted(stop_configs)
    ]
    
    selected_stop_config = st.sidebar.selectbox(
        "Stop Configuration:",
        options=stop_config_options,
        help="Phase1 % / Phase2 %"
    )
    
    # Parse selected config
    phase1_pct = float(selected_stop_config.split('%')[0]) / 100
    phase2_pct = float(selected_stop_config.split('/')[1].strip().split('%')[0]) / 100
    
    # Filter all datasets
    filtered_datasets = {}
    for label, df in datasets.items():
        filtered_df = df[
            (df['stop_mode'] == selected_stop_mode) &
            (df['phase1_stop_pct'] == phase1_pct) &
            (df['phase2_stop_pct'] == phase2_pct)
        ]
        if not filtered_df.empty:
            filtered_datasets[label] = filtered_df
    
    if not filtered_datasets:
        st.error("No data found for selected strategy")
        return
    
    # Comparison metrics
    st.markdown("---")
    st.markdown(f"### 📊 Comparison: {selected_stop_mode.title()} {selected_stop_config}")
    
    # Calculate stats for each dataset
    comparison_stats = []
    for label, df in filtered_datasets.items():
        stats = calculate_cohort_stats(df)
        comparison_stats.append({
            'Entry Strategy': label,
            'Total Trades': stats['total'],
            'EV from Entry': f"{stats['ev_from_entry']:.1f}%",
            'EV given 2x': f"{stats['ev_given_2x']:.1f}%",
            'P(reach 2x)': f"{stats['p_reach_2x']:.1f}%",
            'P(reach 3x)': f"{stats['p_reach_3x']:.1f}%",
            'Winners (≥3x)': stats['winners'],
            'Winners %': f"{(stats['winners']/stats['total']*100) if stats['total'] > 0 else 0:.1f}%",
            'Losers (2x, no 3x)': stats['losers'],
            'Never 2x': stats['never_2x'],
        })
    
    comparison_df = pd.DataFrame(comparison_stats)
    
    # Sort by EV from Entry
    comparison_df['EV_sort'] = comparison_df['EV from Entry'].str.rstrip('%').astype(float)
    comparison_df = comparison_df.sort_values('EV_sort', ascending=False).drop('EV_sort', axis=1)
    
    # Highlight best strategy
    best_strategy = comparison_df.iloc[0]['Entry Strategy']
    best_ev = comparison_df.iloc[0]['EV from Entry']
    
    st.success(f"🎯 **Best Entry Strategy**: {best_strategy} with {best_ev} EV from entry")
    
    # Display comparison table
    st.dataframe(comparison_df, use_container_width=True, height=min(400, len(comparison_df) * 40 + 50))
    
    # Visualizations
    col1, col2 = st.columns(2)
    
    with col1:
        # EV comparison chart
        fig_ev = go.Figure()
        
        ev_values = [float(row['EV from Entry'].rstrip('%')) for _, row in comparison_df.iterrows()]
        colors = ['#00cc96' if i == 0 else '#636efa' for i in range(len(ev_values))]
        
        fig_ev.add_trace(go.Bar(
            x=comparison_df['Entry Strategy'],
            y=ev_values,
            marker_color=colors,
            text=[f"{v:.1f}%" for v in ev_values],
            textposition='outside',
        ))
        
        fig_ev.update_layout(
            title="EV from Entry Comparison",
            xaxis_title="Entry Strategy",
            yaxis_title="EV from Entry (%)",
            height=400,
            showlegend=False
        )
        
        st.plotly_chart(fig_ev, use_container_width=True)
    
    with col2:
        # Trade count vs EV scatter
        fig_scatter = go.Figure()
        
        trade_counts = comparison_df['Total Trades'].values
        ev_values = [float(row['EV from Entry'].rstrip('%')) for _, row in comparison_df.iterrows()]
        
        fig_scatter.add_trace(go.Scatter(
            x=trade_counts,
            y=ev_values,
            mode='markers+text',
            marker=dict(size=15, color=colors),
            text=comparison_df['Entry Strategy'],
            textposition='top center',
        ))
        
        fig_scatter.update_layout(
            title="Trade Count vs EV",
            xaxis_title="Total Trades",
            yaxis_title="EV from Entry (%)",
            height=400,
            showlegend=False
        )
        
        st.plotly_chart(fig_scatter, use_container_width=True)
    
    # Winner capture rate comparison
    st.markdown("### 🏆 Winner Capture Rate")
    
    fig_winners = go.Figure()
    
    winner_pcts = [float(row['Winners %'].rstrip('%')) for _, row in comparison_df.iterrows()]
    
    fig_winners.add_trace(go.Bar(
        x=comparison_df['Entry Strategy'],
        y=winner_pcts,
        marker_color='#ff4b4b',
        text=[f"{v:.1f}%" for v in winner_pcts],
        textposition='outside',
    ))
    
    fig_winners.update_layout(
        title="Winner Rate (≥3x) by Entry Strategy",
        xaxis_title="Entry Strategy",
        yaxis_title="Winner Rate (%)",
        height=400,
        showlegend=False
    )
    
    st.plotly_chart(fig_winners, use_container_width=True)
    
    # Detailed cohort breakdown
    st.markdown("### 📈 Cohort Breakdown")
    
    cohort_data = []
    for label, df in filtered_datasets.items():
        stats = calculate_cohort_stats(df)
        cohort_data.append({
            'Entry Strategy': label,
            'Winners (≥3x)': stats['winners'],
            'Losers (2x, no 3x)': stats['losers'],
            'Never 2x': stats['never_2x'],
        })
    
    cohort_df = pd.DataFrame(cohort_data)
    
    fig_cohort = go.Figure()
    
    fig_cohort.add_trace(go.Bar(
        name='Winners (≥3x)',
        x=cohort_df['Entry Strategy'],
        y=cohort_df['Winners (≥3x)'],
        marker_color='#00cc96'
    ))
    
    fig_cohort.add_trace(go.Bar(
        name='Losers (2x, no 3x)',
        x=cohort_df['Entry Strategy'],
        y=cohort_df['Losers (2x, no 3x)'],
        marker_color='#ffa500'
    ))
    
    fig_cohort.add_trace(go.Bar(
        name='Never 2x',
        x=cohort_df['Entry Strategy'],
        y=cohort_df['Never 2x'],
        marker_color='#ff4b4b'
    ))
    
    fig_cohort.update_layout(
        title="Trade Distribution by Cohort",
        xaxis_title="Entry Strategy",
        yaxis_title="Number of Trades",
        barmode='stack',
        height=400
    )
    
    st.plotly_chart(fig_cohort, use_container_width=True)
    
    # Key insights
    st.markdown("### 💡 Key Insights")
    
    # Calculate deltas from immediate entry
    immediate_label = None
    for label in comparison_df['Entry Strategy']:
        if 'immediate' in label.lower() or label == 'Immediate (0%)':
            immediate_label = label
            break
    
    if immediate_label:
        immediate_row = comparison_df[comparison_df['Entry Strategy'] == immediate_label].iloc[0]
        immediate_ev = float(immediate_row['EV from Entry'].rstrip('%'))
        immediate_trades = immediate_row['Total Trades']
        
        st.markdown(f"**Baseline (Immediate Entry)**: {immediate_ev:.1f}% EV, {immediate_trades:,} trades")
        st.markdown("")
        
        for _, row in comparison_df.iterrows():
            if row['Entry Strategy'] == immediate_label:
                continue
            
            ev = float(row['EV from Entry'].rstrip('%'))
            trades = row['Total Trades']
            
            ev_delta = ev - immediate_ev
            trade_delta = trades - immediate_trades
            trade_delta_pct = (trade_delta / immediate_trades * 100) if immediate_trades > 0 else 0
            
            delta_symbol = "📈" if ev_delta > 0 else "📉" if ev_delta < 0 else "➡️"
            trade_symbol = "⬇️" if trade_delta < 0 else "⬆️" if trade_delta > 0 else "➡️"
            
            st.markdown(
                f"{delta_symbol} **{row['Entry Strategy']}**: "
                f"{ev:+.1f}% EV ({ev_delta:+.1f}% vs immediate), "
                f"{trades:,} trades {trade_symbol} ({trade_delta_pct:+.1f}%)"
            )
    
    # Footer
    st.markdown("---")
    st.markdown(f"**QuantBot Comparison Dashboard** | Comparing {len(filtered_datasets)} entry strategies")


if __name__ == "__main__":
    main()

