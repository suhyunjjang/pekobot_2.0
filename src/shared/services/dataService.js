const binanceAPI = require('../api/binance');
const constants = require('../config/constants');

/**
 * 데이터 관리 서비스
 */
class DataService {
    constructor() {
        this.candles = [];
    }

    /**
     * 과거 캔들 데이터 초기화
     */
    async initializeHistoricalData() {
        try {
            console.log('[INFO] Loading historical candles...');
            
            const historicalCandles = await binanceAPI.fetchHistoricalCandles(
                constants.SYMBOL_FOR_TRADING,
                constants.KLINE_INTERVAL,
                constants.MAX_RECENT_CANDLES
            );
            
            this.candles = historicalCandles.map(candle => ({
                ...candle,
                isComplete: true
            }));
            
            console.log(`[INFO] Loaded ${this.candles.length} historical candles.`);
            
            return this.candles;
        } catch (error) {
            console.error(`[ERROR] Failed to initialize historical data: ${error.message}`);
            throw error;
        }
    }

    /**
     * 캔들 데이터 업데이트 (실시간 웹소켓 이벤트에서 호출)
     * @param {Object} newCandle - 새 캔들 데이터
     */
    updateCandle(newCandle) {
        // 이미 있는 캔들인지 확인 (시간으로 구분)
        const existingIndex = this.candles.findIndex(candle => candle.time === newCandle.time);
        
        if (existingIndex !== -1) {
            // 이미 있는 캔들 업데이트
            this.candles[existingIndex] = newCandle;
        } else {
            // 새 캔들 추가
            this.candles.push(newCandle);
            
            // 최대 캔들 개수 유지
            if (this.candles.length > constants.MAX_RECENT_CANDLES) {
                this.candles.shift(); // 가장 오래된 캔들 제거
            }
        }
    }

    /**
     * 최신 캔들 데이터 가져오기
     * @returns {Object|null} - 최신 캔들 또는 데이터가 없는 경우 null
     */
    getLatestCandle() {
        if (!this.candles.length) return null;
        return this.candles[this.candles.length - 1];
    }

    /**
     * 모든 캔들 데이터 가져오기
     * @returns {Array} - 캔들 데이터 배열
     */
    getCandles() {
        return this.candles;
    }
}

module.exports = new DataService(); 