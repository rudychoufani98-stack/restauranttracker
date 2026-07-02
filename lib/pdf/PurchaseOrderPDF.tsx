import {
  Document, Page, Text, View, StyleSheet,
} from "@react-pdf/renderer";

// Clean minimal styles
const S = StyleSheet.create({
  page: { fontFamily: "Helvetica", fontSize: 9, color: "#111827", padding: "40 48 48 48", backgroundColor: "#FFFFFF" },

  // Header
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 32 },
  brandBlock: { flex: 1 },
  brandName: { fontSize: 16, fontFamily: "Helvetica-Bold", color: "#111827", marginBottom: 4 },
  brandMeta: { fontSize: 8, color: "#6B7280", lineHeight: 1.5 },

  poBlock: { alignItems: "flex-end" },
  poTitle: { fontSize: 20, fontFamily: "Helvetica-Bold", color: "#10B981", letterSpacing: 1 },
  poNumber: { fontSize: 9, color: "#6B7280", marginTop: 4 },
  poDate: { fontSize: 8, color: "#9CA3AF", marginTop: 2 },

  // Divider
  divider: { height: 0.5, backgroundColor: "#E5E7EB", marginBottom: 24 },

  // Addresses
  addressRow: { flexDirection: "row", gap: 32, marginBottom: 28 },
  addressBlock: { flex: 1 },
  addressLabel: { fontSize: 7, fontFamily: "Helvetica-Bold", color: "#9CA3AF", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 6 },
  addressName: { fontSize: 10, fontFamily: "Helvetica-Bold", color: "#111827", marginBottom: 3 },
  addressLine: { fontSize: 8, color: "#4B5563", lineHeight: 1.6 },

  // Table
  table: { marginBottom: 24 },
  tableHeader: { flexDirection: "row", backgroundColor: "#F9FAFB", borderTopLeftRadius: 4, borderTopRightRadius: 4, paddingVertical: 8, paddingHorizontal: 10, borderBottom: "1 solid #E5E7EB" },
  tableHeaderCell: { fontSize: 7, fontFamily: "Helvetica-Bold", color: "#6B7280", textTransform: "uppercase", letterSpacing: 0.6 },
  tableRow: { flexDirection: "row", paddingVertical: 9, paddingHorizontal: 10, borderBottom: "0.5 solid #F3F4F6" },
  tableRowAlt: { backgroundColor: "#FAFAFA" },
  tableCell: { fontSize: 8.5, color: "#374151" },
  packDetail: { fontSize: 7, color: "#9CA3AF", marginTop: 2 },

  // Column widths
  colRef: { width: "30%" },
  colQty: { width: "15%", textAlign: "right" },
  colUnit: { width: "10%", textAlign: "center" },
  colPU: { width: "15%", textAlign: "right" },
  colVAT: { width: "12%", textAlign: "right" },
  colTotal: { width: "18%", textAlign: "right" },

  // Totals
  totalsSection: { flexDirection: "row", justifyContent: "flex-end", marginBottom: 32 },
  totalsBox: { width: 220 },
  totalsRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 5, paddingHorizontal: 10, borderBottom: "0.5 solid #F3F4F6" },
  totalsRowTotal: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 8, paddingHorizontal: 10, backgroundColor: "#10B981", borderRadius: 4, marginTop: 4 },
  totalsLabel: { fontSize: 8, color: "#6B7280" },
  totalsValue: { fontSize: 8.5, color: "#111827", fontFamily: "Helvetica-Bold" },
  totalsTTCLabel: { fontSize: 9, color: "#FFFFFF", fontFamily: "Helvetica-Bold" },
  totalsTTCValue: { fontSize: 11, color: "#FFFFFF", fontFamily: "Helvetica-Bold" },

  // Footer
  footer: { position: "absolute", bottom: 32, left: 48, right: 48 },
  footerDivider: { height: 0.5, backgroundColor: "#E5E7EB", marginBottom: 8 },
  footerText: { fontSize: 7, color: "#9CA3AF", textAlign: "center", lineHeight: 1.6 },

  // Note
  noteBox: { backgroundColor: "#F0FDF4", borderLeft: "3 solid #10B981", padding: "10 12", marginBottom: 24, borderRadius: 2 },
  noteLabel: { fontSize: 7, fontFamily: "Helvetica-Bold", color: "#065F46", marginBottom: 3, textTransform: "uppercase", letterSpacing: 0.6 },
  noteText: { fontSize: 8, color: "#047857", lineHeight: 1.5 },
});

type POLine = {
  name: string;
  quantity: number;
  unit: string;
  pack_detail?: string;
  expected_price: number;
  vat_rate: number;
};

type POPDFProps = {
  orderNumber: string;
  orderDate: string;
  restaurant: {
    name: string;
    address?: string;
    phone?: string;
    siret?: string;
    email?: string;
  };
  supplier: {
    name: string;
    email?: string;
    contact?: string;
    category?: string;
    customer_reference?: string;
  };
  lines: POLine[];
};

function fmt(n: number) {
  return `€${n.toFixed(2)}`;
}

export function PurchaseOrderPDF({ orderNumber, orderDate, restaurant, supplier, lines }: POPDFProps) {
  // Totals per VAT bracket
  const vatMap: Record<number, number> = {};
  let totalHT = 0;
  let totalTTC = 0;

  for (const line of lines) {
    const ht = line.quantity * line.expected_price;
    const vatAmt = ht * (line.vat_rate / 100);
    totalHT += ht;
    totalTTC += ht + vatAmt;
    vatMap[line.vat_rate] = (vatMap[line.vat_rate] ?? 0) + vatAmt;
  }

  const totalVAT = totalTTC - totalHT;

  return (
    <Document title={`Bon de commande ${orderNumber}`} author={restaurant.name}>
      <Page size="A4" style={S.page}>

        {/* ── Header ── */}
        <View style={S.header}>
          <View style={S.brandBlock}>
            <Text style={S.brandName}>{restaurant.name}</Text>
            {restaurant.address && <Text style={S.brandMeta}>{restaurant.address}</Text>}
            {restaurant.phone && <Text style={S.brandMeta}>Tél : {restaurant.phone}</Text>}
            {restaurant.email && <Text style={S.brandMeta}>{restaurant.email}</Text>}
            {restaurant.siret && <Text style={S.brandMeta}>SIRET : {restaurant.siret}</Text>}
          </View>
          <View style={S.poBlock}>
            <Text style={S.poTitle}>BON DE COMMANDE</Text>
            <Text style={S.poNumber}>N° {orderNumber}</Text>
            <Text style={S.poDate}>Date : {orderDate}</Text>
          </View>
        </View>

        <View style={S.divider} />

        {/* ── Addresses ── */}
        <View style={S.addressRow}>
          <View style={S.addressBlock}>
            <Text style={S.addressLabel}>Émetteur</Text>
            <Text style={S.addressName}>{restaurant.name}</Text>
            {restaurant.address && <Text style={S.addressLine}>{restaurant.address}</Text>}
            {restaurant.phone && <Text style={S.addressLine}>Tél : {restaurant.phone}</Text>}
            {restaurant.siret && <Text style={S.addressLine}>SIRET : {restaurant.siret}</Text>}
          </View>
          <View style={S.addressBlock}>
            <Text style={S.addressLabel}>Fournisseur</Text>
            <Text style={S.addressName}>{supplier.name}</Text>
            {supplier.contact && <Text style={S.addressLine}>Contact : {supplier.contact}</Text>}
            {supplier.email && <Text style={S.addressLine}>{supplier.email}</Text>}
            {supplier.customer_reference && <Text style={S.addressLine}>Réf. client : {supplier.customer_reference}</Text>}
            {supplier.category && <Text style={S.addressLine}>Catégorie : {supplier.category}</Text>}
          </View>
        </View>

        {/* ── Table ── */}
        <View style={S.table}>
          {/* Header row */}
          <View style={S.tableHeader}>
            <Text style={[S.tableHeaderCell, S.colRef]}>Désignation</Text>
            <Text style={[S.tableHeaderCell, S.colQty]}>Qté</Text>
            <Text style={[S.tableHeaderCell, S.colUnit]}>Unité</Text>
            <Text style={[S.tableHeaderCell, S.colPU]}>P.U. HT</Text>
            <Text style={[S.tableHeaderCell, S.colVAT]}>TVA</Text>
            <Text style={[S.tableHeaderCell, S.colTotal]}>Total HT</Text>
          </View>

          {/* Lines */}
          {lines.map((line, i) => (
            <View key={i} style={[S.tableRow, i % 2 === 1 ? S.tableRowAlt : {}]}>
              <View style={S.colRef}>
                <Text style={S.tableCell}>{line.name}</Text>
                {line.pack_detail ? <Text style={S.packDetail}>{line.unit} de {line.pack_detail}</Text> : null}
              </View>
              <Text style={[S.tableCell, S.colQty]}>{line.quantity}</Text>
              <Text style={[S.tableCell, S.colUnit]}>{line.unit}</Text>
              <Text style={[S.tableCell, S.colPU]}>{fmt(line.expected_price)}</Text>
              <Text style={[S.tableCell, S.colVAT]}>{line.vat_rate}%</Text>
              <Text style={[S.tableCell, S.colTotal]}>{fmt(line.quantity * line.expected_price)}</Text>
            </View>
          ))}
        </View>

        {/* ── Totals ── */}
        <View style={S.totalsSection}>
          <View style={S.totalsBox}>
            <View style={S.totalsRow}>
              <Text style={S.totalsLabel}>Total HT</Text>
              <Text style={S.totalsValue}>{fmt(totalHT)}</Text>
            </View>
            {Object.entries(vatMap).map(([rate, amt]) => (
              <View key={rate} style={S.totalsRow}>
                <Text style={S.totalsLabel}>TVA {rate}%</Text>
                <Text style={S.totalsValue}>{fmt(amt)}</Text>
              </View>
            ))}
            <View style={S.totalsRow}>
              <Text style={S.totalsLabel}>Total TVA</Text>
              <Text style={S.totalsValue}>{fmt(totalVAT)}</Text>
            </View>
            <View style={S.totalsRowTotal}>
              <Text style={S.totalsTTCLabel}>TOTAL TTC</Text>
              <Text style={S.totalsTTCValue}>{fmt(totalTTC)}</Text>
            </View>
          </View>
        </View>

        {/* ── Note ── */}
        <View style={S.noteBox}>
          <Text style={S.noteLabel}>Instructions de livraison</Text>
          <Text style={S.noteText}>
            Merci de confirmer la réception de ce bon de commande par retour d&apos;email.{"\n"}
            Toute modification de prix ou de quantité doit être signalée avant livraison.{"\n"}
            La facture doit mentionner le numéro de commande : {orderNumber}
          </Text>
        </View>

        {/* ── Footer ── */}
        <View style={S.footer}>
          <View style={S.footerDivider} />
          <Text style={S.footerText}>
            {restaurant.name}
            {restaurant.siret ? `  ·  SIRET ${restaurant.siret}` : ""}
            {restaurant.address ? `  ·  ${restaurant.address}` : ""}
            {"\n"}Document généré automatiquement — Restaurant Intelligence Platform
          </Text>
        </View>

      </Page>
    </Document>
  );
}
