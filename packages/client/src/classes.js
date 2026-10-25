/**
 * The default UI's class names.
 *
 * Each element the shell builds gets its `hai-*` hook, the name pages and
 * tests find it by, followed by the `hai:` utilities that style it. The
 * stylesheet is compiled from this file: scripts/build-css.mjs reads it, so
 * every class name is written out whole, never put together from parts, or it
 * has no rule. Strings may be joined from whole names, as the shared pieces
 * below are.
 *
 * The hooks are API; the utilities aren't. Nothing here relies on Tailwind's
 * preflight, so the shell looks the same on a page with it and one without:
 * every element with padding or a border says which box it sizes, every button
 * resets what the browser gives buttons, and fonts are set longhand, since a
 * `font:` shorthand among them would win over the rest.
 */

// ── shared pieces ─────────────────────────────────────────────────────
// the buttons' focus ring, 2px outside them
const RING = "hai:focus-visible:outline-3 hai:focus-visible:outline-fg hai:focus-visible:outline-offset-2";
// a card in the transcript: an ink border, on the panel, under the shadow
const CARD = "hai:mb-18 hai:box-content hai:overflow-hidden hai:rounded-hai hai:border-3 hai:border-line hai:bg-panel hai:shadow-hai";
// an icon's box, before its size: it never shrinks, and sits on the baseline
const ICON = "hai-icon hai:flex-none hai:align-baseline";
// the icon in a bar's cell, the dock's buttons and Remove all
const ICON_16_BOLD = `${ICON} hai:size-16 hai:stroke-[2.5]`;
// the icon in a dock item, a pile row and a docked stub
const ICON_14_BOLD = `${ICON} hai:size-14 hai:stroke-[2.5]`;
// a status's text: the row's, or the window's badge
const STATUS =
  "hai-tstatus hai:box-content hai:max-w-[50%] hai:overflow-hidden hai:text-ellipsis hai:border-2 hai:border-line hai:bg-panel hai:px-8 hai:py-1 hai:text-fg hai:font-mono hai:text-[12px] hai:font-bold hai:leading-[normal] hai:tabular-nums hai:[.hai-status-resolved_&]:bg-selected hai:[.hai-status-expired_&]:bg-transparent";
// a dot in the status line and on a waiting row
const PULSE =
  "hai-pulse hai:box-border hai:size-12 hai:flex-none hai:rounded-[50%] hai:border-2 hai:border-current hai:bg-warn hai:animate-[hai-pulse_1.8s_ease-out_infinite] hai:motion-reduce:animate-none";
// how a docked surface or the pile looks on the shelf
const DOCK_ITEM =
  "hai-dock-item hai:relative hai:box-border hai:inline-flex hai:h-36 hai:flex-none hai:cursor-pointer hai:items-center hai:gap-8 hai:rounded-hai hai:border-2 hai:border-line hai:bg-panel hai:px-12 hai:py-0 hai:whitespace-nowrap hai:text-fg hai:shadow-[3px_3px_0_var(--hai-line)] hai:font-mono hai:text-[12px] hai:font-bold hai:leading-[normal] hai:[&[hidden]]:hidden hai:hover:bg-[linear-gradient(var(--hai-hover)_0_0)] hai:data-[status=awaiting]:not-aria-expanded:bg-warn hai:data-[status=awaiting]:not-aria-expanded:text-on-accent hai:aria-expanded:[background:var(--hai-fg)] hai:aria-expanded:text-panel hai:aria-expanded:shadow-none hai:aria-expanded:transform-[translate(3px,3px)] hai:data-[status=expired]:border-dashed hai:data-[status=expired]:border-dim hai:data-[status=expired]:[background:transparent] hai:data-[status=expired]:shadow-none hai:data-[status=expired]:text-dim hai:pointer-coarse:h-44 " +
  RING;
// a scrolling panel's thin scrollbar, in ink
const SCROLLBAR = "hai:[scrollbar-width:thin] hai:[scrollbar-color:var(--hai-line)_transparent]";

// ── shell ─────────────────────────────────────────────────────────────
export const shell = "hai-shell hai:flex hai:h-dvh hai:flex-col hai:bg-bg hai:text-fg hai:font-sans hai:text-[14px] hai:font-normal hai:leading-[1.5] hai:antialiased";
export const icon = `${ICON} hai:size-16`;

export const top = "hai-top hai:box-content hai:flex hai:h-56 hai:flex-none hai:items-center hai:gap-12 hai:border-b-3 hai:border-b-line hai:bg-panel hai:pr-10 hai:pl-16";
export const brand = "hai-brand hai:flex hai:min-w-0 hai:items-center hai:gap-10";
export const markSmall = "hai-logo hai-mark hai:size-22 hai:flex-none hai:align-baseline";
export const logoParts = {
  ink: "hai-logo-ink hai:fill-logo-ink",
  paper: "hai-logo-paper hai:fill-logo-paper",
  "paper-dim": "hai-logo-paper-dim hai:fill-logo-paper hai:opacity-50",
  hot: "hai-logo-hot hai:fill-logo-hot",
};
export const title = "hai-title hai:text-[16px] hai:font-bold hai:tracking-[-.01em] hai:whitespace-nowrap";
export const subtitle =
  "hai-subtitle hai:box-content hai:overflow-hidden hai:border-l-2 hai:border-l-line hai:pl-10 hai:text-ellipsis hai:whitespace-nowrap hai:text-[13px] hai:text-dim hai:max-[900px]:hidden";

export const actions = "hai-actions hai:ml-auto hai:flex hai:flex-none hai:items-center hai:gap-4";
export const model =
  "hai-model hai:mr-6 hai:box-content hai:inline-flex hai:items-center hai:gap-6 hai:rounded-hai hai:border-2 hai:border-line hai:px-8 hai:py-2 hai:font-mono hai:text-[11.5px] hai:font-bold hai:leading-[normal] hai:before:box-border hai:before:size-10 hai:before:rounded-[50%] hai:before:border-2 hai:before:border-current hai:before:bg-good hai:before:content-[''] hai:[&[hidden]]:hidden hai:max-[600px]:hidden";

export const btn =
  "hai-btn hai:box-border hai:inline-flex hai:h-34 hai:cursor-pointer hai:items-center hai:gap-7 hai:rounded-hai hai:border-2 hai:border-transparent hai:bg-transparent hai:px-10 hai:py-0 hai:text-dim hai:[font-family:inherit] hai:[line-height:inherit] hai:text-[13px] hai:font-semibold hai:hover:enabled:border-line hai:hover:enabled:bg-hover hai:hover:enabled:text-fg hai:aria-expanded:border-line hai:aria-expanded:bg-hover hai:aria-expanded:text-fg hai:disabled:cursor-default hai:disabled:opacity-40 hai:max-[900px]:px-8 " +
  RING;
// Context, which says how much the model holds beside its label
export const ctxToggle = btn.replace("hai-btn ", "hai-btn hai-ctx-toggle ");
export const btnLabel =
  "hai-btn-label hai:max-[900px]:absolute hai:max-[900px]:size-1 hai:max-[900px]:overflow-hidden hai:max-[900px]:[clip-path:inset(50%)] hai:max-[900px]:whitespace-nowrap";
export const ctxCount = "hai-ctx-count hai:font-mono hai:text-[11.5px] hai:font-normal hai:leading-[normal] hai:text-dim hai:empty:hidden";

export const iconBtn =
  "hai-icon-btn hai:box-border hai:grid hai:size-32 hai:cursor-pointer hai:place-items-center hai:rounded-hai hai:border-2 hai:border-transparent hai:bg-transparent hai:px-6 hai:py-1 hai:text-dim hai:hover:border-line hai:hover:bg-hover hai:hover:text-fg " +
  RING;

export const main = "hai-main hai:relative hai:grid hai:min-h-0 hai:flex-1 hai:grid-cols-[minmax(0,1fr)] hai:overflow-clip";
export const chat =
  "hai-chat hai:[--hai-gutter:max(16px,calc((100%_-_var(--hai-column))_/_2))] hai:relative hai:flex hai:min-h-0 hai:min-w-0 hai:flex-col hai:[transition:margin-right_.25s_cubic-bezier(.2,.8,.2,1),opacity_.25s] hai:[&[inert]]:opacity-40 hai:min-[900px]:[.hai-main.inspector-open>&]:mr-[var(--hai-inspector-width)] hai:motion-reduce:[transition:none]";
export const transcript =
  "hai-transcript hai:box-content hai:flex-1 hai:overflow-y-auto hai:px-[var(--hai-gutter)] hai:pt-28 hai:pb-8 " +
  SCROLLBAR +
  " hai:max-[600px]:pt-18 hai:max-[900px]:[.window-open>&]:opacity-40";

// ── empty state ───────────────────────────────────────────────────────
// alone, it greets; after what init showed, it stays out of the way
export const empty =
  "hai-empty hai:box-content hai:text-dim hai:first:flex hai:first:flex-col hai:first:items-center hai:first:pt-[clamp(24px,14vh,140px)] hai:first:text-center";
export const emptyText =
  "hai:m-0 hai:max-w-[54ch] hai:text-[15px] hai:leading-[1.6] hai:[.hai-empty:first-child_&]:text-[18px] hai:[.hai-empty:first-child_&]:font-bold hai:[.hai-empty:first-child_&]:leading-[1.45] hai:[.hai-empty:first-child_&]:tracking-[-.01em] hai:[.hai-empty:first-child_&]:text-fg";
export const emptyMark = "hai-logo hai-empty-mark hai:mb-20 hai:size-64 hai:flex-none hai:align-baseline hai:[.hai-empty:not(:first-child)_&]:hidden";
export const suggestions =
  "hai-suggestions hai:mt-24 hai:flex hai:flex-wrap hai:gap-12 hai:[.hai-empty:first-child_&]:justify-center hai:[.hai-empty:not(:first-child)_&]:mt-12";
export const suggestion =
  "hai-suggestion hai:box-border hai:cursor-pointer hai:rounded-hai hai:border-3 hai:border-line hai:bg-panel hai:px-16 hai:py-8 hai:text-fg hai:shadow-hai hai:[font-family:inherit] hai:[line-height:inherit] hai:text-[14px] hai:font-medium hai:hover:bg-[linear-gradient(var(--hai-hover)_0_0)] " +
  RING;

// ── transcript blocks ─────────────────────────────────────────────────
// each paragraph takes its own direction: a reply can mix scripts
const PROSE = "hai-body hai:text-[15px] hai:whitespace-pre-wrap hai:wrap-anywhere hai:[unicode-bidi:plaintext]";
// a block of a kind this version doesn't know, shown as its JSON
export const block = "hai-block hai:mb-18";
export const user = "hai-block hai-user hai:mb-18 hai:flex hai:justify-end";
export const userBody = `${PROSE} hai:box-content hai:max-w-[min(85%,62ch)] hai:rounded-hai hai:border-3 hai:border-line hai:bg-user-bg hai:px-14 hai:py-9 hai:shadow-hai`;
export const assistant = "hai-block hai-assistant hai:mb-18 hai:max-w-[72ch] hai:leading-[1.65]";
export const assistantBody = PROSE;
export const body = "hai-body";

// an answer given in a surface — it went back to the model as the tool result
export const interaction =
  "hai-block hai-interaction hai:mb-18 hai:flex hai:max-w-[72ch] hai:items-start hai:gap-8 hai:font-mono hai:text-[13px] hai:font-normal hai:leading-[1.6] hai:text-dim";
export const arrow = "hai-arrow hai:grid hai:h-21 hai:w-18 hai:flex-none hai:place-items-center hai:text-fg";
export const arrowIcon = `${ICON} hai:size-15 hai:stroke-[2.5]`;

const NOTICE_BLOCK = "hai:mb-18 hai:box-content hai:flex hai:rounded-hai hai:border-3 hai:border-line hai:px-16 hai:text-fg";
export const error = `hai-block hai-error ${NOTICE_BLOCK} hai:items-start hai:gap-10 hai:bg-bad-soft hai:py-12 hai:leading-[1.55] hai:shadow-[4px_4px_0_var(--hai-bad)]`;
export const errorIcon = `${ICON} hai:mt-3 hai:size-16`;
export const errorBody = "hai-body hai:wrap-anywhere";
export const expired = `hai-block hai-expired ${NOTICE_BLOCK} hai:flex-wrap hai:items-center hai:gap-14 hai:border-dashed hai:bg-panel hai:pt-12 hai:pb-16`;
export const expiredIcon = `${ICON} hai:size-16 hai:hidden`;
export const expiredBody = "hai-body hai:flex-[1_1_100%]";
export const newChat =
  "hai-new hai:box-border hai:cursor-pointer hai:rounded-hai hai:border-3 hai:border-line hai:bg-accent hai:px-16 hai:py-8 hai:text-on-accent hai:shadow-hai hai:[font-family:inherit] hai:[font-size:inherit] hai:[line-height:inherit] hai:font-bold hai:hover:bg-[linear-gradient(var(--hai-hover)_0_0)] " +
  RING;

// ── tool provenance row ───────────────────────────────────────────────
// Chrome for the surface directly beneath it. Rows that want something
// (running, awaiting you, failed) stand out on a shadow; settled ones lie
// flat. A row and its live surface are one card, under one shadow. The row's
// `hai-status-*` hook, added after these, picks its colours.
export const tool =
  "hai-block hai-tool hai:mb-18 hai:box-content hai:overflow-hidden hai:rounded-hai hai:border-3 hai:border-line hai:bg-panel-2 hai:has-[+:is(.hai-surface,.hai-dockable)]:mb-0 hai:has-[+:is(.hai-surface,.hai-dockable)]:rounded-b-none hai:has-[+.hai-surface:not([data-expired])]:shadow-hai hai:has-[+.hai-dockable:not([data-expired]):not([data-docked])]:shadow-hai hai:[&.hai-status-running]:bg-panel hai:[&.hai-status-running]:shadow-hai hai:[&.hai-status-awaiting]:bg-warn hai:[&.hai-status-awaiting]:shadow-hai hai:[&.hai-status-expired]:bg-[color-mix(in_srgb,var(--hai-dim)_10%,var(--hai-panel-2))] hai:[&.hai-status-error]:bg-bad-soft hai:[&.hai-status-error]:shadow-[4px_4px_0_var(--hai-bad)]";
// amber is as light in either scheme, so what's written on it is ink, the
// arguments too: dimmed, they'd lose contrast on a darker amber
export const toolSummary =
  "hai:box-border hai:flex hai:min-h-44 hai:cursor-pointer hai:list-none hai:list-outside hai:items-center hai:gap-10 hai:px-14 hai:py-8 hai:text-[13px] hai:select-none hai:[&::-webkit-details-marker]:hidden hai:hover:bg-hover hai:has-[.hai-tbar]:relative hai:[.hai-status-awaiting_&]:[--hai-dim:var(--hai-on-accent)] hai:[.hai-status-awaiting_&]:text-on-accent hai:focus-visible:outline-2 hai:focus-visible:outline-current hai:focus-visible:-outline-offset-5";
// where the call stands, as a dot; the glyph the row carries goes unshown
export const ticon =
  "hai-ticon hai:box-border hai:size-12 hai:flex-none hai:rounded-[50%] hai:border-2 hai:border-current hai:bg-good hai:*:hidden hai:[.hai-status-running_&]:bg-accent hai:[.hai-status-running_&]:animate-[hai-blink_1.2s_infinite_both] hai:[.hai-status-awaiting_&]:bg-accent hai:[.hai-status-expired_&]:bg-[color-mix(in_srgb,var(--hai-dim)_60%,var(--hai-bg))] hai:[.hai-status-error_&]:bg-bad hai:motion-reduce:[.hai-status-running_&]:animate-none";
export const spinner = "hai-spinner";
export const pulse = PULSE;
export const tname = "hai-tname hai:font-mono hai:text-[13px] hai:font-bold hai:leading-[normal]";
// hover over the pink, in the dark scheme, would leave dim text too faint
export const targs =
  "hai-targs hai:min-w-0 hai:flex-1 hai:overflow-hidden hai:text-ellipsis hai:whitespace-nowrap hai:font-mono hai:text-[12px] hai:font-normal hai:leading-[normal] hai:text-dim hai:[.hai-status-error_summary:hover_&]:text-fg";
export const tstatus = `${STATUS} hai:whitespace-nowrap`;
// a running tool's progress: the message gives way before the count does
export const tprogress = `${STATUS} hai-tprogress hai:flex hai:min-w-0 hai:whitespace-pre`;
export const tmessage = "hai-tmessage hai:min-w-0 hai:overflow-hidden hai:text-ellipsis";
export const tcount = "hai-tcount hai:flex-none";
// a bar along the bottom edge of its row, the accent edged in ink
export const tbar =
  "hai-tbar hai:absolute hai:right-0 hai:bottom-0 hai:left-0 hai:h-7 hai:[background:linear-gradient(to_right,var(--hai-accent)_calc(var(--hai-progress,0%)_-_3px),transparent_0)_0_3px_no-repeat,linear-gradient(to_right,var(--hai-line)_var(--hai-progress,0%),transparent_0)]";
export const chevron =
  "hai-icon hai-chevron hai:size-14 hai:flex-none hai:stroke-3 hai:align-baseline hai:[transition:transform_.15s] hai:[.hai-tool[open]_&]:transform-[rotate(90deg)] hai:motion-reduce:[transition:none]";

export const toolDetail = "hai-tool-detail hai:box-content hai:border-t-3 hai:border-t-line hai:bg-panel-2 hai:px-14 hai:pb-14";
export const label = "hai-label hai:mt-12 hai:mb-6 hai:font-mono hai:text-[11px] hai:font-bold hai:leading-[normal] hai:text-dim";
// 200px tall at most, border and all
const CODE =
  "hai:m-0 hai:box-border hai:max-h-200 hai:overflow-auto hai:rounded-hai hai:border-2 hai:border-line hai:px-11 hai:py-9 hai:font-mono hai:text-[12px] hai:font-normal hai:leading-[1.55] hai:whitespace-pre-wrap hai:wrap-anywhere";
export const code = `hai-code ${CODE} hai:bg-code-bg`;
export const digest = `hai-digest ${CODE} hai:bg-good-soft`;

// ── surfaces and notices ──────────────────────────────────────────────
// Your component mounts inside this. Docked, or in a card or a window, it
// loses its own frame to the one it's in; out of date, it greys out.
export const surface =
  `hai-surface ${CARD} hai:[.hai-tool+&]:border-t-0 hai:[.hai-tool+&]:rounded-t-none hai:data-expired:opacity-45 hai:data-expired:[filter:grayscale(.7)] hai:data-expired:shadow-none ` +
  "hai:[:is(.hai-dockable,.hai-window-body)>&]:m-0 hai:[:is(.hai-dockable,.hai-window-body)>&]:border-0 hai:[:is(.hai-dockable,.hai-window-body)>&]:rounded-none hai:[:is(.hai-dockable,.hai-window-body)>&]:shadow-none";
// what a component the registry doesn't list, or a notice's, shows instead
export const surfaceError =
  "hai-surface-error hai:mb-18 hai:box-content hai:rounded-hai hai:border-3 hai:border-line hai:bg-bad-soft hai:px-16 hai:py-12 hai:shadow-[4px_4px_0_var(--hai-bad)] hai:font-mono hai:text-[12.5px] hai:font-normal hai:leading-[normal] " +
  "hai:[:is(.hai-notice,.hai-dockable,.hai-window-body)>&]:m-0 hai:[:is(.hai-notice,.hai-dockable,.hai-window-body)>&]:border-0 hai:[:is(.hai-notice,.hai-dockable,.hai-window-body)>&]:rounded-none hai:[:is(.hai-notice,.hai-dockable,.hai-window-body)>&]:shadow-none";
// props still arriving: hatched bars, inked first, and the label under them
export const skeleton = "hai-skeleton hai:box-content hai:grid hai:gap-12 hai:p-16";
export const skeletonLabel = "hai-skeleton-label hai:order-1 hai:font-mono hai:text-[12px] hai:font-normal hai:leading-[normal] hai:text-dim";
export const shimmer =
  "hai-shimmer hai:box-border hai:h-36 hai:border-2 hai:border-[color-mix(in_srgb,var(--hai-dim)_50%,transparent)] hai:[background:linear-gradient(45deg,color-mix(in_srgb,var(--hai-dim)_50%,transparent)_0_12.5%,transparent_0_50%,color-mix(in_srgb,var(--hai-dim)_50%,transparent)_0_62.5%,transparent_0)_0_0_/_12px_12px] hai:animate-[hai-shimmer_1s_linear_infinite] hai:nth-2:h-16 hai:nth-2:w-[40%] hai:nth-2:border-line hai:nth-2:bg-[linear-gradient(45deg,var(--hai-line)_0_12.5%,transparent_0_50%,var(--hai-line)_0_62.5%,transparent_0)] hai:motion-reduce:animate-none";

// a notice: something the server said outside of any request
export const notice = `hai-notice ${CARD}`;
export const noticeLabel = "hai-notice-label hai:box-content hai:border-b-3 hai:border-b-line hai:bg-user-bg hai:px-12 hai:py-6 hai:font-mono hai:text-[11px] hai:font-bold hai:leading-[normal]";
export const noticeBody = "hai-notice-body";

// ── the dock: a surface's card, its bar, and what stays when it docks ─
// With the dock on, a surface mounts inside a card of its own: a bar with its
// name and Dock, then the surface. The card is what the transcript keeps; the
// surface itself moves to the dock and back.
export const dockable = `hai-dockable ${CARD} hai:[.hai-tool+&]:border-t-0 hai:[.hai-tool+&]:rounded-t-none hai:data-expired:shadow-none hai:data-docked:bg-panel-2 hai:data-docked:shadow-none`;
export const surfaceBar = "hai-surface-bar hai:box-content hai:flex hai:min-h-34 hai:items-stretch hai:border-b-2 hai:border-b-line hai:bg-panel-2 hai:text-fg hai:pointer-coarse:min-h-44";
export const surfaceName =
  "hai-surface-name hai:box-content hai:min-w-0 hai:flex-1 hai:self-center hai:overflow-hidden hai:px-14 hai:text-ellipsis hai:whitespace-nowrap hai:font-mono hai:text-[11.5px] hai:font-bold hai:leading-[normal] hai:text-dim";
// a button that is a bar's cell, an icon named for screen readers and in a
// tooltip: Dock, Put back, and the window's Remove from dock and Dock; in the
// window's bar, the second sits closer to the first
export const barIcon =
  "hai-bar-btn hai-bar-icon hai:box-border hai:inline-flex hai:w-40 hai:flex-none hai:cursor-pointer hai:items-center hai:justify-center hai:gap-6 hai:rounded-none hai:border-0 hai:border-current hai:border-l-2 hai:bg-transparent hai:p-0 hai:text-inherit hai:font-mono hai:text-[12px] hai:font-bold hai:leading-[normal] hai:hover:bg-hover hai:pointer-coarse:w-44 hai:[.hai-window-bar>.hai-bar-btn+&]:-ml-10 hai:focus-visible:outline-2 hai:focus-visible:outline-current hai:focus-visible:-outline-offset-6";
export const barIconIcon = ICON_16_BOLD;
// docked: a flat stub in the surface's place
export const docked = "hai-docked hai:flex hai:min-h-40 hai:items-stretch hai:text-fg hai:pointer-coarse:min-h-44";
export const dockedText =
  "hai-docked-text hai:box-content hai:flex hai:min-w-0 hai:flex-1 hai:items-center hai:gap-8 hai:px-14 hai:font-mono hai:text-[12px] hai:font-normal hai:leading-[normal] hai:text-dim";
export const dockedIcon = ICON_14_BOLD;

// ── status + composer ─────────────────────────────────────────────────
export const status =
  "hai-status hai:box-content hai:flex hai:min-h-22 hai:items-center hai:gap-8 hai:px-[var(--hai-gutter)] hai:pb-8 hai:font-mono hai:text-[12.5px] hai:font-bold hai:leading-[normal] hai:max-[900px]:[.window-open>&]:opacity-40";
// thinking: one accent dot, blinking
export const dots = "hai-dots hai:inline-flex";
export const dot =
  "hai:box-border hai:size-12 hai:rounded-[50%] hai:border-2 hai:border-current hai:bg-accent hai:animate-[hai-blink_1.2s_infinite_both] hai:[i+&]:hidden hai:motion-reduce:animate-none";

export const composer = "hai-composer hai:box-content hai:flex-none hai:px-[var(--hai-gutter)] hai:pb-20 hai:max-[600px]:pb-12";
export const composerBox =
  "hai-composer-box hai:box-content hai:flex hai:items-end hai:gap-8 hai:rounded-hai hai:border-3 hai:border-line hai:bg-panel hai:py-6 hai:pr-6 hai:pl-14 hai:shadow-hai hai:[transition:box-shadow_.15s] hai:focus-within:shadow-[4px_4px_0_var(--hai-accent)] hai:[.hai-dock:not([hidden])+&]:border-t-0 hai:[.hai-dock:not([hidden])+&]:rounded-t-none hai:motion-reduce:[transition:none]";
export const input =
  "hai-input hai:box-border hai:max-h-200 hai:min-h-34 hai:flex-1 hai:resize-none hai:overflow-y-auto hai:border-0 hai:border-current hai:bg-transparent hai:px-0 hai:py-6 hai:text-fg hai:[font-family:inherit] hai:text-[15px] hai:leading-[1.45] hai:outline-none hai:placeholder:overflow-hidden hai:placeholder:text-ellipsis hai:placeholder:whitespace-nowrap hai:placeholder:text-dim hai:disabled:cursor-not-allowed hai:disabled:opacity-60";
export const send =
  "hai-send hai:box-border hai:grid hai:size-34 hai:flex-none hai:cursor-pointer hai:place-items-center hai:rounded-hai hai:border-2 hai:border-line hai:bg-accent hai:px-6 hai:py-1 hai:text-on-accent hai:[transition:opacity_.15s] hai:disabled:cursor-default hai:disabled:opacity-35 " +
  RING;
export const sendIcon = `${ICON} hai:size-18 hai:stroke-[2.5]`;

// ── the dock's shelf, on top of the composer ──────────────────────────
// The composer card's top row while anything is docked: one card, one
// shadow. Not positioned, so the box below covers the shelf's own shadow.
// --hai-dock-clear is Remove all's size: the pile's list lines up past it.
export const dock =
  "hai-dock hai:[--hai-dock-clear:36px] hai:box-content hai:flex hai:items-center hai:gap-10 hai:rounded-t-hai hai:border-3 hai:border-line hai:bg-panel-2 hai:pr-14 hai:pl-12 hai:shadow-hai hai:[transition:box-shadow_.15s] hai:[&[hidden]]:hidden hai:[.hai-composer:has(.hai-composer-box:focus-within)>&]:shadow-[4px_4px_0_var(--hai-accent)] hai:pointer-coarse:[--hai-dock-clear:44px] hai:motion-reduce:[transition:none]";
export const dockCount = "hai-dock-count hai:flex-none hai:font-mono hai:text-[11px] hai:font-bold hai:leading-[normal] hai:text-dim hai:max-[900px]:hidden";
// room above and to the right for an item's corner mark, below for its shadow
export const dockRow = "hai-dock-row hai:box-content hai:flex hai:min-w-0 hai:flex-1 hai:items-center hai:gap-10 hai:overflow-x-auto hai:py-8 hai:pr-8 hai:pl-0 hai:[scrollbar-width:none]";
// a docked surface: open is pressed and inked; amber waits on you
export const dockItem = DOCK_ITEM;
export const dockItemIcon = ICON_14_BOLD;
export const dockDot =
  "hai-dock-dot hai:box-border hai:size-10 hai:rounded-[50%] hai:border-2 hai:border-current hai:bg-accent hai:[&[hidden]]:hidden hai:[.hai-dock-item[aria-expanded=true]_&]:bg-warn";
export const dockChanged =
  "hai-dock-changed hai:absolute hai:-top-7 hai:-right-7 hai:box-border hai:size-12 hai:border-2 hai:border-line hai:bg-accent hai:[&[hidden]]:hidden hai:[.hai-pile-row_&]:static hai:[.hai-pile-row_&]:flex-none";
// the pile the oldest go into when the row is full: two edges behind it,
// above an open window, which its list may overlap
export const dockPile =
  "hai-dock-pile hai:relative hai:isolate hai:z-6 hai:my-8 hai:mr-8 hai:ml-0 hai:inline-flex hai:flex-none hai:[&[hidden]]:hidden " +
  "hai:before:absolute hai:before:inset-0 hai:before:-z-1 hai:before:box-border hai:before:border-2 hai:before:border-line hai:before:bg-panel hai:before:transform-[translate(8px,-8px)] hai:before:content-[''] " +
  "hai:after:absolute hai:after:inset-0 hai:after:-z-1 hai:after:box-border hai:after:border-2 hai:after:border-line hai:after:bg-panel hai:after:transform-[translate(4px,-4px)] hai:after:content-['']";
// Remove all, at the shelf's end: a quiet icon until the pointer's on it
export const dockClear =
  "hai-dock-clear hai:box-border hai:grid hai:size-[var(--hai-dock-clear)] hai:flex-none hai:cursor-pointer hai:place-items-center hai:rounded-hai hai:border-2 hai:border-transparent hai:bg-transparent hai:p-0 hai:text-dim hai:hover:border-line hai:hover:bg-hover hai:hover:text-fg " +
  RING;
export const dockClearIcon = ICON_16_BOLD;
// What's in it, oldest first, above the shelf, 280px wide, border and all.
// Its right edge lines up with the shelf's: past the pile's margin, the gap,
// Remove all, the shelf's padding and its border. So it opens leftward from
// the shelf's end, and fits whatever the screen fits. Until it's measured as
// it opens, it takes 60% of the screen's height.
export const pileList =
  "hai-pile-list hai:absolute hai:right-[calc(-1_*_(8px_+_10px_+_var(--hai-dock-clear,36px)_+_14px_+_3px))] hai:bottom-[calc(100%_+_18px)] hai:z-6 hai:box-border hai:w-280 hai:max-w-[calc(100vw_-_32px)] hai:max-h-[60vh] hai:overflow-y-auto hai:rounded-hai hai:border-3 hai:border-line hai:bg-panel hai:shadow-hai hai:[&[hidden]]:hidden " +
  SCROLLBAR;
export const pileHead =
  "hai-pile-head hai:sticky hai:top-0 hai:box-content hai:border-b-2 hai:border-b-line hai:bg-panel-2 hai:px-12 hai:py-6 hai:font-mono hai:text-[11px] hai:font-bold hai:leading-[normal] hai:text-dim";
export const pileRow =
  "hai-pile-row hai:box-border hai:flex hai:min-h-44 hai:w-full hai:cursor-pointer hai:items-center hai:gap-10 hai:border-0 hai:border-current hai:border-b-2 hai:border-b-line-soft hai:bg-transparent hai:px-12 hai:py-0 hai:text-left hai:text-fg hai:font-mono hai:text-[12px] hai:font-bold hai:leading-[normal] hai:last:border-b-0 hai:last:border-b-current hai:hover:bg-hover hai:focus-visible:outline-2 hai:focus-visible:outline-current hai:focus-visible:-outline-offset-6";
export const pileRowIcon = ICON_14_BOLD;
export const pileName = "hai-pile-name hai:min-w-0 hai:flex-1 hai:overflow-hidden hai:text-ellipsis";

// ── a docked surface, open as a window ────────────────────────────────
// Above the status line and the composer, in the column; raised higher than a
// card. Its title bar is inked like its pressed item, amber while it waits.
// On a narrow screen it's a sheet over the chat, down to the composer.
export const win =
  "hai-window hai:absolute hai:bottom-[calc(var(--hai-foot,140px)_+_8px)] hai:left-[var(--hai-gutter)] hai:z-5 hai:box-border hai:flex hai:max-h-[calc(100%_-_var(--hai-foot,140px)_-_32px)] hai:w-[min(560px,100%_-_2_*_var(--hai-gutter))] hai:flex-col hai:rounded-hai hai:border-3 hai:border-line hai:bg-panel hai:text-fg hai:shadow-[8px_8px_0_var(--hai-line)] hai:[&[hidden]]:hidden hai:focus:outline-none hai:focus-visible:outline-3 hai:focus-visible:outline-fg hai:focus-visible:outline-offset-2 hai:data-[status=expired]:border-dashed hai:data-[status=expired]:border-dim hai:data-[status=expired]:shadow-none " +
  "hai:max-[900px]:top-[12%] hai:max-[900px]:right-0 hai:max-[900px]:bottom-[var(--hai-composer-height,120px)] hai:max-[900px]:left-0 hai:max-[900px]:max-h-none hai:max-[900px]:w-auto hai:max-[900px]:rounded-none hai:max-[900px]:border-x-0 hai:max-[900px]:shadow-none";
export const winBar =
  "hai-window-bar hai:box-content hai:flex hai:min-h-40 hai:flex-none hai:items-stretch hai:gap-10 hai:border-b-3 hai:border-b-line hai:bg-fg hai:pl-12 hai:text-panel hai:pointer-coarse:min-h-44 " +
  "hai:[.hai-window[data-status=awaiting]_&]:bg-warn hai:[.hai-window[data-status=awaiting]_&]:text-on-accent hai:[.hai-window[data-status=expired]_&]:[border-bottom-style:dashed] hai:[.hai-window[data-status=expired]_&]:border-dim hai:[.hai-window[data-status=expired]_&]:bg-[color-mix(in_srgb,var(--hai-dim)_10%,var(--hai-panel-2))] hai:[.hai-window[data-status=expired]_&]:text-fg";
export const winIcon = `${ICON_14_BOLD} hai:self-center`;
// a long name gives way, after the tool's, so the bar's buttons stay in reach
export const winName =
  "hai-window-name hai:min-w-0 hai:flex-[0_1_auto] hai:self-center hai:overflow-hidden hai:text-ellipsis hai:whitespace-nowrap hai:font-mono hai:text-[12.5px] hai:font-bold hai:leading-[normal]";
export const winTool =
  "hai-window-tool hai:min-w-0 hai:flex-1 hai:self-center hai:overflow-hidden hai:text-ellipsis hai:whitespace-nowrap hai:font-mono hai:text-[12px] hai:font-normal hai:leading-[normal]";
export const winBadge = `${STATUS} hai-window-badge hai:flex-none hai:self-center hai:whitespace-nowrap hai:[&[hidden]]:hidden hai:[.hai-window[data-status=expired]_&]:bg-transparent`;
export const winBody = `hai-window-body hai:min-h-0 hai:overflow-y-auto ${SCROLLBAR}`;

// for a screen reader only: what docking just did
export const dockLive = "hai-dock-live hai:absolute hai:size-1 hai:overflow-hidden hai:[clip-path:inset(50%)] hai:whitespace-nowrap";

// ── model context debug drawer ────────────────────────────────────────
// Closed, it waits off the right edge, out of the tab order and the
// accessibility tree; open, it slides in, over the chat on a narrow screen.
// Its width is --hai-inspector-width, border and all.
export const inspector =
  "hai-inspector hai:absolute hai:top-0 hai:right-0 hai:bottom-0 hai:left-auto hai:z-10 hai:box-border hai:flex hai:min-h-0 hai:w-[min(100%,var(--hai-inspector-width))] hai:flex-col hai:border-l-3 hai:border-l-line hai:bg-panel-2 hai:invisible hai:transform-[translateX(100%)] hai:[transition:transform_.25s_cubic-bezier(.2,.8,.2,1),visibility_0s_.25s] " +
  "hai:[.hai-main.inspector-open>&]:visible hai:[.hai-main.inspector-open>&]:transform-none hai:[.hai-main.inspector-open>&]:[transition:transform_.25s_cubic-bezier(.2,.8,.2,1),visibility_0s] hai:motion-reduce:[transition:none] hai:motion-reduce:[.hai-main.inspector-open>&]:[transition:none]";
export const inspectorHead = "hai-inspector-head hai:box-content hai:flex hai:items-center hai:gap-8 hai:border-b-3 hai:border-b-line hai:py-10 hai:pr-10 hai:pl-16";
export const inspectorTitle = "hai-inspector-title hai:flex hai:flex-1 hai:flex-col hai:text-[13px] hai:font-bold";
export const inspectorSub = "hai:text-[12px] hai:font-normal hai:text-dim";
export const inspectorBody = `hai-inspector-body hai:box-content hai:flex-1 hai:overflow-y-auto hai:px-16 hai:pb-16 ${SCROLLBAR}`;
export const inspectorEmpty = "hai-inspector-empty hai:mx-0 hai:my-16 hai:text-[13px] hai:text-dim";

// the numbers stay in view as the context scrolls under them
export const ctx = "hai-ctx hai:sticky hai:top-0 hai:z-1 hai:box-content hai:border-b-3 hai:border-b-line hai:bg-panel-2 hai:pt-14 hai:pb-12";
export const ctxHeadline = "hai-ctx-headline hai:mb-8 hai:flex hai:items-baseline hai:gap-8 hai:text-[12.5px] hai:text-dim";
export const ctxPct = "hai-ctx-pct hai:text-[26px] hai:font-bold hai:tracking-[-.02em] hai:text-fg hai:tabular-nums";
export const meter = "hai-meter hai:mb-10 hai:box-content hai:flex hai:h-10 hai:overflow-hidden hai:rounded-hai hai:border-2 hai:border-line hai:bg-good";
export const meterModel = "hai-meter-model hai:box-content hai:min-w-2 hai:border-r-2 hai:border-r-line hai:bg-accent";
export const ctxStat = "hai-ctx-stat hai:box-content hai:flex hai:justify-between hai:py-1 hai:font-mono hai:text-[12px] hai:font-normal hai:leading-[normal]";
export const ctxLabel = "hai-ctx-label hai:inline-flex hai:items-center hai:gap-7 hai:text-dim";
export const ctxTok = "hai-ctx-tok hai:tabular-nums";
const KEY = "hai-key hai:box-border hai:size-10 hai:rounded-hai hai:border-2 hai:border-line";
export const keyModel = `${KEY} hai-key-model hai:bg-accent`;
export const keyUi = `${KEY} hai-key-ui hai:bg-good`;

// each message, under a hook naming its role
export const msg = "hai-msg hai:mt-14 hai:box-content hai:border-l-3 hai:border-l-line hai:pl-11";
export const role = "hai-role hai:mb-4 hai:font-mono hai:text-[10px] hai:font-bold hai:leading-[normal] hai:tracking-[.08em] hai:text-dim hai:uppercase";
export const mbody = "hai-mbody hai:grid hai:gap-6 hai:font-mono hai:text-[12px] hai:font-normal hai:leading-[1.55] hai:whitespace-pre-wrap hai:wrap-anywhere";
const CALL = "hai:box-content hai:rounded-hai hai:border-2 hai:border-line hai:px-8 hai:py-6";
export const toolUse = `hai-tu ${CALL} hai:bg-accent-soft`;
export const toolResult = `hai-tr ${CALL} hai:bg-good-soft`;
export const kind = "hai-kind hai:mb-2 hai:block hai:text-[10.5px] hai:font-bold hai:opacity-75";
