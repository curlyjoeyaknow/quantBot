#!/usr/bin/env python3
"""
Bayesian Optimization for Strategy Parameters

Uses Gaussian Process regression to efficiently search parameter space.
Requires: scikit-optimize (skopt)
"""

import json
import sys
from typing import Any, Dict, List, Optional, Tuple
from dataclasses import dataclass
import numpy as np

try:
    from skopt import gp_minimize
    from skopt.space import Real, Integer, Categorical
    from skopt.utils import use_named_args
except ImportError:
    print(json.dumps({
        "success": False,
        "error": "scikit-optimize not installed. Run: pip install scikit-optimize"
    }))
    sys.exit(1)


@dataclass
class ParameterSpace:
    """Parameter space definition"""
    name: str
    type: str  # 'real', 'integer', 'categorical'
    low: Optional[float] = None
    high: Optional[float] = None
    categories: Optional[List[Any]] = None


@dataclass
class OptimizationConfig:
    """Bayesian optimization configuration"""
    parameter_space: List[ParameterSpace]
    n_calls: int = 50  # Number of function evaluations
    n_initial_points: int = 10  # Random exploration before GP
    acq_func: str = 'EI'  # Acquisition function: EI, LCB, PI
    random_state: Optional[int] = None


@dataclass
class OptimizationResult:
    """Optimization result"""
    best_params: Dict[str, Any]
    best_score: float
    all_params: List[Dict[str, Any]]
    all_scores: List[float]
    n_iterations: int


def parse_parameter_space(space_def: List[Dict[str, Any]]) -> List[Any]:
    """
    Convert parameter space definition to skopt format
    
    Args:
        space_def: List of parameter definitions
        
    Returns:
        List of skopt dimension objects
    """
    dimensions = []
    
    for param in space_def:
        name = param['name']
        param_type = param['type']
        
        if param_type == 'real':
            dimensions.append(Real(
                low=param['low'],
                high=param['high'],
                name=name
            ))
        elif param_type == 'integer':
            dimensions.append(Integer(
                low=param['low'],
                high=param['high'],
                name=name
            ))
        elif param_type == 'categorical':
            dimensions.append(Categorical(
                categories=param['categories'],
                name=name
            ))
        else:
            raise ValueError(f"Unknown parameter type: {param_type}")
    
    return dimensions


def objective_function_wrapper(
    objective_scores: Dict[str, float],
    parameter_space: List[ParameterSpace]
) -> callable:
    """
    Create objective function for Bayesian optimization
    
    Since we can't actually run simulations in this script,
    we expect pre-computed scores for all parameter combinations.
    
    Args:
        objective_scores: Pre-computed scores keyed by parameter hash
        parameter_space: Parameter space definition
        
    Returns:
        Objective function
    """
    def objective(*args):
        # Convert args to parameter dict
        params = {}
        for i, param_def in enumerate(parameter_space):
            params[param_def.name] = args[i]
        
        # Hash parameters to look up score
        param_hash = hash(frozenset(params.items()))
        param_key = str(param_hash)
        
        # Return negative score (skopt minimizes)
        if param_key in objective_scores:
            return -objective_scores[param_key]
        else:
            # If score not found, return worst possible score
            return 1e10
    
    return objective


def bayesian_optimize(
    config: OptimizationConfig,
    objective_scores: Dict[str, float]
) -> OptimizationResult:
    """
    Run Bayesian optimization
    
    Args:
        config: Optimization configuration
        objective_scores: Pre-computed objective scores
        
    Returns:
        Optimization result
    """
    # Parse parameter space
    dimensions = parse_parameter_space([
        {
            'name': p.name,
            'type': p.type,
            'low': p.low,
            'high': p.high,
            'categories': p.categories
        }
        for p in config.parameter_space
    ])
    
    # Create objective function
    objective = objective_function_wrapper(
        objective_scores,
        config.parameter_space
    )
    
    # Run optimization
    result = gp_minimize(
        func=objective,
        dimensions=dimensions,
        n_calls=config.n_calls,
        n_initial_points=config.n_initial_points,
        acq_func=config.acq_func,
        random_state=config.random_state,
        verbose=False
    )
    
    # Extract results
    best_params = {}
    for i, param_def in enumerate(config.parameter_space):
        best_params[param_def.name] = result.x[i]
    
    all_params = []
    all_scores = []
    for x, score in zip(result.x_iters, result.func_vals):
        params = {}
        for i, param_def in enumerate(config.parameter_space):
            params[param_def.name] = x[i]
        all_params.append(params)
        all_scores.append(-score)  # Convert back to positive
    
    return OptimizationResult(
        best_params=best_params,
        best_score=-result.fun,  # Convert back to positive
        all_params=all_params,
        all_scores=all_scores,
        n_iterations=len(result.x_iters)
    )


def main():
    """Main entry point"""
    try:
        # Read input from stdin
        input_data = json.loads(sys.stdin.read())
        
        # Parse configuration
        config = OptimizationConfig(
            parameter_space=[
                ParameterSpace(**p) for p in input_data['parameter_space']
            ],
            n_calls=input_data.get('n_calls', 50),
            n_initial_points=input_data.get('n_initial_points', 10),
            acq_func=input_data.get('acq_func', 'EI'),
            random_state=input_data.get('random_state')
        )
        
        objective_scores = input_data['objective_scores']
        
        # Run optimization
        result = bayesian_optimize(config, objective_scores)
        
        # Output result
        output = {
            "success": True,
            "best_params": result.best_params,
            "best_score": result.best_score,
            "all_params": result.all_params,
            "all_scores": result.all_scores,
            "n_iterations": result.n_iterations
        }
        
        print(json.dumps(output))
        
    except Exception as e:
        print(json.dumps({
            "success": False,
            "error": str(e)
        }))
        sys.exit(1)


if __name__ == '__main__':
    main()

