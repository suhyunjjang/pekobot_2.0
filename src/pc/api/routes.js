const express = require('express');
const router = express.Router();
const dataService = require('../../shared/services/dataService');
const signalService = require('../../shared/services/signalService');

// 캔들 데이터 API
router.get('/candles', (req, res) => {
    try {
        const candles = dataService.getCandles();
        res.json({
            success: true,
            data: candles
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// 현재 포지션 정보 API
router.get('/position', (req, res) => {
    try {
        res.json({
            success: true,
            data: {
                currentPosition: signalService.currentPosition
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// 시그널 이력 API
router.get('/signals', (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 10;
        const signals = signalService.getSignals(limit);
        
        res.json({
            success: true,
            data: signals
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

module.exports = router; 