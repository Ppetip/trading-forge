# EdgeLab Project Overview

## Project Name

**EdgeLab**

## One-Line Description

EdgeLab is a trading strategy research workspace where users can define, backtest, compare, save, and export trading strategies without needing to code everything manually.

---

## Product Goal

Build a clean web app that helps traders move from an idea to a tested strategy.

A user should be able to describe a setup, review the exact rules, run a backtest, and see clear results such as win rate, trade count, risk-to-reward, average R, profit factor, drawdown, and trade history.

The app should feel like a serious research tool, not an “AI trading bot.” AI can help translate plain English into strategy rules, but the main product is the testing workspace, dashboard, and strategy library.

---

## Core Idea

Most traders have strategy ideas but struggle to test them quickly.

EdgeLab should let users:
- Write or build a strategy
- Review the exact logic before testing
- Run a real backtest
- See honest performance data
- Compare multiple versions
- Save what works
- Export rules or Pine Script

The app should focus on clarity, speed, and trust.

---

## Target User

EdgeLab is for retail traders who want to test simple rule-based strategies without spending hours coding.

The main user is someone who:
- Trades futures, stocks, forex, or crypto
- Uses ideas like ORB, sweeps, breakouts, reversals, and moving averages
- Wants win rate, RR, average R, drawdown, and trade count
- Wants to compare strategy variations fast
- May use TradingView but does not want to write Pine Script from scratch

---

## Main User Space

The app should be built around a central workspace, not just a chat box.

### Main Sections

1. **Strategy Workspace**
   - User creates or edits a strategy
   - Rules are shown clearly
   - Strategy settings can be changed before testing

2. **Backtest Dashboard**
   - Shows performance stats
   - Includes charts, trade logs, drawdown, and monthly breakdowns

3. **Strategy Library**
   - Saved strategies
   - Previous test results
   - Favorite strategies
   - Draft strategies

4. **Comparison Lab**
   - Compare different settings side by side
   - Example: 15-minute ORB vs 30-minute ORB
   - Rank by average R, drawdown, win rate, and trade count

5. **User Preferences**
   - Default market
   - Default symbol
   - Default timeframe
   - Default date range
   - Default risk reward
   - Session timezone
   - Slippage and fees settings
   - Chart style
   - Light/dark mode

---

## Main User Flow

1. User opens the Strategy Workspace.
2. User either types a strategy idea or chooses a starter template.
3. The app converts the idea into structured strategy rules.
4. The user reviews and edits the rules.
5. User clicks **Run Backtest**.
6. The Backtest Dashboard shows results.
7. User can adjust settings and rerun.
8. User can save the strategy to the Strategy Library.
9. User can compare versions in the Comparison Lab.
10. User can export the strategy as Pine Script.

---

## Example User Input

> Test three years of the 8 AM opening range breakout on NQ. Enter when price breaks the opening range high or low. Use a 1:3 risk reward ratio. Show win rate, trade count, profit factor, max drawdown, and average R.

---

## Example Strategy Rules

Before testing, the app should show the rules clearly:

```json
{
  "strategy_type": "opening_range_breakout",
  "symbol": "NQ",
  "timeframe": "5m",
  "date_range": "3y",
  "session_time": "08:00",
  "opening_range_minutes": 15,
  "entry_rule": "break_above_or_below_range",
  "stop_rule": "opposite_side_of_range",
  "take_profit": "3R",
  "direction": "long_and_short",
  "max_trades_per_day": 1,
  "fees": true,
  "slippage": true
}
```

The app should never hide the rules from the user. If it makes assumptions, it should clearly show them.

---

## Default Strategy Settings

If the user does not provide details, use these defaults:

- Market: Futures
- Symbol: NQ
- Timeframe: 5-minute candles
- Date range: 3 years
- Opening range length: 15 minutes
- Risk reward: 1:3
- Risk per trade: 1R
- Max trades: 1 per session
- Slippage: enabled
- Fees: enabled
- Direction: long and short
- Timezone: user-selected, default New York time

---

## MVP Strategy Types

Start with simple rule-based strategies:

- Opening range breakout
- Previous day high/low breakout
- Previous day high/low sweep and reversal
- Moving average crossover
- Moving average pullback
- RSI reversal
- Support and resistance breakout

The first strategy to build should be **opening range breakout**, because it is simple, popular, and easy to test visually.

---

## Backtest Result Metrics

The results dashboard should show:

- Total trades
- Win rate
- Wins and losses
- Average R
- Total R
- Profit factor
- Max drawdown
- Longest losing streak
- Best month
- Worst month
- Equity curve
- Drawdown chart
- Monthly performance
- Trade log
- Entry, stop, target, and result for each trade

The app should focus on **R-based results** first. Dollars can be added later.

---

## Dashboard Layout

The dashboard should feel simple and professional.

### Top Stat Cards

- Total R
- Win Rate
- Trades
- Average R
- Profit Factor
- Max Drawdown

### Main Charts

- Equity curve
- Drawdown chart
- Monthly performance chart

### Trade Review Area

- Trade table
- Entry price
- Stop loss
- Take profit
- Result in R
- Date and time
- Long or short
- Screenshot/replay area if possible

---

## UI Design Direction

The design should be clean, dark, fast, and focused.

Avoid a generic “AI app” look. Do not make the whole interface just a chat screen.

Use a layout closer to a trading research terminal:

- Left sidebar for navigation
- Main workspace in the center
- Right settings panel for strategy rules
- Stat cards at the top of dashboards
- Clean tables for trade logs
- Simple charts with clear labels
- Dark mode first
- Minimal animations
- No hype language
- No fake profitability badges

The app should feel like a serious tool for testing edge.

---

## Important Product Rules

- Always show the exact rules before running a backtest.
- Never say a strategy works unless the data supports it.
- Do not hide weak results.
- Show assumptions clearly.
- Make every backtest repeatable.
- Save inputs and settings with each run.
- Keep AI as a helper, not the main product.
- Focus on strategy testing, not trade signals.

---

## Pine Script Export

After a backtest, the user should be able to export a TradingView Pine Script version of the tested rules.

The app should warn:

> Pine Script results may differ because of data source, session handling, slippage, fees, and TradingView execution rules.

---

## MVP Pages

- Landing page
- Strategy Workspace
- Backtest Dashboard
- Strategy Library
- Comparison Lab
- User Preferences
- Saved Backtest Detail Page

---

## Suggested Tech Stack

### Frontend
- Next.js
- React
- Tailwind CSS
- Shadcn/UI or custom components
- Lightweight charting library

### Backend
- API routes or separate backend service
- Strategy parser
- Backtest engine
- Historical candle data adapter
- Pine Script generator

### Database
- Users
- Strategies
- Backtest runs
- Trades
- User preferences
- Saved presets

---

## Build Order

1. Create the main app layout and navigation.
2. Build the Strategy Workspace UI.
3. Add editable strategy rule forms.
4. Build the opening range breakout backtest engine.
5. Create the Backtest Dashboard.
6. Save backtest runs and trades.
7. Add Strategy Library.
8. Add Comparison Lab.
9. Add Pine Script export.
10. Add more strategy templates.

---

## Final Vision

EdgeLab should become a strategy testing workspace where traders can move fast without guessing.

The product should help users answer one question:

> Did this trading idea actually have an edge when tested with clear rules?

The app should be honest, visual, editable, and built around real backtest results.
