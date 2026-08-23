import ExcelJS from "exceljs";

// Number formats (French-friendly: the € sign + thousands separators are
// rendered by Excel according to the user's locale).
export const FMT = {
  eur: '#,##0.00\\ "€"',
  eur4: '#,##0.0000\\ "€"',
  pct: '0\\ "%"',
  pct1: '0.0\\ "%"',
  qty: "#,##0.###",
  // Variantes signées pour les écarts : une hausse doit se lire comme une hausse.
  eurSigned: '+#,##0.00\\ "€";-#,##0.00\\ "€";0.00\\ "€"',
  pctSigned: '+0.0\\ "%";-0.0\\ "%";0.0\\ "%"',
};

const BRAND = "FFE8590C"; // orange de marque
const HEADER_BG = "FF1B2B5E"; // marine de marque
const SUBTOTAL_BG = "FFEAEDF3";

export function baseUnitLabel(unit: string): string {
  return unit === "kg" ? "g" : unit === "l" ? "ml" : unit;
}

export function newWorkbook(): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Restaurant Intelligence";
  wb.created = new Date();
  return wb;
}

/** Title band + generated-on line above the table. Returns the row index where the header should go. */
export function addTitle(ws: ExcelJS.Worksheet, title: string, subtitle: string, span: number) {
  ws.mergeCells(1, 1, 1, span);
  const t = ws.getCell(1, 1);
  t.value = title;
  t.font = { bold: true, size: 16, color: { argb: "FF111827" } };
  ws.getRow(1).height = 24;

  ws.mergeCells(2, 1, 2, span);
  const s = ws.getCell(2, 1);
  s.value = subtitle;
  s.font = { size: 10, color: { argb: "FF6B7280" } };

  ws.addRow([]); // spacer (row 3)
  return 4;
}

/** Style a header row (bold, dark background, white text, frozen). */
export function styleHeader(ws: ExcelJS.Worksheet, rowIndex: number) {
  const row = ws.getRow(rowIndex);
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_BG } };
    cell.alignment = { vertical: "middle" };
    cell.border = { bottom: { style: "thin", color: { argb: BRAND } } };
  });
  row.height = 20;
  ws.views = [{ state: "frozen", ySplit: rowIndex }];
}

/** A grey subtotal/group row. */
export function styleSubtotal(row: ExcelJS.Row) {
  row.eachCell((cell) => {
    cell.font = { bold: true, size: 10 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SUBTOTAL_BG } };
  });
}

/** Colore une cellule d'écart : rouge quand ça monte (ça coûte plus), vert quand ça baisse. */
export function styleDelta(cell: ExcelJS.Cell, value: number) {
  if (value > 0.0001) cell.font = { color: { argb: "FFDC2626" }, size: 10, bold: true };
  else if (value < -0.0001) cell.font = { color: { argb: "FF059669" }, size: 10, bold: true };
  else cell.font = { color: { argb: "FF9CA3AF" }, size: 10 };
}

export function autoWidth(ws: ExcelJS.Worksheet, widths: number[]) {
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
}

export async function workbookToResponse(wb: ExcelJS.Workbook, filename: string): Promise<Response> {
  const buf = await wb.xlsx.writeBuffer();
  return new Response(buf, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

export function todayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}
