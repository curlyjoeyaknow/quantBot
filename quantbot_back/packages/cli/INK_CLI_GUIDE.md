# 🎨 Ink-Based Interactive CLI

The interactive simulation CLI has been converted to use **Ink** (React for CLIs) for a beautiful, component-based interface.

## ✨ Features

- **React-based UI** - Component-driven architecture
- **Arrow key navigation** - Smooth, intuitive controls
- **Real-time state management** - React hooks for state
- **Beautiful rendering** - Ink's optimized terminal rendering
- **Step-by-step workflow** - Guided prompts

## 🚀 Usage

```bash
# From workspace root
pnpm --filter @quantbot/cli build
pnpm --filter @quantbot/cli cli sim

# Or use node directly
node packages/cli/dist/bin/quantbot.js sim
```

## 🎯 Interactive Flow

1. **Loading** - Fetches strategies and callers from database
2. **Strategy Selection** - Choose from active strategies (↑↓ to navigate)
3. **Caller Filter** - Optionally filter by caller (or select "All callers")
4. **Start Date** - Select year → month → enter day
5. **End Date** - Select year → month → enter day
6. **Pre-window** - Minutes before call timestamp
7. **Post-window** - Minutes after call timestamp
8. **Dry Run** - Confirm whether to persist results
9. **Summary** - Review configuration before execution
10. **Running** - Shows progress while simulation runs
11. **Results** - Beautiful formatted results display

## ⌨️ Controls

- **↑/↓ Arrow Keys** - Navigate lists
- **Enter** - Select/Confirm
- **Type** - Enter day numbers or custom values
- **Ctrl+C** - Cancel at any time

## 📦 Dependencies

- `ink` - React for CLIs
- `ink-select-input` - Select dropdowns
- `ink-text-input` - Text input fields
- `react` - React runtime

## 🎨 Component Structure

```
InteractiveSimulationApp (main component)
├── LoadingScreen
├── StrategySelection
├── CallerSelection
├── YearSelection
├── MonthSelection
├── DayInput
├── WindowSelection
├── DryRunConfirmation
├── SummaryScreen
├── RunningScreen
├── ResultsScreen
└── ErrorScreen
```

## 🔧 Technical Details

### State Management
- Uses React `useState` for step-by-step state
- `useEffect` for async data loading
- `useInput` hook for keyboard input
- `useApp` hook for app lifecycle

### Date Validation
- Automatically calculates max days per month
- Handles leap years
- Validates date ranges

### Error Handling
- Graceful error display
- Helpful error messages
- Database connection errors handled

## 🐛 Troubleshooting

### "Cannot find module 'ink'"
**Solution**: Ensure packages are installed:
```bash
cd packages/cli && pnpm install
```

### TypeScript errors
**Note**: The build uses `@ts-expect-error` for ink imports due to workspace module resolution. The code works at runtime.

### No strategies found
**Solution**: Seed strategies first:
```bash
ts-node scripts/workflows/seed-strategies.ts
```

## 🎯 Comparison: Ink vs Inquirer

| Feature | Ink (Current) | Inquirer (Old) |
|---------|---------------|----------------|
| Architecture | React components | Callback-based |
| State Management | React hooks | Manual state |
| UI Flexibility | High (JSX) | Medium (templates) |
| Performance | Optimized rendering | Good |
| Type Safety | Full TypeScript | Partial |
| Learning Curve | React knowledge | Simpler |

## 📝 Example Session

```
🎯 Select Strategy
Use ↑↓ to navigate, Enter to select

❯ IchimokuV1 (v1) - Ichimoku cloud strategy
  PT2_SL25 (v1) - 2x profit target with 25% stop loss
  Scalper_Fast (v1) - Fast scalping strategy

[User presses Enter on IchimokuV1]

📞 Filter by Caller (Optional)
Use ↑↓ to navigate, Enter to select

❯ (All callers)
  brook/main (Brook - Main Account)
  lsy/alpha (LSY Alpha)

[User selects "All callers"]

📅 Start Date - Select Year
Use ↑↓ to navigate, Enter to select

❯ 2025
  2024
  2023

[... continues through workflow ...]
```

## 🚀 Next Steps

1. **Test the CLI**: Run `quantbot sim` and go through the flow
2. **Add more features**: Progress bars, animations, etc.
3. **Customize styling**: Use Ink's styling system
4. **Add keyboard shortcuts**: More navigation options

## 📚 Resources

- [Ink Documentation](https://github.com/vadimdemedes/ink)
- [React Hooks](https://react.dev/reference/react)
- [Ink Examples](https://github.com/vadimdemedes/ink/tree/main/examples)

