#!/usr/bin/env python3
"""
Multi-Objective Pareto Frontier Computation

Finds Pareto-optimal solutions for multi-objective optimization.
"""

import json
import sys
from typing import Any, Dict, List, Tuple
from dataclasses import dataclass
import numpy as np


@dataclass
class Solution:
    """A solution with multiple objectives"""
    params: Dict[str, Any]
    objectives: Dict[str, float]  # objective_name -> value
    
    def dominates(self, other: 'Solution', maximize: Dict[str, bool]) -> bool:
        """
        Check if this solution dominates another
        
        A solution dominates another if it's better in at least one objective
        and not worse in any objective.
        """
        better_in_any = False
        
        for obj_name, obj_value in self.objectives.items():
            other_value = other.objectives[obj_name]
            
            if maximize.get(obj_name, True):
                # Maximize this objective
                if obj_value < other_value:
                    return False  # Worse in this objective
                if obj_value > other_value:
                    better_in_any = True
            else:
                # Minimize this objective
                if obj_value > other_value:
                    return False  # Worse in this objective
                if obj_value < other_value:
                    better_in_any = True
        
        return better_in_any


def compute_pareto_frontier(
    solutions: List[Solution],
    maximize: Dict[str, bool]
) -> List[Solution]:
    """
    Compute Pareto frontier from a set of solutions
    
    Args:
        solutions: List of solutions with multiple objectives
        maximize: Dict indicating whether to maximize each objective
        
    Returns:
        List of Pareto-optimal solutions
    """
    pareto_front = []
    
    for candidate in solutions:
        is_dominated = False
        
        # Check if candidate is dominated by any other solution
        for other in solutions:
            if other is candidate:
                continue
            
            if other.dominates(candidate, maximize):
                is_dominated = True
                break
        
        if not is_dominated:
            pareto_front.append(candidate)
    
    return pareto_front


def compute_hypervolume(
    pareto_front: List[Solution],
    reference_point: Dict[str, float],
    maximize: Dict[str, bool]
) -> float:
    """
    Compute hypervolume indicator for Pareto front
    
    Hypervolume measures the volume of objective space dominated by the front.
    Higher is better.
    
    Args:
        pareto_front: Pareto-optimal solutions
        reference_point: Reference point for hypervolume calculation
        maximize: Dict indicating whether to maximize each objective
        
    Returns:
        Hypervolume value
    """
    if not pareto_front:
        return 0.0
    
    # Simple 2D hypervolume calculation
    # For more dimensions, use specialized algorithms
    
    objective_names = list(pareto_front[0].objectives.keys())
    
    if len(objective_names) == 2:
        # 2D hypervolume
        obj1, obj2 = objective_names
        
        # Sort by first objective
        sorted_front = sorted(
            pareto_front,
            key=lambda s: s.objectives[obj1],
            reverse=maximize.get(obj1, True)
        )
        
        hypervolume = 0.0
        prev_obj1 = reference_point[obj1]
        
        for solution in sorted_front:
            obj1_val = solution.objectives[obj1]
            obj2_val = solution.objectives[obj2]
            
            width = abs(obj1_val - prev_obj1)
            height = abs(obj2_val - reference_point[obj2])
            
            hypervolume += width * height
            prev_obj1 = obj1_val
        
        return hypervolume
    else:
        # For higher dimensions, return approximate hypervolume
        # (sum of dominated volumes)
        total_volume = 0.0
        
        for solution in pareto_front:
            volume = 1.0
            for obj_name, obj_value in solution.objectives.items():
                ref_value = reference_point[obj_name]
                volume *= abs(obj_value - ref_value)
            total_volume += volume
        
        return total_volume


def rank_pareto_solutions(
    pareto_front: List[Solution],
    weights: Dict[str, float]
) -> List[Tuple[Solution, float]]:
    """
    Rank Pareto-optimal solutions using weighted sum
    
    Args:
        pareto_front: Pareto-optimal solutions
        weights: Weights for each objective
        
    Returns:
        List of (solution, score) tuples, sorted by score descending
    """
    ranked = []
    
    for solution in pareto_front:
        score = 0.0
        for obj_name, obj_value in solution.objectives.items():
            weight = weights.get(obj_name, 1.0)
            score += weight * obj_value
        
        ranked.append((solution, score))
    
    # Sort by score descending
    ranked.sort(key=lambda x: x[1], reverse=True)
    
    return ranked


def main():
    """Main entry point"""
    try:
        # Read input from stdin
        input_data = json.loads(sys.stdin.read())
        
        # Parse solutions
        solutions = [
            Solution(
                params=sol['params'],
                objectives=sol['objectives']
            )
            for sol in input_data['solutions']
        ]
        
        maximize = input_data.get('maximize', {})
        reference_point = input_data.get('reference_point', {})
        weights = input_data.get('weights', {})
        
        # Compute Pareto frontier
        pareto_front = compute_pareto_frontier(solutions, maximize)
        
        # Compute hypervolume (if reference point provided)
        hypervolume = None
        if reference_point:
            hypervolume = compute_hypervolume(pareto_front, reference_point, maximize)
        
        # Rank solutions (if weights provided)
        ranked = None
        if weights:
            ranked_solutions = rank_pareto_solutions(pareto_front, weights)
            ranked = [
                {
                    'params': sol.params,
                    'objectives': sol.objectives,
                    'score': score
                }
                for sol, score in ranked_solutions
            ]
        
        # Output result
        output = {
            "success": True,
            "pareto_front": [
                {
                    'params': sol.params,
                    'objectives': sol.objectives
                }
                for sol in pareto_front
            ],
            "pareto_count": len(pareto_front),
            "total_count": len(solutions),
            "hypervolume": hypervolume,
            "ranked": ranked
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

