/**
 * Brand tokens only. bg #0A0A0A, surfaces #141414/#1C1C1C, borders #2A2A2A, text #FFFFFF/#C0C0C0 (>= 11:1 on bg), gold #F5C842.
 * @page margin 0 removes the browser header/footer; the padding lives on .ps-page. print-color-adjust keeps the dark
 * background without "Background graphics".
 */
export const PRINT_CSS = `
@page { size: letter; margin: 0; }
html, body { margin: 0; padding: 0; background: #0A0A0A !important; color: #C0C0C0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.ps-root { position: relative; min-height: 100vh; background: #0A0A0A; color: #C0C0C0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; font-size: 12px; line-height: 1.45; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.ps-root *, .ps-root *::before, .ps-root *::after { box-sizing: border-box; }
.ps-page { position: relative; z-index: 1; width: 100%; max-width: 8.5in; margin: 0 auto; padding: 0.5in 0.65in; }
.ps-watermark { position: fixed; inset: 0; z-index: 0; display: flex; align-items: center; justify-content: center; pointer-events: none; font-size: 84px; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; color: #1C1C1C; transform: rotate(-30deg); }
.ps-root h1 { margin: 0; font-size: 20px; font-weight: 700; color: #FFFFFF; }
.ps-root h2 { margin: 0 0 8px; font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #C0C0C0; }
.ps-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; padding-bottom: 14px; border-bottom: 1px solid #2A2A2A; }
.ps-month { margin-top: 2px; font-size: 14px; color: #FFFFFF; }
.ps-meta { text-align: right; color: #C0C0C0; }
.ps-status { font-weight: 700; color: #FFFFFF; }
.ps-prelim { color: #F5C842; }
.ps-root section { margin-top: 16px; }
.ps-avoid, .ps-root tr, .ps-root li { break-inside: avoid; page-break-inside: avoid; }
.ps-headline { padding: 14px 20px; background: #141414; border: 1px solid #2A2A2A; border-left: 3px solid #F5C842; border-radius: 6px; }
.ps-eyebrow { font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #C0C0C0; }
.ps-owed { margin-top: 4px; font-size: 40px; font-weight: 800; line-height: 1.1; color: #F5C842; font-variant-numeric: tabular-nums; }
.ps-neg { color: #FFFFFF; }
.ps-sub { margin-top: 4px; font-size: 13px; color: #C0C0C0; }
.ps-table { width: 100%; border-collapse: collapse; table-layout: fixed; background: #141414; border: 1px solid #2A2A2A; }
.ps-table td { padding: 5px 12px; border-bottom: 1px solid #2A2A2A; color: #FFFFFF; overflow-wrap: anywhere; }
.ps-table td:first-child { width: auto; }
.ps-table .ps-tag-cell { width: 100px; text-align: left; white-space: nowrap; }
.ps-table .ps-amt { width: 110px; text-align: right; }
.ps-amt { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
.ps-tag { display: inline-block; white-space: nowrap; padding: 1px 7px; border: 1px solid #2A2A2A; border-radius: 999px; font-size: 9px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; background: #1C1C1C; color: #C0C0C0; }
.ps-est { border-color: #F5C842; color: #F5C842; }
.ps-net td { background: #1C1C1C; border-top: 2px solid #C0C0C0; font-weight: 700; }
.ps-owedrow td { background: #1C1C1C; border-bottom: 0; font-weight: 800; font-size: 14px; color: #F5C842; }
.ps-wallet { list-style: none; margin: 0; padding: 0; column-count: 2; column-gap: 28px; }
.ps-wallet li { display: flex; justify-content: space-between; gap: 12px; padding: 4px 0; border-bottom: 1px solid #2A2A2A; color: #FFFFFF; text-transform: capitalize; }
.ps-wallet li:last-child { border-bottom: 1px solid #2A2A2A; }
.ps-wallet .ps-amt { text-transform: none; }
.ps-reserve { display: flex; flex-wrap: wrap; gap: 4px 22px; margin: 0; padding: 8px 12px; background: #141414; border: 1px solid #2A2A2A; color: #C0C0C0; }
.ps-reserve span { white-space: nowrap; }
.ps-reserve b { color: #FFFFFF; font-variant-numeric: tabular-nums; }
.ps-table.ps-pay td.ps-date { width: 90px; color: #C0C0C0; white-space: nowrap; }
.ps-outstanding { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; margin-top: 8px; padding: 9px 12px; background: #1C1C1C; border: 1px solid #2A2A2A; font-weight: 700; color: #FFFFFF; }
.ps-outstanding small { font-weight: 400; color: #C0C0C0; }
.ps-note { margin: 0; color: #C0C0C0; }
.ps-footer { margin-top: 18px; padding-top: 10px; border-top: 1px solid #2A2A2A; font-size: 10px; color: #C0C0C0; }
@media print { .ps-root { min-height: 0; } }
`;
