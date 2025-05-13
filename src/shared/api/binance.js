const axios = require('axios');
const ccxt = require('ccxt');
require('dotenv').config();

const { SYMBOL_FOR_TRADING, KLINE_INTERVAL, MAX_RECENT_CANDLES } = require('../config/constants');

/**
 * 바이낸스 설정 및 API 함수 모음
 */
class BinanceAPI {
    constructor() {
        this.exchange = new ccxt.binanceusdm({
            apiKey: process.env.BINANCE_FUTURES_API_KEY,
            secret: process.env.BINANCE_FUTURES_API_SECRET,
            options: {
                defaultType: 'future',
            }
        });
    }

    /**
     * 바이낸스 심볼을 CCXT 형식으로 변환
     * @param {string} binanceSymbol 
     * @returns {string}
     */
    formatSymbolToCcxt(binanceSymbol) {
        if (binanceSymbol && binanceSymbol.toUpperCase().endsWith('USDT')) {
            return `${binanceSymbol.slice(0, -4)}/USDT`;
        }
        console.warn(`[WARN] Could not format symbol for CCXT: ${binanceSymbol}, using as is.`);
        return binanceSymbol;
    }

    /**
     * 과거 캔들 데이터 조회
     * @param {string} symbol - 심볼 (기본값: SYMBOL_FOR_TRADING)
     * @param {string} interval - 캔들 주기 (기본값: KLINE_INTERVAL)
     * @param {number} limit - 조회할 캔들 개수 (기본값: MAX_RECENT_CANDLES)
     * @returns {Promise<Array>} - 캔들 데이터 배열
     */
    async fetchHistoricalCandles(symbol = SYMBOL_FOR_TRADING, interval = KLINE_INTERVAL, limit = MAX_RECENT_CANDLES) {
        try {
            const response = await axios.get('https://fapi.binance.com/fapi/v1/klines', {
                params: { 
                    symbol: symbol, 
                    interval: interval, 
                    limit: limit 
                }
            });

            return response.data.map(item => ({
                time: item[0],
                open: parseFloat(item[1]),
                high: parseFloat(item[2]),
                low: parseFloat(item[3]),
                close: parseFloat(item[4]),
                volume: parseFloat(item[5])
            }));
        } catch (error) {
            console.error(`[ERROR] Failed to fetch historical candles: ${error.message}`);
            throw error;
        }
    }

    /**
     * 레버리지 설정
     * @param {number} leverage - 설정할 레버리지 값
     * @param {string} symbol - 심볼 (기본값: SYMBOL_FOR_TRADING)
     * @returns {Promise<Object>} - 설정 결과
     */
    async setLeverage(leverage, symbol = SYMBOL_FOR_TRADING) {
        try {
            const ccxtSymbol = this.formatSymbolToCcxt(symbol);
            return await this.exchange.setLeverage(leverage, ccxtSymbol);
        } catch (error) {
            console.error(`[ERROR] Failed to set leverage: ${error.message}`);
            throw error;
        }
    }

    /**
     * 시장가 매수 주문
     * @param {string} symbol - 심볼
     * @param {number} quantity - 수량
     * @returns {Promise<Object>} - 주문 결과
     */
    async createMarketBuyOrder(symbol, quantity) {
        try {
            const ccxtSymbol = this.formatSymbolToCcxt(symbol);
            return await this.exchange.createMarketBuyOrder(ccxtSymbol, quantity);
        } catch (error) {
            console.error(`[ERROR] Failed to create market buy order: ${error.message}`);
            throw error;
        }
    }

    /**
     * 시장가 매도 주문
     * @param {string} symbol - 심볼
     * @param {number} quantity - 수량
     * @returns {Promise<Object>} - 주문 결과
     */
    async createMarketSellOrder(symbol, quantity) {
        try {
            const ccxtSymbol = this.formatSymbolToCcxt(symbol);
            return await this.exchange.createMarketSellOrder(ccxtSymbol, quantity);
        } catch (error) {
            console.error(`[ERROR] Failed to create market sell order: ${error.message}`);
            throw error;
        }
    }

    /**
     * 스탑 리밋 주문 생성 (TP/SL)
     * @param {string} symbol - 심볼
     * @param {string} side - 'buy' 또는 'sell'
     * @param {number} quantity - 수량
     * @param {number} price - 주문 가격
     * @param {number} stopPrice - 트리거 가격
     * @returns {Promise<Object>} - 주문 결과
     */
    async createStopLimitOrder(symbol, side, quantity, price, stopPrice) {
        try {
            const ccxtSymbol = this.formatSymbolToCcxt(symbol);
            return await this.exchange.createOrder(
                ccxtSymbol,
                'stop_limit',
                side,
                quantity,
                price,
                { stopPrice }
            );
        } catch (error) {
            console.error(`[ERROR] Failed to create stop limit order: ${error.message}`);
            throw error;
        }
    }

    /**
     * 계좌 잔액 조회
     * @returns {Promise<Object>} - 계좌 잔액 정보
     */
    async fetchBalance() {
        try {
            return await this.exchange.fetchBalance({ type: 'future' });
        } catch (error) {
            console.error(`[ERROR] Failed to fetch balance: ${error.message}`);
            throw error;
        }
    }

    /**
     * 현재 가격 조회
     * @param {string} symbol - 심볼 (기본값: SYMBOL_FOR_TRADING)
     * @returns {Promise<number>} - 현재 가격
     */
    async fetchCurrentPrice(symbol = SYMBOL_FOR_TRADING) {
        try {
            const ccxtSymbol = this.formatSymbolToCcxt(symbol);
            const ticker = await this.exchange.fetchTicker(ccxtSymbol);
            return ticker.last || ticker.close;
        } catch (error) {
            console.error(`[ERROR] Failed to fetch current price: ${error.message}`);
            throw error;
        }
    }
    
    /**
     * 선물 지갑 잔고 조회
     * @returns {Promise<Object>} - 선물 지갑 잔고 정보
     */
    async getWalletBalance() {
        try {
            const balanceData = await this.exchange.fetchBalance({ type: 'future' });
            
            return {
                totalWalletBalance: parseFloat(balanceData.info.totalWalletBalance) || 0,
                totalUnrealizedProfit: parseFloat(balanceData.info.totalUnrealizedProfit) || 0,
                availableBalance: parseFloat(balanceData.info.availableBalance) || 0,
                totalMarginBalance: parseFloat(balanceData.info.totalMarginBalance) || 0,
                timestamp: Date.now()
            };
        } catch (error) {
            console.error(`[ERROR] Failed to fetch wallet balance: ${error.message}`);
            throw error;
        }
    }
    
    /**
     * 모든 포지션 정보 조회
     * @returns {Promise<Array>} - 포지션 정보 배열
     */
    async getPositions() {
        try {
            await this.exchange.loadMarkets();
            const positions = await this.exchange.fetchPositions();
            
            return positions
                .filter(position => parseFloat(position.contracts) > 0)
                .map(position => ({
                    symbol: position.symbol.replace('/', ''),
                    side: position.side,
                    entryPrice: parseFloat(position.entryPrice),
                    notional: parseFloat(position.notional),
                    leverage: parseFloat(position.leverage),
                    unrealizedPnl: parseFloat(position.unrealizedPnl),
                    contracts: parseFloat(position.contracts),
                    liquidationPrice: parseFloat(position.liquidationPrice || 0),
                    marginType: position.marginType,
                    timestamp: Date.now()
                }));
        } catch (error) {
            console.error(`[ERROR] Failed to fetch positions: ${error.message}`);
            throw error;
        }
    }
    
    /**
     * 특정 심볼의 모든 활성 주문 취소
     * @param {string} symbol - 심볼
     * @returns {Promise<Object>} - 취소 결과
     */
    async cancelAllOrders(symbol = SYMBOL_FOR_TRADING) {
        try {
            const ccxtSymbol = this.formatSymbolToCcxt(symbol);
            return await this.exchange.cancelAllOrders(ccxtSymbol);
        } catch (error) {
            console.error(`[ERROR] Failed to cancel all orders: ${error.message}`);
            throw error;
        }
    }
    
    /**
     * 포지션 청산 (시장가로 반대 포지션 생성)
     * @param {string} symbol - 심볼
     * @returns {Promise<Object>} - 청산 결과
     */
    async closePosition(symbol = SYMBOL_FOR_TRADING) {
        try {
            const positions = await this.getPositions();
            const position = positions.find(p => p.symbol === symbol);
            
            if (!position || parseFloat(position.contracts) === 0) {
                console.log(`[INFO] No open position for ${symbol} to close.`);
                return { success: true, message: 'No position to close' };
            }
            
            const { side, contracts } = position;
            const closeOrderSide = side === 'long' ? 'sell' : 'buy';
            
            const ccxtSymbol = this.formatSymbolToCcxt(symbol);
            return await this.exchange.createMarketOrder(ccxtSymbol, closeOrderSide, contracts);
        } catch (error) {
            console.error(`[ERROR] Failed to close position: ${error.message}`);
            throw error;
        }
    }
}

module.exports = new BinanceAPI(); 