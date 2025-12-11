
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { logger } from '../../src/utils/logger';

// Zod schema for validation results
const ValidationResultSchema = z.object({
  summary: z.object({
    totalWindows: z.number(),
    avgCorrelation7d: z.number(),
    avgCorrelation30d: z.number(),
    avgPrecisionTop10: z.number(),
    avgPrecisionTop25: z.number(),
    avgRecallTop10: z.number(),
    avgRecallTop25: z.number(),
    avgTop10Return7d: z.number(),
    avgTop10Return30d: z.number(),
    avgBottom10Return7d: z.number(),
    avgBottom10Return30d: z.number(),
  }),
  windows: z.array(z.any()),
});

type ValidationResult = z.infer<typeof ValidationResultSchema>;

const METRIC_EXPLANATIONS: Record<keyof ValidationResult['summary'], string> = {
  totalWindows: 'Total number of time windows analyzed.',
  avgCorrelation7d:
    'SCORE-RETURN CORRELATION (7-DAY): How well do higher scores predict higher returns over 7 days? Ranges from -1 (perfect inverse correlation) to +1 (perfect positive correlation). Values > 0.1 are promising.',
  avgCorrelation30d:
    'SCORE-RETURN CORRELATION (30-DAY): Same as 7-day, but for 30-day returns. This shows long-term predictive power.',
  avgPrecisionTop10:
    'PRECISION (TOP 10%): Of the tokens in the top 10% by score, what percentage were "winners" (e.g., returned >3x)? High precision means high-scoring picks are frequently successful.',
  avgPrecisionTop25:
    'PRECISION (TOP 25%): Same as above, but for the top quarter of tokens by score.',
  avgRecallTop10:
    'RECALL (TOP 10%): Of all the "winner" tokens across the entire set, what percentage did our top 10% scores successfully identify? High recall means the model is good at finding most of the big winners.',
  avgRecallTop25:
    'RECALL (TOP 25%): Same as above, but for the top quarter of tokens.',
  avgTop10Return7d:
    'AVG RETURN OF TOP 10% (7-DAY): The average 7-day return for the highest-scoring 10% of tokens. A key indicator of profitability.',
  avgTop10Return30d:
    'AVG RETURN OF TOP 10% (30-DAY): The average 30-day return for the highest-scoring 10% of tokens.',
  avgBottom10Return7d:
    'AVG RETURN OF BOTTOM 10% (7-DAY): The average 7-day return for the lowest-scoring 10% of tokens. We want this to be much lower than the top 10%.',
  avgBottom10Return30d:
    'AVG RETURN OF BOTTOM 10% (30-DAY): The average 30-day return for the lowest-scoring 10% of tokens.',
};

function findLatestValidationFile(): string | null {
  const dir = path.join(process.cwd(), 'data/exports/brook-analysis');
  if (!fs.existsSync(dir)) {
    return null;
  }
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith('scoring-validation-') && f.endsWith('.json'))
    .map((f) => ({
      name: f,
      time: fs.statSync(path.join(dir, f)).mtime.getTime(),
    }))
    .sort((a, b) => b.time - a.time);

  return files.length > 0 ? path.join(dir, files[0].name) : null;
}

function interpretResults(results: ValidationResult) {
  const { summary } = results;

  console.log('\n--- Interpretation of Scoring Model Validation ---\n');
  console.log('This report analyzes how well our scoring model predicts token performance.');
  console.log(`The analysis was run across ${summary.totalWindows} different time periods ("windows") to ensure consistency.\n`);

  console.log('--- KEY METRICS ---\n');

  for (const [key, explanation] of Object.entries(METRIC_EXPLANATIONS)) {
    if (key === 'totalWindows') continue;
    const value = summary[key as keyof typeof summary];
    console.log(`🔵 ${explanation}`);
    if (key.includes('Return')) {
      console.log(`   - Result: ${value.toFixed(2)}x\n`);
    } else if (key.includes('Correlation')) {
      console.log(`   - Result: ${value.toFixed(3)}\n`);
    } else {
      console.log(`   - Result: ${value.toFixed(2)}%\n`);
    }
  }

  console.log('--- EXECUTIVE SUMMARY ---\n');
  
  const correlationStrength = summary.avgCorrelation30d > 0.1 ? 'promising' : summary.avgCorrelation30d > 0 ? 'weak but positive' : 'not effective';
  console.log(`1. Predictive Power: The model shows a ${correlationStrength} ability to connect higher scores with higher 30-day returns (Correlation: ${summary.avgCorrelation30d.toFixed(3)}). This means scores are somewhat meaningful.`);

  const outperformance = summary.avgTop10Return30d / (summary.avgBottom10Return30d || 1);
  console.log(`2. Profitability: The highest-scoring 10% of tokens returned, on average, ${summary.avgTop10Return30d.toFixed(2)}x over 30 days. This is ${outperformance.toFixed(1)}x better than the lowest-scoring 10% of tokens.`);

  const precisionInsight = summary.avgPrecisionTop10 > 20 ? 'a good number' : 'a decent number';
  console.log(`3. Signal Quality: When the model flags a token with a top 10% score, it has a ${summary.avgPrecisionTop10.toFixed(2)}% chance of being a >3x winner. This tells us that while not every high-scoring pick is a home run, ${precisionInsight} of them are.`);
  
  console.log('\n--- RECOMMENDATION ---\n');
  if (summary.avgCorrelation30d > 0.05 && summary.avgTop10Return30d > 1.5) {
    console.log('The scoring model is effective. It successfully identifies a subset of tokens that, on average, outperform the rest. It should be used as a primary filter for identifying promising calls.');
  } else {
    console.log('The scoring model shows a weak signal. While there is some positive correlation, it is not strong enough to be a reliable primary filter. Further refinement of the scoring features is needed.');
  }
  console.log('\n-----------------------------------------------\n');
}


async function main() {
  const filePath = findLatestValidationFile();
  if (!filePath) {
    logger.error('No validation results file found in data/exports/brook-analysis/');
    return;
  }

  logger.info(`Interpreting results from: ${path.basename(filePath)}`);

  const fileContent = fs.readFileSync(filePath, 'utf-8');
  const jsonData = JSON.parse(fileContent);
  
  try {
    const validationResult = ValidationResultSchema.parse(jsonData);
    interpretResults(validationResult);
  } catch (error) {
    logger.error('Invalid validation file format.', { error });
  }
}

main().catch((err) => {
  logger.error('Failed to interpret validation results.', { error: err });
});
