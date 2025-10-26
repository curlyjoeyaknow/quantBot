const fs = require('fs');
const path = require('path');

// Import services
const { callerTracking } = require('../src/services/caller-tracking');

/**
 * Generate comprehensive caller analysis report
 */
async function generateCallerAnalysisReport() {
  console.log('📊 Generating comprehensive caller analysis report...');
  
  try {
    await callerTracking.initialize();
    
    // Get database statistics
    const dbStats = await callerTracking.getDatabaseStats();
    const topCallers = await callerTracking.getTopCallers(50);
    
    // Generate detailed analysis for top 20 callers
    const detailedAnalysis = [];
    for (let i = 0; i < Math.min(20, topCallers.length); i++) {
      const caller = topCallers[i];
      const stats = await callerTracking.getCallerStats(caller.callerName);
      const tokens = await callerTracking.getCallerTokens(caller.callerName);
      
      detailedAnalysis.push({
        rank: i + 1,
        callerName: caller.callerName,
        stats: stats,
        topTokens: tokens.slice(0, 10), // Top 10 tokens
        tokenDiversity: tokens.length
      });
    }
    
    // Generate report
    const report = {
      generatedAt: new Date().toISOString(),
      databaseStats: dbStats,
      topCallers: topCallers,
      detailedAnalysis: detailedAnalysis,
      insights: generateInsights(dbStats, topCallers, detailedAnalysis)
    };
    
    // Save report
    const reportPath = path.join(__dirname, '../caller_analysis_report.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    
    // Generate markdown report
    const markdownReport = generateMarkdownReport(report);
    const markdownPath = path.join(__dirname, '../CALLER_ANALYSIS_REPORT.md');
    fs.writeFileSync(markdownPath, markdownReport);
    
    console.log(`📋 Analysis report saved to: ${reportPath}`);
    console.log(`📋 Markdown report saved to: ${markdownPath}`);
    
    // Print summary
    printSummary(report);
    
  } catch (error) {
    console.error('❌ Failed to generate caller analysis report:', error);
  } finally {
    await callerTracking.close();
  }
}

/**
 * Generate insights from the data
 */
function generateInsights(dbStats, topCallers, detailedAnalysis) {
  const insights = [];
  
  // Volume insights
  const totalAlerts = dbStats.totalAlerts;
  const avgAlertsPerCaller = totalAlerts / dbStats.totalCallers;
  
  insights.push({
    type: 'volume',
    title: 'Alert Volume Analysis',
    description: `Average ${avgAlertsPerCaller.toFixed(1)} alerts per caller across ${dbStats.totalCallers} callers`,
    details: [
      `Top 10 callers account for ${topCallers.slice(0, 10).reduce((sum, c) => sum + c.alertCount, 0)} alerts (${((topCallers.slice(0, 10).reduce((sum, c) => sum + c.alertCount, 0) / totalAlerts) * 100).toFixed(1)}%)`,
      `Most active caller: ${topCallers[0].callerName} with ${topCallers[0].alertCount} alerts`,
      `Date range: ${dbStats.dateRange.start.toISOString().split('T')[0]} to ${dbStats.dateRange.end.toISOString().split('T')[0]}`
    ]
  });
  
  // Token diversity insights
  const avgTokensPerCaller = detailedAnalysis.reduce((sum, c) => sum + c.tokenDiversity, 0) / detailedAnalysis.length;
  const mostDiverseCaller = detailedAnalysis.reduce((max, c) => c.tokenDiversity > max.tokenDiversity ? c : max);
  
  insights.push({
    type: 'diversity',
    title: 'Token Diversity Analysis',
    description: `Average ${avgTokensPerCaller.toFixed(1)} unique tokens per caller`,
    details: [
      `Most diverse caller: ${mostDiverseCaller.callerName} with ${mostDiverseCaller.tokenDiversity} unique tokens`,
      `Total unique tokens across all callers: ${dbStats.totalTokens}`,
      `Average alerts per token: ${(totalAlerts / dbStats.totalTokens).toFixed(1)}`
    ]
  });
  
  // Activity patterns
  const activeCallers = topCallers.filter(c => c.alertCount >= 10);
  const veryActiveCallers = topCallers.filter(c => c.alertCount >= 50);
  
  insights.push({
    type: 'activity',
    title: 'Activity Pattern Analysis',
    description: `${activeCallers.length} callers with 10+ alerts, ${veryActiveCallers.length} with 50+ alerts`,
    details: [
      `Active callers (10+ alerts): ${activeCallers.length}/${topCallers.length} (${((activeCallers.length / topCallers.length) * 100).toFixed(1)}%)`,
      `Very active callers (50+ alerts): ${veryActiveCallers.length}/${topCallers.length} (${((veryActiveCallers.length / topCallers.length) * 100).toFixed(1)}%)`,
      `Callers with single alerts: ${topCallers.filter(c => c.alertCount === 1).length}`
    ]
  });
  
  return insights;
}

/**
 * Generate markdown report
 */
function generateMarkdownReport(report) {
  const { databaseStats, topCallers, detailedAnalysis, insights } = report;
  
  let markdown = `# Caller Analysis Report\n\n`;
  markdown += `Generated: ${new Date(report.generatedAt).toLocaleString()}\n\n`;
  
  // Database Statistics
  markdown += `## 📊 Database Statistics\n\n`;
  markdown += `- **Total Alerts**: ${databaseStats.totalAlerts.toLocaleString()}\n`;
  markdown += `- **Total Callers**: ${databaseStats.totalCallers}\n`;
  markdown += `- **Total Tokens**: ${databaseStats.totalTokens.toLocaleString()}\n`;
  markdown += `- **Date Range**: ${databaseStats.dateRange.start.toISOString().split('T')[0]} to ${databaseStats.dateRange.end.toISOString().split('T')[0]}\n\n`;
  
  // Top Callers
  markdown += `## 🏆 Top 20 Callers\n\n`;
  markdown += `| Rank | Caller Name | Alerts | Unique Tokens | Avg/Day |\n`;
  markdown += `|------|------------|--------|---------------|--------|\n`;
  
  topCallers.slice(0, 20).forEach((caller, index) => {
    const stats = detailedAnalysis.find(d => d.callerName === caller.callerName)?.stats;
    const avgPerDay = stats ? stats.avgAlertsPerDay.toFixed(1) : 'N/A';
    markdown += `| ${index + 1} | ${caller.callerName} | ${caller.alertCount} | ${caller.uniqueTokens} | ${avgPerDay} |\n`;
  });
  
  markdown += `\n`;
  
  // Insights
  markdown += `## 💡 Key Insights\n\n`;
  insights.forEach(insight => {
    markdown += `### ${insight.title}\n\n`;
    markdown += `${insight.description}\n\n`;
    insight.details.forEach(detail => {
      markdown += `- ${detail}\n`;
    });
    markdown += `\n`;
  });
  
  // Detailed Analysis
  markdown += `## 📋 Detailed Caller Analysis\n\n`;
  detailedAnalysis.forEach(caller => {
    markdown += `### ${caller.rank}. ${caller.callerName}\n\n`;
    markdown += `- **Total Alerts**: ${caller.stats.totalAlerts}\n`;
    markdown += `- **Unique Tokens**: ${caller.stats.uniqueTokens}\n`;
    markdown += `- **First Alert**: ${caller.stats.firstAlert.toISOString().split('T')[0]}\n`;
    markdown += `- **Last Alert**: ${caller.stats.lastAlert.toISOString().split('T')[0]}\n`;
    markdown += `- **Avg Alerts/Day**: ${caller.stats.avgAlertsPerDay}\n\n`;
    
    if (caller.topTokens.length > 0) {
      markdown += `**Top Tokens:**\n`;
      caller.topTokens.slice(0, 5).forEach((token, index) => {
        markdown += `${index + 1}. ${token.tokenSymbol || 'UNKNOWN'} (${token.tokenAddress}) - ${token.alertCount} alerts\n`;
      });
      markdown += `\n`;
    }
  });
  
  return markdown;
}

/**
 * Print summary to console
 */
function printSummary(report) {
  const { databaseStats, topCallers, insights } = report;
  
  console.log('\n🎉 === CALLER ANALYSIS COMPLETE ===');
  console.log(`📊 Database Stats:`);
  console.log(`   - Total alerts: ${databaseStats.totalAlerts.toLocaleString()}`);
  console.log(`   - Total callers: ${databaseStats.totalCallers}`);
  console.log(`   - Total tokens: ${databaseStats.totalTokens.toLocaleString()}`);
  console.log(`   - Date range: ${databaseStats.dateRange.start.toISOString().split('T')[0]} to ${databaseStats.dateRange.end.toISOString().split('T')[0]}`);
  
  console.log(`\n🏆 Top 10 Callers:`);
  topCallers.slice(0, 10).forEach((caller, index) => {
    console.log(`   ${index + 1}. ${caller.callerName.padEnd(30)} ${caller.alertCount.toString().padStart(4)} alerts, ${caller.uniqueTokens.toString().padStart(3)} tokens`);
  });
  
  console.log(`\n💡 Key Insights:`);
  insights.forEach(insight => {
    console.log(`   📈 ${insight.title}: ${insight.description}`);
  });
}

/**
 * Show caller comparison
 */
async function compareCallers(callerNames) {
  console.log(`🔄 Comparing callers: ${callerNames.join(', ')}`);
  
  try {
    await callerTracking.initialize();
    
    const comparisons = [];
    
    for (const callerName of callerNames) {
      const stats = await callerTracking.getCallerStats(callerName);
      const tokens = await callerTracking.getCallerTokens(callerName);
      
      if (stats) {
        comparisons.push({
          callerName,
          stats,
          tokenCount: tokens.length,
          topTokens: tokens.slice(0, 5)
        });
      } else {
        console.log(`❌ No data found for caller: ${callerName}`);
      }
    }
    
    // Print comparison table
    console.log('\n📊 === CALLER COMPARISON ===');
    console.log(`| Caller | Alerts | Tokens | Avg/Day | First Alert | Last Alert |`);
    console.log(`|--------|--------|--------|---------|-------------|------------|`);
    
    comparisons.forEach(caller => {
      console.log(`| ${caller.callerName.padEnd(20)} | ${caller.stats.totalAlerts.toString().padStart(6)} | ${caller.stats.uniqueTokens.toString().padStart(6)} | ${caller.stats.avgAlertsPerDay.toString().padStart(7)} | ${caller.stats.firstAlert.toISOString().split('T')[0]} | ${caller.stats.lastAlert.toISOString().split('T')[0]} |`);
    });
    
    // Show top tokens for each caller
    console.log('\n🎯 Top Tokens by Caller:');
    comparisons.forEach(caller => {
      console.log(`\n${caller.callerName}:`);
      caller.topTokens.forEach((token, index) => {
        console.log(`  ${index + 1}. ${token.tokenSymbol || 'UNKNOWN'} (${token.alertCount} alerts)`);
      });
    });
    
  } catch (error) {
    console.error('❌ Failed to compare callers:', error);
  } finally {
    await callerTracking.close();
  }
}

// Run analysis if this script is executed directly
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.includes('--compare')) {
    const callerNames = args.filter(arg => arg !== '--compare');
    if (callerNames.length === 0) {
      console.log('Usage: node scripts/analyze-callers.js --compare <caller1> <caller2> [caller3] ...');
      process.exit(1);
    }
    
    compareCallers(callerNames)
      .then(() => process.exit(0))
      .catch(console.error);
  } else {
    generateCallerAnalysisReport()
      .then(() => process.exit(0))
      .catch(console.error);
  }
}

module.exports = { generateCallerAnalysisReport, compareCallers };
