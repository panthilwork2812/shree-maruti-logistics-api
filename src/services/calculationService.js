const pincodeService = require("./pincodeService");
const rateCardService = require("./rateCardService");
const googleSheetsService = require("./googleSheetsService");

// Local fallback datasets
const localPincodes = require("../data/pincodeMaster.json");
const localRateCard = require("../data/rateCard.json");
const localOrders = require("../data/orders.json");

class CalculationService {
  /**
   * Calculates volumetric weight in kg from dimensions in cm
   */
  calculateVolumetricWeight(length, width, height, divisor = 5000) {
    const l = parseFloat(length) || 0;
    const w = parseFloat(width) || 0;
    const h = parseFloat(height) || 0;

    const volumeCm3 = l * w * h;
    const volumetricKg = volumeCm3 / divisor;
    return parseFloat(volumetricKg.toFixed(4));
  }

  /**
   * Determine Chargeable Weight: max(Physical Weight, Volumetric Weight)
   */
  calculateChargeableWeight(physicalWeight, volumetricWeight) {
    const phys = parseFloat(physicalWeight) || 0;
    const vol = parseFloat(volumetricWeight) || 0;
    return parseFloat(Math.max(phys, vol).toFixed(4));
  }

  /**
   * Process a single order calculation using datasets
   */
  calculateSingleOrder(order, pincodesData = null, ratesData = null) {
    const pickupPincode = order.pickupPincode || "395004";
    const deliveryPincode = order.deliveryPincode || "";
    const physicalWeight = parseFloat(order.physicalWeight) || 0;
    const length = parseFloat(order.length) || 0;
    const width = parseFloat(order.width) || 0;
    const height = parseFloat(order.height) || 0;
    const deliveryMode = order.deliveryMode || "SURFACE";

    // 1. Calculate Volumetric Weight
    const volumetricWeight = this.calculateVolumetricWeight(
      length,
      width,
      height,
    );

    // 2. Calculate Chargeable Weight
    const chargeableWeight = this.calculateChargeableWeight(
      physicalWeight,
      volumetricWeight,
    );

    // 3. Resolve Zone
    const deliveryZone = pincodeService.determineZone(
      pickupPincode,
      deliveryPincode,
      pincodesData,
    );

    // 4. Calculate Rate Freight
    const freightDetails = rateCardService.calculateFreightRate(
      deliveryMode,
      chargeableWeight,
      deliveryZone,
      ratesData,
    );

    return {
      referenceId: order.referenceId,
      awbNumber: order.awbNumber,
      orderDate: order.orderDate,
      pickupPincode,
      deliveryPincode,
      deliveryCity: order.deliveryCity,
      deliveryState: order.deliveryState,
      deliveryMode,
      physicalWeight,
      dimensions: `${length} x ${width} x ${height} cm`,
      volumetricWeight,
      chargeableWeight,
      deliveryZone,
      rateSlabUsed: freightDetails.slabRange,
      baseCost: freightDetails.baseCost,
      additionalCost: freightDetails.additionalCost,
      totalShippingCost: freightDetails.totalCost,
      itemsName: order.itemsName,
      shopifyOrderId: order.shopifyOrderId,
    };
  }

  /**
   * Process calculations reading from "Orders", "RateCard", and "PincodeMaster" tabs in a single Google Sheet
   */
  async processSingleSheetWithAllTabs(
    spreadsheetId = null,
    writeToResultTab = false,
  ) {
    let pincodesData = localPincodes;
    let ratesData = localRateCard;
    let ordersData = localOrders;
    let resultData = [];
    let dataSource = "Local Seed Datasets";

    if (googleSheetsService.isConfigured()) {
      try {
        console.log("Fetching all 4 tabs from single Google Sheet...");
        const allTabs =
          await googleSheetsService.fetchAllTabsFromSingleSheet(spreadsheetId);

        if (allTabs.pincodeMaster && allTabs.pincodeMaster.length > 0)
          pincodesData = allTabs.pincodeMaster;
        if (allTabs.rateCard && allTabs.rateCard.length > 0)
          ratesData = allTabs.rateCard;
        if (allTabs.orders && allTabs.orders.length > 0)
          ordersData = allTabs.orders;
        resultData = allTabs.result || [];
        dataSource = `Google Sheet (${spreadsheetId || googleSheetsService.spreadsheetId})`;
      } catch (err) {
        console.warn(
          "Single sheet batch fetch failed, fallback to local datasets:",
          err.message,
        );
      }
    }

    const calculatedOrders = ordersData.map((order) =>
      this.calculateSingleOrder(order, pincodesData, ratesData),
    );

    let writeResult = null;
    if (writeToResultTab && googleSheetsService.isConfigured()) {
      writeResult = await googleSheetsService.writeCalculationsToResultSheet(
        calculatedOrders,
        spreadsheetId,
      );
    }

    return {
      dataSource,
      sheetTabs: ["Result", "Orders", "RateCard", "PincodeMaster"],
      totalOrdersProcessed: calculatedOrders.length,
      totalFreightCost: calculatedOrders.reduce(
        (sum, o) => sum + o.totalShippingCost,
        0,
      ),
      existingResultRecords: resultData.length,
      resultTabUpdated: !!writeResult,
      updatedRange: writeResult?.updatedRange || null,
      processedAt: new Date().toISOString(),
      orders: calculatedOrders,
    };
  }

  /**
   * Main Consolidated Calculation Method:
   * Reads "Orders", "RateCard", and "PincodeMaster" tabs,
   * computes the exact Rate for every order row based on deliveryMode & physicalWeight & pincode zone,
   * appends the new column "Rate" to all original order columns,
   * and saves/writes all rows into the "Result" sheet tab!
   */
  async calculateAndSaveAllRowsWithRate(spreadsheetId = null) {
    let pincodesData = localPincodes;
    let ratesData = localRateCard;
    let rawTable = { header: [], rows: [] };
    let dataSource = "Local Seed Datasets";

    console.log("=======================================================");
    console.log("🚀 [1/4] Starting Freight Rate & Financial Breakdown Engine...");
    console.log(`📊 Target Spreadsheet ID: ${spreadsheetId || googleSheetsService.spreadsheetId || "Local Seed"}`);

    if (googleSheetsService.isConfigured()) {
      try {
        console.log("⏳ [2/4] Fetching Pincode Master, Rate Card, and Orders from Google Sheets...");
        const [gsPincodes, gsRates, rawOrders] = await Promise.all([
          googleSheetsService.fetchPincodeMaster(spreadsheetId),
          googleSheetsService.fetchRateCard(spreadsheetId),
          googleSheetsService.fetchRawOrdersTable(spreadsheetId),
        ]);

        if (gsPincodes.length > 0) pincodesData = gsPincodes;
        if (gsRates.length > 0) ratesData = gsRates;
        if (rawOrders.rows.length > 0) rawTable = rawOrders;
        dataSource = `Google Sheet (${spreadsheetId || googleSheetsService.spreadsheetId})`;
        console.log(`✅ [2/4] Successfully fetched Google Sheets data: ${pincodesData.length} Pincodes, ${ratesData.length} Rate Slabs, ${rawTable.rows.length} Order Rows.`);
      } catch (err) {
        console.warn(
          "⚠️ Google Sheets fetch error, fallback to local dataset:",
          err.message,
        );
      }
    } else {
      console.log("ℹ️ Google Sheets not configured. Using local JSON seed datasets.");
    }

    // Fallback if rawTable is empty
    if (!rawTable.header || rawTable.header.length === 0) {
      rawTable.header = [
        "* reference Id",
        "* order date",
        "* order type",
        "* parcel category",
        "delivery mode",
        "* payment type",
        "awb number",
        "eWaybills",
        "* pickup name",
        "* pickup phone",
        "* pickup address",
        "pickup landmark",
        "* pickup city",
        "* pickup state",
        "* pickup pincode",
        "* delivery name",
        "* delivery phone",
        "* delivery address",
        "delivery landmark",
        "* delivery city",
        "* delivery state",
        "* delivery pincode",
        "* physical weight (kg)",
        "* length (cm)",
        "* width (cm)",
        "* height (cm)",
        "* itemsName",
        "itemsSku",
        "* quantity",
        "* itemsUnitPrice (rupees)",
        "description",
        "itemTaxType",
        "itemTaxValue",
        "itemDiscountType",
        "itemDiscountValue",
        "Shopify Order ID",
        "delivery Status",
      ];
      rawTable.rows = localOrders.map((o) => [
        o.referenceId,
        o.orderDate,
        o.orderType,
        o.parcelCategory,
        o.deliveryMode,
        o.paymentType,
        o.awbNumber,
        o.eWaybills || "-",
        o.pickupName,
        o.pickupPhone,
        o.pickupAddress,
        o.pickupLandmark,
        o.pickupCity,
        o.pickupState,
        o.pickupPincode || "-",
        o.deliveryName,
        o.deliveryPhone,
        o.deliveryAddress,
        o.deliveryLandmark || "-",
        o.deliveryCity,
        o.deliveryState,
        o.deliveryPincode,
        o.physicalWeight,
        o.length,
        o.width,
        o.height,
        o.itemsName,
        o.itemsSku,
        o.quantity,
        o.itemsUnitPrice,
        o.description || "-",
        o.itemTaxType || "-",
        o.itemTaxValue || "-",
        o.itemDiscountType || "-",
        o.itemDiscountValue || "-",
        o.shopifyOrderId || "-",
        o.deliveryStatus,
      ]);
    }

    // Find column indices dynamically from header
    const headers = rawTable.header.map((h) =>
      h.toString().trim().toLowerCase(),
    );

    let modeIdx = headers.findIndex(
      (h) => h.includes("delivery mode") || h.includes("mode"),
    );
    if (modeIdx === -1) modeIdx = 4;

    let paymentTypeIdx = headers.findIndex(
      (h) => h.includes("payment type") || h.includes("payment"),
    );
    if (paymentTypeIdx === -1) paymentTypeIdx = 5;

    let pickupPincodeIdx = headers.findIndex((h) =>
      h.includes("pickup pincode"),
    );
    if (pickupPincodeIdx === -1) pickupPincodeIdx = 14;

    let deliveryPincodeIdx = headers.findIndex((h) =>
      h.includes("delivery pincode"),
    );
    if (deliveryPincodeIdx === -1) deliveryPincodeIdx = 21;

    let weightIdx = headers.findIndex(
      (h) => h.includes("physical weight") || h.includes("weight"),
    );
    if (weightIdx === -1) weightIdx = 22;

    let deliveryStatusIdx = headers.findIndex(
      (h) =>
        h.includes("delivery status") ||
        h.includes("deliverystatus") ||
        h.includes("delivery_status"),
    );
    console.log("deliveryStatusIdx", deliveryStatusIdx);
    // If DeliveryStatus column is NOT present in original headers, we append it.
    // Otherwise, we update the existing status column in-place to prevent duplicates.
    const appendDeliveryStatusCol = deliveryStatusIdx === -1;

    const newFinancialHeaders = [
      "Rate",
      "COD",
      "RTOAmount(90%)",
      "subTotal",
      "GST(18%)",
      "Total",
    ];

    const newHeaders = newFinancialHeaders;

    const resultHeader = [...rawTable.header, ...newHeaders];

    const enrichedRows = [];
    const summaryOrders = [];

    console.log(`🧮 [3/4] Calculating rates & financial breakdown for ${rawTable.rows.length} order rows...`);

    let rowIndex = 0;
    for (const row of rawTable.rows) {
      rowIndex++;
      if (rowIndex % 10 === 0 || rowIndex === rawTable.rows.length) {
        console.log(`   └─ Progress: Processed ${rowIndex}/${rawTable.rows.length} orders...`);
      }

      const mode = row[modeIdx] || "SURFACE";
      const pickupPincode = (row[pickupPincodeIdx] || "395004")
        .toString()
        .trim();
      const deliveryPincode = (row[deliveryPincodeIdx] || "").toString().trim();
      const physicalWeight = parseFloat(row[weightIdx]) || 0;

      const rawStatus = row[deliveryStatusIdx] || "-";

      const paymentType = (row[paymentTypeIdx] || "COD").toString();

      // 1. Resolve Delivery Status (Delivered vs RTO)
      const isRto = rawStatus === "RTO";
      const deliveryStatus = isRto ? "RTO" : "Delivered";

      // If deliveryStatus column already exists in raw row, update its value in-place
      const rowCopy = [...row];
      if (deliveryStatusIdx !== -1) {
        rowCopy[deliveryStatusIdx] = deliveryStatus;
      }

      // 2. Resolve Zone
      const zone = pincodeService.determineZone(
        pickupPincode,
        deliveryPincode,
        pincodesData,
      );

      // 3. Calculate Freight Rate
      const freightDetails = rateCardService.calculateFreightRate(
        mode,
        physicalWeight,
        zone,
        ratesData,
      );
      const rate = freightDetails.totalCost;

      // 4. Financial Calculations:
      // Delivered: COD = 25, RTOAmount = '-'
      // RTO: COD = '-', RTOAmount = Rate * 0.90
      const isCod = /cod/i.test(paymentType) || !paymentType;

      let codCharge = 0;
      let codDisplay = "-";
      if (!isRto && isCod) {
        codCharge = 25;
        codDisplay = 25;
      }

      let rtoAmount = 0;
      let rtoDisplay = "-";
      if (isRto) {
        rtoAmount = parseFloat((rate * 0.9).toFixed(4));
        rtoDisplay = rtoAmount;
      }

      // subTotal = Rate + COD + RTOAmount
      const subTotal = parseFloat((rate + codCharge + rtoAmount).toFixed(4));

      // GST(18%) = subTotal * 0.18
      const gst18 = parseFloat((subTotal * 0.18).toFixed(4));

      // Total = subTotal + GST(18%)
      const total = parseFloat((subTotal + gst18).toFixed(4));

      // Append calculated columns
      const calculatedCols = [
        rate,
        codDisplay,
        rtoDisplay,
        subTotal,
        gst18,
        total,
      ];

      const newRow = [...rowCopy, ...calculatedCols];

      const sanitizedRow = newRow.map((cell) => {
        if (cell === null || cell === undefined) return "-";
        if (typeof cell === "string" && cell.trim() === "") return "-";
        return cell;
      });
      enrichedRows.push(sanitizedRow);

      summaryOrders.push({
        referenceId: row[0] || "",
        awbNumber: row[6] || "",
        deliveryPincode,
        deliveryMode: mode,
        physicalWeight,
        deliveryZone: zone,
        deliveryStatus,
        rate,
        cod: codDisplay,
        rtoAmount: rtoDisplay,
        subTotal,
        gst18,
        total,
      });
    }

    let sheetUpdateResult = null;
    if (googleSheetsService.isConfigured()) {
      console.log(`💾 [4/4] Writing ${enrichedRows.length} enriched rows to Google Sheet "Result" tab...`);
      sheetUpdateResult = await googleSheetsService.writeRawTableToResultSheet(
        resultHeader,
        enrichedRows,
        spreadsheetId,
      );
      if (sheetUpdateResult?.updatedRange) {
        console.log(`✅ [4/4] Updated Google Sheet "Result" tab range: ${sheetUpdateResult.updatedRange}`);
      }
    }

    const totalGrandSum = parseFloat(summaryOrders.reduce((sum, o) => sum + o.total, 0).toFixed(2));
    console.log("=======================================================");
    console.log("🎉 Freight Calculation & Sheet Sync Finished Successfully!");
    console.log(`   ├─ Total Orders Processed : ${enrichedRows.length}`);
    console.log(`   ├─ Total Freight Cost     : ₹${summaryOrders.reduce((sum, o) => sum + o.rate, 0)}`);
    console.log(`   └─ Grand Total Amount     : ₹${totalGrandSum}`);
    console.log("=======================================================");

    return {
      dataSource,
      totalOrdersProcessed: enrichedRows.length,
      totalCalculatedRateSum: summaryOrders.reduce((sum, o) => sum + o.rate, 0),
      totalSubTotalSum: parseFloat(
        summaryOrders.reduce((sum, o) => sum + o.subTotal, 0).toFixed(2),
      ),
      totalGstSum: parseFloat(
        summaryOrders.reduce((sum, o) => sum + o.gst18, 0).toFixed(2),
      ),
      totalGrandAmount: parseFloat(
        summaryOrders.reduce((sum, o) => sum + o.total, 0).toFixed(2),
      ),
      resultSheetSaved: !!sheetUpdateResult,
      updatedRange: sheetUpdateResult?.updatedRange || null,
      addedColumns: newHeaders,
      processedAt: new Date().toISOString(),
      orders: summaryOrders,
    };
  }

  /**
   * Main calculation process using 3 Sheets (or fallback local datasets)
   */
  async processAllOrders(useGoogleSheets = false) {
    let pincodesData = localPincodes;
    let ratesData = localRateCard;
    let ordersData = localOrders;
    let dataSource = "Local Seed Datasets";

    if (useGoogleSheets && googleSheetsService.isConfigured()) {
      try {
        console.log("Fetching data from 3 Google Sheets...");
        const [gsPincodes, gsRates, gsOrders] = await Promise.all([
          googleSheetsService.fetchPincodeMaster(),
          googleSheetsService.fetchRateCard(),
          googleSheetsService.fetchOrders(),
        ]);

        if (gsPincodes.length > 0) pincodesData = gsPincodes;
        if (gsRates.length > 0) ratesData = gsRates;
        if (gsOrders.length > 0) ordersData = gsOrders;
        dataSource = "Google Sheets API";
      } catch (err) {
        console.warn(
          "Google Sheets fetch failed or incomplete, using local datasets fallback:",
          err.message,
        );
      }
    }

    const calculatedOrders = ordersData.map((order) =>
      this.calculateSingleOrder(order, pincodesData, ratesData),
    );

    const summary = {
      dataSource,
      totalOrdersProcessed: calculatedOrders.length,
      totalFreightCost: calculatedOrders.reduce(
        (sum, o) => sum + o.totalShippingCost,
        0,
      ),
      processedAt: new Date().toISOString(),
      orders: calculatedOrders,
    };

    return summary;
  }
}

module.exports = new CalculationService();
