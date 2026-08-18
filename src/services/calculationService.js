const pincodeService = require('./pincodeService');
const rateCardService = require('./rateCardService');
const googleSheetsService = require('./googleSheetsService');

// Local fallback datasets
const localPincodes = require('../data/pincodeMaster.json');
const localRateCard = require('../data/rateCard.json');
const localOrders = require('../data/orders.json');

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
    const pickupPincode = order.pickupPincode || '395004';
    const deliveryPincode = order.deliveryPincode || '';
    const physicalWeight = parseFloat(order.physicalWeight) || 0;
    const length = parseFloat(order.length) || 0;
    const width = parseFloat(order.width) || 0;
    const height = parseFloat(order.height) || 0;
    const deliveryMode = order.deliveryMode || 'SURFACE';

    // 1. Calculate Volumetric Weight
    const volumetricWeight = this.calculateVolumetricWeight(length, width, height);

    // 2. Calculate Chargeable Weight
    const chargeableWeight = this.calculateChargeableWeight(physicalWeight, volumetricWeight);

    // 3. Resolve Zone
    const deliveryZone = pincodeService.determineZone(pickupPincode, deliveryPincode, pincodesData);

    // 4. Calculate Rate Freight
    const freightDetails = rateCardService.calculateFreightRate(deliveryMode, chargeableWeight, deliveryZone, ratesData);

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
      shopifyOrderId: order.shopifyOrderId
    };
  }

  /**
   * Process calculations reading from "Orders", "RateCard", and "PincodeMaster" tabs in a single Google Sheet
   */
  async processSingleSheetWithAllTabs(spreadsheetId = null, writeToResultTab = false) {
    let pincodesData = localPincodes;
    let ratesData = localRateCard;
    let ordersData = localOrders;
    let resultData = [];
    let dataSource = 'Local Seed Datasets';

    if (googleSheetsService.isConfigured()) {
      try {
        console.log('Fetching all 4 tabs from single Google Sheet...');
        const allTabs = await googleSheetsService.fetchAllTabsFromSingleSheet(spreadsheetId);
        
        if (allTabs.pincodeMaster && allTabs.pincodeMaster.length > 0) pincodesData = allTabs.pincodeMaster;
        if (allTabs.rateCard && allTabs.rateCard.length > 0) ratesData = allTabs.rateCard;
        if (allTabs.orders && allTabs.orders.length > 0) ordersData = allTabs.orders;
        resultData = allTabs.result || [];
        dataSource = `Google Sheet (${spreadsheetId || googleSheetsService.spreadsheetId})`;
      } catch (err) {
        console.warn('Single sheet batch fetch failed, fallback to local datasets:', err.message);
      }
    }

    const calculatedOrders = ordersData.map(order => 
      this.calculateSingleOrder(order, pincodesData, ratesData)
    );

    let writeResult = null;
    if (writeToResultTab && googleSheetsService.isConfigured()) {
      writeResult = await googleSheetsService.writeCalculationsToResultSheet(calculatedOrders, spreadsheetId);
    }

    return {
      dataSource,
      sheetTabs: ["Result", "Orders", "RateCard", "PincodeMaster"],
      totalOrdersProcessed: calculatedOrders.length,
      totalFreightCost: calculatedOrders.reduce((sum, o) => sum + o.totalShippingCost, 0),
      existingResultRecords: resultData.length,
      resultTabUpdated: !!writeResult,
      updatedRange: writeResult?.updatedRange || null,
      processedAt: new Date().toISOString(),
      orders: calculatedOrders
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
    let dataSource = 'Local Seed Datasets';

    if (googleSheetsService.isConfigured()) {
      try {
        console.log('Fetching sheets for calculation...');
        const [gsPincodes, gsRates, rawOrders] = await Promise.all([
          googleSheetsService.fetchPincodeMaster(spreadsheetId),
          googleSheetsService.fetchRateCard(spreadsheetId),
          googleSheetsService.fetchRawOrdersTable(spreadsheetId)
        ]);

        if (gsPincodes.length > 0) pincodesData = gsPincodes;
        if (gsRates.length > 0) ratesData = gsRates;
        if (rawOrders.rows.length > 0) rawTable = rawOrders;
        dataSource = `Google Sheet (${spreadsheetId || googleSheetsService.spreadsheetId})`;
      } catch (err) {
        console.warn('Google Sheets fetch error, fallback to local dataset:', err.message);
      }
    }

    // Fallback if rawTable is empty
    if (!rawTable.header || rawTable.header.length === 0) {
      rawTable.header = [
        '* reference Id', '* order date', '* order type', '* parcel category', 'delivery mode',
        '* payment type', 'awb number', 'eWaybills', '* pickup name', '* pickup phone',
        '* pickup address', 'pickup landmark', '* pickup city', '* pickup state', '* pickup pincode',
        '* delivery name', '* delivery phone', '* delivery address', 'delivery landmark', '* delivery city',
        '* delivery state', '* delivery pincode', '* physical weight (kg)', '* length (cm)', '* width (cm)',
        '* height (cm)', '* itemsName', 'itemsSku', '* quantity', '* itemsUnitPrice (rupees)',
        'description', 'itemTaxType', 'itemTaxValue', 'itemDiscountType', 'itemDiscountValue', 'Shopify Order ID'
      ];
      rawTable.rows = localOrders.map(o => [
        o.referenceId, o.orderDate, o.orderType, o.parcelCategory, o.deliveryMode,
        o.paymentType, o.awbNumber, '', 'Ratguard', '8780910027',
        'Plot No C/25', 'Vijayraj Circle', 'Surat', 'Gujarat', o.pickupPincode || '395004',
        o.deliveryName, o.deliveryPhone, o.deliveryAddress, '', o.deliveryCity,
        o.deliveryState, o.deliveryPincode, o.physicalWeight, o.length, o.width,
        o.height, o.itemsName, o.itemsSku, o.quantity, o.itemsUnitPrice,
        '', '', '', '', '', o.shopifyOrderId
      ]);
    }

    // Find column indices dynamically from header
    const headers = rawTable.header.map(h => h.toString().trim().toLowerCase());
    
    let modeIdx = headers.findIndex(h => h.includes('delivery mode') || h.includes('mode'));
    if (modeIdx === -1) modeIdx = 4;

    let pickupPincodeIdx = headers.findIndex(h => h.includes('pickup pincode'));
    if (pickupPincodeIdx === -1) pickupPincodeIdx = 14;

    let deliveryPincodeIdx = headers.findIndex(h => h.includes('delivery pincode'));
    if (deliveryPincodeIdx === -1) deliveryPincodeIdx = 21;

    let weightIdx = headers.findIndex(h => h.includes('physical weight') || h.includes('weight'));
    if (weightIdx === -1) weightIdx = 22;

    // Build enriched headers: Original Columns + "Rate"
    const resultHeader = [...rawTable.header, 'Rate'];

    const enrichedRows = [];
    const summaryOrders = [];

    for (const row of rawTable.rows) {
      const mode = row[modeIdx] || 'SURFACE';
      const pickupPincode = (row[pickupPincodeIdx] || '395004').toString().trim();
      const deliveryPincode = (row[deliveryPincodeIdx] || '').toString().trim();
      const physicalWeight = parseFloat(row[weightIdx]) || 0;

      // 1. Resolve Zone
      const zone = pincodeService.determineZone(pickupPincode, deliveryPincode, pincodesData);

      // 2. Calculate Rate
      const freightDetails = rateCardService.calculateFreightRate(mode, physicalWeight, zone, ratesData);
      const calculatedRate = freightDetails.totalCost;

      // Append Rate to raw row
      const newRow = [...row, calculatedRate];
      enrichedRows.push(newRow);

      summaryOrders.push({
        referenceId: row[0] || '',
        awbNumber: row[6] || '',
        deliveryPincode,
        deliveryMode: mode,
        physicalWeight,
        deliveryZone: zone,
        rateSlab: freightDetails.slabRange,
        rate: calculatedRate
      });
    }

    let sheetUpdateResult = null;
    if (googleSheetsService.isConfigured()) {
      sheetUpdateResult = await googleSheetsService.writeRawTableToResultSheet(
        resultHeader,
        enrichedRows,
        spreadsheetId
      );
    }

    return {
      dataSource,
      totalOrdersProcessed: enrichedRows.length,
      totalCalculatedRateSum: summaryOrders.reduce((sum, o) => sum + o.rate, 0),
      resultSheetSaved: !!sheetUpdateResult,
      updatedRange: sheetUpdateResult?.updatedRange || null,
      newColumnAdded: 'Rate',
      processedAt: new Date().toISOString(),
      orders: summaryOrders
    };
  }

  /**
   * Main calculation process using 3 Sheets (or fallback local datasets)
   */
  async processAllOrders(useGoogleSheets = false) {
    let pincodesData = localPincodes;
    let ratesData = localRateCard;
    let ordersData = localOrders;
    let dataSource = 'Local Seed Datasets';

    if (useGoogleSheets && googleSheetsService.isConfigured()) {
      try {
        console.log('Fetching data from 3 Google Sheets...');
        const [gsPincodes, gsRates, gsOrders] = await Promise.all([
          googleSheetsService.fetchPincodeMaster(),
          googleSheetsService.fetchRateCard(),
          googleSheetsService.fetchOrders()
        ]);

        if (gsPincodes.length > 0) pincodesData = gsPincodes;
        if (gsRates.length > 0) ratesData = gsRates;
        if (gsOrders.length > 0) ordersData = gsOrders;
        dataSource = 'Google Sheets API';
      } catch (err) {
        console.warn('Google Sheets fetch failed or incomplete, using local datasets fallback:', err.message);
      }
    }

    const calculatedOrders = ordersData.map(order => 
      this.calculateSingleOrder(order, pincodesData, ratesData)
    );

    const summary = {
      dataSource,
      totalOrdersProcessed: calculatedOrders.length,
      totalFreightCost: calculatedOrders.reduce((sum, o) => sum + o.totalShippingCost, 0),
      processedAt: new Date().toISOString(),
      orders: calculatedOrders
    };

    return summary;
  }
}

module.exports = new CalculationService();
