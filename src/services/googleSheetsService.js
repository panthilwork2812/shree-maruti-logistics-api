const { getGoogleSheetsClient } = require("../config/googleSheets");
require("dotenv").config();

class GoogleSheetsService {
  constructor() {
    this.resultSheetName = process.env.RESULT_SHEET_NAME || "Result";
    this.ordersSheetName = process.env.ORDERS_SHEET_NAME || "Orders";
    this.rateCardSheetName = process.env.RATE_CARD_SHEET_NAME || "RateCard";
    this.pincodeSheetName = process.env.PINCODE_SHEET_NAME || "PincodeMaster";
  }

  /**
   * Always resolves Spreadsheet ID from parameter, env variable SPREADSHEET_ID
   */
  get spreadsheetId() {
    return (
      process.env.SPREADSHEET_ID || process.env.GOOGLE_SHEET_ORDERS_ID || ""
    );
  }

  resolveSpreadsheetId(paramId = null) {
    return paramId || process.env.SPREADSHEET_ID || this.spreadsheetId;
  }

  get sheetsClient() {
    return getGoogleSheetsClient();
  }

  isConfigured() {
    return !!(this.sheetsClient && this.spreadsheetId);
  }

  /**
   * Helper to fetch range values from a Google Sheet
   */
  async getSheetValues(spreadsheetId, range) {
    const client = this.sheetsClient;
    const targetId = this.resolveSpreadsheetId(spreadsheetId);
    if (!client) {
      throw new Error(
        "Google Sheets client is not authenticated. Please verify GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY in .env or credentials.json.",
      );
    }
    const response = await client.spreadsheets.values.get({
      spreadsheetId: targetId,
      range,
    });
    return response.data.values || [];
  }

  /**
   * Fetch all 4 tabs ("Result", "Orders", "RateCard", "PincodeMaster") from one Google Sheet file in a single batch API call
   */
  async fetchAllTabsFromSingleSheet(spreadsheetId = null) {
    const client = this.sheetsClient;
    const targetSpreadsheetId = this.resolveSpreadsheetId(spreadsheetId);
    if (!client || !targetSpreadsheetId) {
      throw new Error(
        "Google Sheets client is not authenticated or SPREADSHEET_ID is missing in .env.",
      );
    }

    const ranges = [
      `${this.resultSheetName}!A:J`,
      `${this.ordersSheetName}!A:AJ`,
      `${this.rateCardSheetName}!A:I`,
      `${this.pincodeSheetName}!A:H`,
    ];

    const response = await client.spreadsheets.values.batchGet({
      spreadsheetId: targetSpreadsheetId,
      ranges,
    });

    const valueRanges = response.data.valueRanges || [];

    const rawResult = valueRanges[0]?.values || [];
    const rawOrders = valueRanges[1]?.values || [];
    const rawRates = valueRanges[2]?.values || [];
    const rawPincodes = valueRanges[3]?.values || [];

    return {
      result: this.parseResultRows(rawResult),
      orders: this.parseOrdersRows(rawOrders),
      rateCard: this.parseRateCardRows(rawRates),
      pincodeMaster: this.parsePincodeMasterRows(rawPincodes),
    };
  }

  /**
   * Sheet 1: Fetch Pincode Master Data
   */
  async fetchPincodeMaster(spreadsheetId = null) {
    const targetId = this.resolveSpreadsheetId(spreadsheetId);
    const rawRows = await this.getSheetValues(
      targetId,
      `${this.pincodeSheetName}!A:H`,
    );
    return this.parsePincodeMasterRows(rawRows);
  }

  parsePincodeMasterRows(rawRows) {
    if (!rawRows || rawRows.length < 2) return [];
    return rawRows.slice(1).map((row) => ({
      clientLocation: row[0] || "",
      hubName: row[1] || "",
      pincode: (row[2] || "").toString().trim(),
      ecomServiceable: row[3] || "N",
      local: row[4] || "",
      zonal: row[5] || "",
      metro: row[6] || "",
      roi: row[7] || "",
    }));
  }

  /**
   * Sheet 2: Fetch Rate Card Data
   */
  async fetchRateCard(spreadsheetId = null) {
    const targetId = this.resolveSpreadsheetId(spreadsheetId);
    const rawRows = await this.getSheetValues(
      targetId,
      `${this.rateCardSheetName}!A:I`,
    );
    return this.parseRateCardRows(rawRows);
  }

  parseRateCardRows(rawRows) {
    if (!rawRows || rawRows.length < 2) return [];
    return rawRows.slice(1).map((row) => ({
      mode: row[0] || "Surface",
      slabFrom: parseFloat(row[1]) || 0,
      slabTo:
        row[2] === "NULL" || row[2] === "" || row[2] === null
          ? null
          : parseFloat(row[2]),
      slabType: row[3] || "Fixed",
      local: parseFloat(row[4]) || 0,
      withinZone: parseFloat(row[5]) || 0,
      metro: parseFloat(row[6]) || 0,
      roi: parseFloat(row[7]) || 0,
      specialZone: parseFloat(row[8]) || 0,
    }));
  }

  /**
   * Sheet 3: Fetch Orders Data
   */
  async fetchOrders(spreadsheetId = null) {
    const targetId = this.resolveSpreadsheetId(spreadsheetId);
    const rawRows = await this.getSheetValues(
      targetId,
      `${this.ordersSheetName}!A:AO`,
    );
    return this.parseOrdersRows(rawRows);
  }

  parseOrdersRows(rawRows) {
    if (!rawRows || rawRows.length < 2) return [];
    return rawRows
      .slice(1)
      .filter((row) => row[4] !== "FAILED")
      .map((row) => ({
        orderId: row[0] || "-",
        referenceId: row[1] || "-",
        awbNumber: row[2] || "-",
        orderStatus: row[3] || "-",
        shipmentStatus: row[4] || "-",
        orderDate: row[5] || "-",
        createdAt: row[6] || "-",
        carrierName: row[7] || "-",
        orderType: row[8] || "Forward",
        deliveryMode: row[9] || "SURFACE",
        parcelCategory: row[10] || "ECOMM",
        utmProduct: row[11] || "-",
        pickupName: row[12] || "-",
        pickupPhone: row[13] || "-",
        pickupCity: row[14] || "-",
        pickupState: row[15] || "-",
        pickupPincode: (row[16] || "").toString().trim(),
        deliveryName: row[17] || "-",
        deliveryPhone: row[18] || "-",
        deliveryCity: row[19] || "-",
        deliveryState: row[20] || "-",
        deliveryPincode: (row[21] || "").toString().trim(),
        itemsName: row[22] || "-",
        itemsSku: row[23] || "-",
        quantity: parseInt(row[24], 10) || 1,
        itemsUnitPrice: parseFloat(row[25]) || 0,
        totalItemPrice: parseFloat(row[26]) || 0,
        physicalWeight: parseFloat(row[27]) || 0,
        volumetricWeight: parseFloat(row[28]) || 0,
        length: parseFloat(row[29]) || 0,
        width: parseFloat(row[30]) || 0,
        height: parseFloat(row[31]) || 0,
        paymentType: row[32] || "COD",
        totalFreightCharges: parseFloat(row[33]) || 0,
        documentType: row[34] || "-",
        documentNumber: row[35] || "-",
        documentLink: row[36] || "-",
        eWayBillNumber: row[37] || "-",
        hasDispute: row[38] || false,
        manifested: row[39] || false,
        failedReason: row[40] || "-",
        deliveryStatus: String(row[4] ?? "").includes("RTO")
          ? "RTO"
          : "Delivered",
      }));
  }

  /**
   * Sheet 4: Parse existing Result Tab Data
   */
  parseResultRows(rawRows) {
    if (!rawRows || rawRows.length < 2) return [];
    return rawRows.slice(1).map((row) => ({
      referenceId: row[0] || "",
      awbNumber: row[1] || "",
      pickupPincode: row[2] || "",
      deliveryPincode: row[3] || "",
      deliveryZone: row[4] || "",
      physicalWeight: parseFloat(row[5]) || 0,
      volumetricWeight: parseFloat(row[6]) || 0,
      chargeableWeight: parseFloat(row[7]) || 0,
      rateSlabUsed: row[8] || "",
      totalShippingCost: parseFloat(row[9]) || 0,
    }));
  }

  /**
   * Fetch complete raw Orders table (including all original columns & header)
   */
  async fetchRawOrdersTable(spreadsheetId = null) {
    const targetId = this.resolveSpreadsheetId(spreadsheetId);

    const rawRows = await this.getSheetValues(
      targetId,
      `${this.ordersSheetName}!A:AO`,
    );

    if (!rawRows || rawRows.length < 2) {
      return {
        header: rawRows?.[0] || [],
        rows: [],
      };
    }

    return {
      header: rawRows[0],
      rows: rawRows
        .slice(1)
        .filter((row) => row[4] !== "FAILED")
        .map((row) => [
          row[0] || "-",
          row[1] || "-",
          row[2] || "-",
          row[3] || "-",
          row[4] || "-",
          row[5] || "-",
          row[6] || "-",
          row[7] || "-",
          row[8] || "Forward",
          row[9] || "SURFACE",
          row[10] || "ECOMM",
          row[11] || "-",
          row[12] || "-",
          row[13] || "-",
          row[14] || "-",
          row[15] || "-",
          String(row[16] || "").trim(),
          row[17] || "-",
          row[18] || "-",
          row[19] || "-",
          row[20] || "-",
          String(row[21] || "").trim(),
          row[22] || "-",
          row[23] || "-",
          parseInt(row[24], 10) || 1,
          parseFloat(row[25]) || 0,
          parseFloat(row[26]) || 0,
          parseFloat(row[27]) || 0,
          parseFloat(row[28]) || 0,
          parseFloat(row[29]) || 0,
          parseFloat(row[30]) || 0,
          parseFloat(row[31]) || 0,
          row[32] || "COD",
          parseFloat(row[33]) || 0,
          row[34] || "-",
          row[35] || "-",
          row[36] || "-",
          row[37] || "-",
          row[38] || false,
          row[39] || false,
          row[40] || "-",
          String(row[4] ?? "").includes("RTO") ? "RTO" : "Delivered",
        ]),
    };
  }

  /**
   * Write calculated fields to the "Result" tab in the Google Sheet
   */
  async writeCalculationsToResultSheet(calculatedOrders, spreadsheetId = null) {
    const client = this.sheetsClient;
    const targetSpreadsheetId = this.resolveSpreadsheetId(spreadsheetId);
    if (!client || !targetSpreadsheetId) {
      throw new Error(
        "Google Sheets client is not authenticated or SPREADSHEET_ID is missing in .env.",
      );
    }

    const headerRow = [
      "Reference ID",
      "AWB Number",
      "Pickup Pincode",
      "Delivery Pincode",
      "Delivery Zone",
      "Physical Weight (KG)",
      "Volumetric Weight (KG)",
      "Chargeable Weight (KG)",
      "Rate Slab Used",
      "Total Shipping Freight (₹)",
    ];

    const valueRows = calculatedOrders.map((order) => [
      order.referenceId,
      order.awbNumber,
      order.pickupPincode,
      order.deliveryPincode,
      order.deliveryZone,
      order.physicalWeight,
      order.volumetricWeight,
      order.chargeableWeight,
      order.rateSlabUsed,
      order.totalShippingCost,
    ]);

    const values = [headerRow, ...valueRows];

    const response = await client.spreadsheets.values.update({
      spreadsheetId: targetSpreadsheetId,
      range: `${this.resultSheetName}!A1`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values,
      },
    });

    return response.data;
  }

  /**
   * Write complete enriched raw Orders table (all columns + financial breakdown) to Result sheet tab
   */
  async writeRawTableToResultSheet(headerRow, valueRows, spreadsheetId = null) {
    const client = this.sheetsClient;
    const targetSpreadsheetId = this.resolveSpreadsheetId(spreadsheetId);
    if (!client || !targetSpreadsheetId) {
      throw new Error(
        "Google Sheets client is not authenticated or SPREADSHEET_ID is missing in .env.",
      );
    }

    const sanitizeValue = (val) => {
      if (val === null || val === undefined) return "-";
      if (typeof val === "string" && val.trim() === "") return "-";
      return val;
    };

    const sanitizedHeader = (headerRow || []).map((h) => sanitizeValue(h));
    const sanitizedValueRows = (valueRows || []).map((row) =>
      (row || []).map((cell) => sanitizeValue(cell)),
    );

    const values = [sanitizedHeader, ...sanitizedValueRows];

    const response = await client.spreadsheets.values.update({
      spreadsheetId: targetSpreadsheetId,
      range: `${this.resultSheetName}!A1`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values,
      },
    });

    return response.data;
  }
}

module.exports = new GoogleSheetsService();
