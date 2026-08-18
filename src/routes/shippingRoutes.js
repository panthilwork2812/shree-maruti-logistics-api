const express = require('express');
const router = express.Router();
const shippingController = require('../controllers/shippingController');

// Data inspection routes
router.get('/pincodes', (req, res) => shippingController.getPincodes(req, res));
router.get('/rates', (req, res) => shippingController.getRateCard(req, res));
router.get('/orders', (req, res) => shippingController.getOrders(req, res));
router.get('/all-tabs', (req, res) => shippingController.getAllTabsData(req, res));

// Calculation routes
router.post('/calculate-and-save', (req, res) => shippingController.calculateAndSave(req, res));
router.post('/calculate', (req, res) => shippingController.calculateAndSave(req, res));
router.post('/process-orders', (req, res) => shippingController.processOrders(req, res));
router.post('/process-single-sheet', (req, res) => shippingController.processSingleSheet(req, res));
router.post('/sync-to-sheet', (req, res) => shippingController.syncToSheet(req, res));

module.exports = router;
