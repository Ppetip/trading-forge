# EdgeLab UI audit

Last updated: 2026-07-06

Scope: HTML/React structure, CSS, visual hierarchy, contrast, button affordance, themes, and report/workspace usability.

## Executive verdict

The product has a strong dark research-lab identity, but it still carries prototype symptoms:

- Too many routes look visually related while representing different trust levels.
- Several controls use very small text, especially secondary links, table labels, mobile nav, and advanced controls.
- Some buttons look like text links or disabled controls even when they are primary actions.
- Contrast is generally acceptable for primary mint/white text, but weak gray-on-dark labels are overused.
- The best visual system is the SaaS sidebar/report style; older local-lab pages should be visually downgraded or moved behind `/lab`.

## Highest-priority fixes before hosted beta

1. Create one shared button system.
   - Primary: mint filled, high contrast, minimum 40px height.
   - Secondary: dark filled with visible border.
   - Ghost/link: only for navigation, never for destructive or paid actions.
   - Disabled: clear opacity plus helper copy explaining why.

2. Normalize text sizes.
   - Body text should not drop below 12px.
   - Labels/captions should not drop below 11px unless they are purely decorative metadata.
   - Current 7px-9px text appears in multiple CSS files and is too small for a premium hosted product.

3. Promote preflight warnings into the workspace UI.
   - Vague prompt: show missing fields as editable dropdown cards.
   - Premium-data likely: show data-source/paywall warning before running.
   - Live trade advice: redirect to historical-testing copy.
   - Transcript/notes: route to Extract from Video/Notes.

4. Make trust status visually impossible to miss.
   - Verified Evidence: green badge only when audit passes.
   - Research-grade / Proxy / Uploaded / Legacy / Failed: distinct badges.
   - Never use green for negative total R, average R, profit factor below 1, or failed reports.

5. Unify navigation.
   - Customer routes should be:
     - `/` Landing
     - `/app` Test a Strategy
     - `/reports` My Reports
     - `/strategies` Strategy Library
     - `/templates` Strategy Packs
     - `/transcripts` Extract from Video/Notes
     - `/account` Billing and usage
     - `/admin` Admin only
   - Local/demo routes should be renamed or visually marked:
     - `/lab`
     - `/dev`

## Contrast and readability notes

Strong colors:

- Mint action color `#55d6a7` on dark backgrounds works well.
- Main white text on `#090b0f` works well.
- Negative red `#e07171` is readable on dark backgrounds.

Risky patterns:

- Muted text around `#4f5863`, `#515a65`, `#58626d`, and `#606873` can become too dim on `#090b0f` / `#0d1015`.
- Several buttons use dark backgrounds with gray labels and low-contrast borders, making them feel disabled.
- Tiny mono labels often carry important meaning, which is not safe for accessibility.

Recommended tokens:

```css
:root {
  --bg: #090b0f;
  --panel: #0d1015;
  --panel-2: #10161d;
  --border: #27313a;
  --text: #eef3f6;
  --muted: #9aa6b2;
  --subtle: #74808c;
  --accent: #55d6a7;
  --accent-text: #06120e;
  --danger: #e07171;
  --warning: #d1a96f;
}
```

## Button audit

Current issues:

- Some important actions are too small, especially footer/floating shortcut buttons.
- `Run exact rules` and CSV upload states have had low-contrast moments.
- Paywalled controls should remain clickable and open a modal, not silently disable.

Rules:

- Primary action per screen must be visually obvious.
- Button height should be 40-44px on desktop and mobile.
- Icon-only buttons need visible labels or accessible `aria-label`.
- Destructive or risk-changing actions need confirmation or clear copy.

## Form/workspace audit

The workspace should feel like a machine:

1. Paste trading idea.
2. Preflight classifies the request.
3. AI/compiler extracts exact rules only if safe.
4. Missing rules appear as dropdowns.
5. User runs backtest.
6. Report appears with audit/data badges.

Needed UI states:

- `STRATEGY_READY`: show “Ready to validate.”
- `STRATEGY_PARSEABLE`: show extracted assumptions before run.
- `STRATEGY_VAGUE`: show missing fields and dropdowns.
- `LIVE_TRADE_ADVICE`: show “EdgeLab tests historical rules; it does not give live trade calls.”
- `TRANSCRIPT_OR_NOTES`: show “Send this to Extract from Video/Notes.”
- `CODE_ADMIN_DEPLOYMENT`: route to admin/dev support, not strategy parsing.
- `REPORT_REVIEW`: route to report AI review.

## Reports audit

Already strong:

- Frozen report identity.
- Audit metadata.
- Trade tape debug view.
- Interactive charts.
- Negative metric coloring.

Still needed:

- Larger chart panels on report pages.
- Better axis labels and date/r-value tooltips.
- Chart readouts must not push or resize graphs.
- Monthly bars should show month and R value on hover/focus.
- Report tabs should distinguish latest result from report history.

## Theme audit

Current dark theme is the brand. Do not add a bright theme until the core app is stable.

Do add:

- High-contrast dark mode toggle.
- Larger text mode.
- Reduced animation mode.
- Consistent focus rings for keyboard users.

## Accessibility checklist

- All interactive elements keyboard reachable.
- Visible focus state on buttons, links, inputs, cards that act as buttons.
- Minimum body copy 12px.
- Error messages connected to fields.
- Buttons use `<button>` for actions and `<a>` only for navigation.
- Color is not the only signal for pass/fail.
- Tables have useful headers and captions.
- Modals trap focus and close with Escape.

## Recommended next UI implementation pass

1. Add shared CSS component classes:
   - `.ui-button`
   - `.ui-button.primary`
   - `.ui-button.secondary`
   - `.ui-button.ghost`
   - `.ui-badge`
   - `.ui-status`
   - `.ui-field`
2. Replace tiny route shortcut buttons with the sidebar style the user preferred.
3. Add preflight classification panel to the SaaS workspace.
4. Add a high-contrast token pass across all CSS files.
5. Move old/local research routes behind an obvious “Experimental Lab” boundary.

