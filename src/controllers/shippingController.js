const calculationService = require("../services/calculationService");
const googleSheetsService = require("../services/googleSheetsService");

const localPincodes = require("../data/pincodeMaster.json");
const localRateCard = require("../data/rateCard.json");
const localOrders = require("../data/orders.json");

/**
 * Controller handling all shipping rate calculation & sheet integration APIs
 */
class ShippingController {
  /**
   * GET /api/pincodes
   * Fetch Pincode master dataset (from Google Sheets or local fallback)
   */
  async getPincodes(req, res) {
    try {
      const useSheets = req.query.source === "sheets";
      if (useSheets && googleSheetsService.isConfigured()) {
        const pincodes = await googleSheetsService.fetchPincodeMaster();
        return res.json({
          status: "success",
          source: "Google Sheets",
          count: pincodes.length,
          data: pincodes,
        });
      }
      return res.json({
        status: "success",
        source: "Local JSON",
        count: localPincodes.length,
        data: localPincodes,
      });
    } catch (error) {
      return res.status(500).json({ status: "error", message: error.message });
    }
  }

  /**
   * GET /api/rates
   * Fetch Rate Card dataset (from Google Sheets or local fallback)
   */
  async getRateCard(req, res) {
    try {
      const useSheets = req.query.source === "sheets";
      if (useSheets && googleSheetsService.isConfigured()) {
        const rates = await googleSheetsService.fetchRateCard();
        return res.json({
          status: "success",
          source: "Google Sheets",
          count: rates.length,
          data: rates,
        });
      }
      return res.json({
        status: "success",
        source: "Local JSON",
        count: localRateCard.length,
        data: localRateCard,
      });
    } catch (error) {
      return res.status(500).json({ status: "error", message: error.message });
    }
  }

  /**
   * GET /api/orders
   * Fetch Raw Orders (from Google Sheets or local fallback)
   */
  async getOrders(req, res) {
    try {
      const useSheets = req.query.source === "sheets";
      console.log("useSheets: ", req.query);
      if (useSheets && googleSheetsService.isConfigured()) {
        const orders = await googleSheetsService.fetchOrders();
        return res.json({
          status: "success",
          source: "Google Sheets",
          count: orders.length,
          data: orders,
        });
      }
      return res.json({
        status: "success",
        source: "Local JSON",
        count: localOrders.length,
        data: localOrders,
      });
    } catch (error) {
      return res.status(500).json({ status: "error", message: error.message });
    }
  }

  /**
   * POST /api/calculate
   * Calculate rate for a single ad-hoc order payload
   * Payload: { pickupPincode, deliveryPincode, physicalWeight, length, width, height, deliveryMode }
   */
  async calculateSingle(req, res) {
    try {
      const {
        pickupPincode = "395004",
        deliveryPincode,
        physicalWeight = 0,
        length = 0,
        width = 0,
        height = 0,
        deliveryMode = "SURFACE",
      } = req.body;

      if (!deliveryPincode) {
        return res
          .status(400)
          .json({ status: "error", message: "deliveryPincode is required." });
      }

      const result = calculationService.calculateSingleOrder({
        pickupPincode,
        deliveryPincode,
        physicalWeight,
        length,
        width,
        height,
        deliveryMode,
      });

      return res.json({ status: "success", data: result });
    } catch (error) {
      return res.status(500).json({ status: "error", message: error.message });
    }
  }

  /**
   * POST /api/process-orders
   * Main calculation API combining 3 Sheets/Datasets
   */
  async processOrders(req, res) {
    try {
      const useGoogleSheets =
        req.body.useGoogleSheets === true ||
        req.query.useGoogleSheets === "true";
      const result = await calculationService.processAllOrders(useGoogleSheets);
      return res.json({ status: "success", ...result });
    } catch (error) {
      return res.status(500).json({ status: "error", message: error.message });
    }
  }

  /**
   * GET /api/all-tabs
   * Fetch all records across 4 tabs ["Result", "Orders", "RateCard", "PincodeMaster"] from 1 Google Sheet file
   */
  async getAllTabsData(req, res) {
    try {
      const spreadsheetId = req.query.spreadsheetId || null;
      if (googleSheetsService.isConfigured()) {
        const allTabs =
          await googleSheetsService.fetchAllTabsFromSingleSheet(spreadsheetId);
        return res.json({
          status: "success",
          source: "Google Sheets (Single File)",
          spreadsheetId: spreadsheetId || googleSheetsService.spreadsheetId,
          tabs: ["Result", "Orders", "RateCard", "PincodeMaster"],
          counts: {
            result: allTabs.result.length,
            orders: allTabs.orders.length,
            rateCard: allTabs.rateCard.length,
            pincodeMaster: allTabs.pincodeMaster.length,
          },
          data: allTabs,
        });
      }

      // Fallback local datasets
      return res.json({
        status: "success",
        source: "Local Seed Datasets",
        tabs: ["Result", "Orders", "RateCard", "PincodeMaster"],
        counts: {
          result: 0,
          orders: localOrders.length,
          rateCard: localRateCard.length,
          pincodeMaster: localPincodes.length,
        },
        data: {
          result: [],
          orders: localOrders,
          rateCard: localRateCard,
          pincodeMaster: localPincodes,
        },
      });
    } catch (error) {
      return res.status(500).json({ status: "error", message: error.message });
    }
  }

  /**
   * POST /api/process-single-sheet
   * Process calculations reading from "Orders", "RateCard", "PincodeMaster" in ONE Google Sheet
   * and writing the output into "Result" tab of that same Google Sheet
   */
  async processSingleSheet(req, res) {
    try {
      const { spreadsheetId, writeToSheet = true } = req.body;
      const result = await calculationService.processSingleSheetWithAllTabs(
        spreadsheetId,
        writeToSheet,
      );

      return res.json({
        status: "success",
        message: writeToSheet
          ? "Successfully calculated rates from Orders, RateCard, PincodeMaster tabs and updated Result tab!"
          : "Successfully calculated rates from single sheet!",
        ...result,
      });
    } catch (error) {
      return res.status(500).json({ status: "error", message: error.message });
    }
  }

  /**
   * POST /api/sync-to-sheet
   * Process calculations using 3 Google Sheets and write calculated columns back into Google Sheet
   */
  async syncToSheet(req, res) {
    try {
      if (!googleSheetsService.isConfigured()) {
        return res.status(400).json({
          status: "error",
          message:
            "Google Sheets is not configured. Please set credentials in .env or credentials.json.",
        });
      }

      const result = await calculationService.processAllOrders(true);
      const updateResult =
        await googleSheetsService.writeCalculationsToResultSheet(result.orders);

      return res.json({
        status: "success",
        message:
          "Calculations successfully written to Google Sheet Result tab!",
        ordersProcessed: result.totalOrdersProcessed,
        updatedRange: updateResult.updatedRange,
        updatedRows: updateResult.updatedRows,
      });
    } catch (error) {
      return res.status(500).json({ status: "error", message: error.message });
    }
  }

  /**
   * Primary Single API Endpoint:
   * POST /api/calculate-and-save
   * Reads Orders, RateCard, PincodeMaster, computes Rate for all rows based on deliveryMode & physicalWeight,
   * appends new financial breakdown columns to all original order rows, and saves the complete dataset into the "Result" sheet tab!
   */
  async calculateAndSave(req, res) {
    try {
      const spreadsheetId =
        req.body?.spreadsheetId ||
        req.query?.spreadsheetId ||
        process.env.SPREADSHEET_ID;
      console.log(`\n📥 [API Request] POST /api/calculate-and-save received.`);
      console.log(`   └─ Target Spreadsheet ID: ${spreadsheetId}`);

      const result =
        await calculationService.calculateAndSaveAllRowsWithRate(spreadsheetId);

      console.log(
        `📤 [API Response] Responding to client (Status: 200 OK, Processed: ${result.totalOrdersProcessed} orders)\n`,
      );
      return res.json({
        status: "success",
        message:
          "Successfully calculated rates for all orders and saved to Result sheet with financial breakdown!",
        ...result,
      });
    } catch (error) {
      console.error(`❌ [API Error] calculateAndSave failed: ${error.message}`);
      return res.status(500).json({ status: "error", message: error.message });
    }
  }
}

module.exports = new ShippingController();
