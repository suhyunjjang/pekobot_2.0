const binanceAPI = require('../api/binance');
const constants = require('../config/constants');

/**
 * 주문 처리 서비스
 */
class OrderService {
    constructor() {
        this.activeOrders = {
            entry: null,
            tp: null,
            sl: null
        };
    }

    /**
     * 자본금 기반 주문 수량 계산
     * @param {string} symbol - 거래 심볼
     * @returns {Promise<number>} - 계산된 주문 수량
     */
    async calculateOrderQuantity(symbol = constants.SYMBOL_FOR_TRADING) {
        try {
            // 계좌 잔액 조회
            const balance = await binanceAPI.fetchBalance();
            const usdtBalance = balance.USDT && balance.USDT.free ? balance.USDT.free : 0;
            
            if (usdtBalance <= 0) {
                throw new Error('Insufficient USDT balance to trade');
            }
            
            // 사용할 자본금 계산
            const capitalToUse = usdtBalance * constants.CAPITAL_PERCENTAGE_FOR_TRADE;
            
            // 현재 가격 조회
            const currentPrice = await binanceAPI.fetchCurrentPrice(symbol);
            
            if (!currentPrice) {
                throw new Error(`Could not fetch current price for ${symbol}`);
            }
            
            // 레버리지를 고려한 포지션 가치 계산
            const positionValueUsdt = capitalToUse * constants.LEVERAGE;
            
            // 수량 계산 (포지션 가치 / 현재 가격)
            const calculatedQuantity = positionValueUsdt / currentPrice;
            
            // 바이낸스 정밀도 규칙에 맞게 조정
            const exchange = binanceAPI.exchange;
            let orderQuantity;
            
            if (exchange.markets && exchange.markets[binanceAPI.formatSymbolToCcxt(symbol)] && 
                exchange.markets[binanceAPI.formatSymbolToCcxt(symbol)].precision && 
                exchange.markets[binanceAPI.formatSymbolToCcxt(symbol)].precision.amount) {
                orderQuantity = parseFloat(exchange.amountToPrecision(binanceAPI.formatSymbolToCcxt(symbol), calculatedQuantity));
            } else {
                console.warn(`[WARN] Could not find amount precision for ${symbol}. Using calculated quantity as is.`);
                orderQuantity = calculatedQuantity;
            }
            
            // 최소 주문 수량 확인
            const minOrderAmount = exchange.markets[binanceAPI.formatSymbolToCcxt(symbol)]?.limits?.amount?.min;
            if (minOrderAmount && orderQuantity < minOrderAmount) {
                throw new Error(`Calculated order quantity (${orderQuantity}) is less than minimum allowed (${minOrderAmount}) for ${symbol}`);
            }
            
            if (isNaN(orderQuantity) || orderQuantity <= 0) {
                throw new Error(`Invalid order quantity after calculation: ${orderQuantity}`);
            }
            
            return orderQuantity;
            
        } catch (error) {
            console.error(`[ERROR] Failed to calculate order quantity: ${error.message}`);
            throw error;
        }
    }

    /**
     * 시장가 주문 실행
     * @param {string} symbol - 거래 심볼
     * @param {string} side - 'BUY' or 'SELL'
     * @returns {Promise<Object>} - 주문 결과
     */
    async executeMarketOrder(symbol = constants.SYMBOL_FOR_TRADING, side) {
        try {
            // 레버리지 설정
            await binanceAPI.setLeverage(constants.LEVERAGE, symbol);
            
            // 주문 수량 계산
            const orderQuantity = await this.calculateOrderQuantity(symbol);
            
            // 시장가 주문 실행
            let entryOrderResult;
            if (side.toUpperCase() === 'BUY') {
                entryOrderResult = await binanceAPI.createMarketBuyOrder(symbol, orderQuantity);
            } else if (side.toUpperCase() === 'SELL') {
                entryOrderResult = await binanceAPI.createMarketSellOrder(symbol, orderQuantity);
            } else {
                throw new Error(`Unsupported side for market order: ${side}`);
            }
            
            // 성공한 주문 저장
            this.activeOrders.entry = entryOrderResult;
            
            // TP/SL 주문 생성
            await this.createTPSLOrders(symbol, side, orderQuantity, entryOrderResult);
            
            return {
                entryOrder: entryOrderResult,
                tpOrder: this.activeOrders.tp,
                slOrder: this.activeOrders.sl
            };
            
        } catch (error) {
            console.error(`[ERROR] Failed to execute market order: ${error.message}`);
            throw error;
        }
    }

    /**
     * TP/SL 주문 생성
     * @param {string} symbol - 거래 심볼
     * @param {string} side - 진입 방향 ('BUY' or 'SELL')
     * @param {number} quantity - 주문 수량
     * @param {Object} entryOrderResult - 진입 주문 결과
     * @returns {Promise<Object>} - TP/SL 주문 결과
     */
    async createTPSLOrders(symbol, side, quantity, entryOrderResult) {
        try {
            const entryPrice = entryOrderResult.average || entryOrderResult.price || null;
            
            if (!entryPrice) {
                throw new Error('Could not determine entry price for TP/SL calculation');
            }
            
            // ROI 기준 가격 변화율 계산
            const priceChangePercentForTp = constants.ROI_TP_PERCENTAGE / constants.LEVERAGE;
            const priceChangePercentForSl = constants.ROI_SL_PERCENTAGE / constants.LEVERAGE;
            
            let tpPrice, slPrice, tpSide, slSide;
            
            if (side.toUpperCase() === 'BUY') {
                // 롱 포지션
                tpPrice = entryPrice * (1 + priceChangePercentForTp);
                slPrice = entryPrice * (1 - priceChangePercentForSl);
                tpSide = 'sell'; // 롱 포지션의 TP는 매도
                slSide = 'sell'; // 롱 포지션의 SL은 매도
            } else {
                // 숏 포지션
                tpPrice = entryPrice * (1 - priceChangePercentForTp);
                slPrice = entryPrice * (1 + priceChangePercentForSl);
                tpSide = 'buy'; // 숏 포지션의 TP는 매수
                slSide = 'buy'; // 숏 포지션의 SL은 매수
            }
            
            // TP 주문 생성
            const tpOrder = await binanceAPI.createStopLimitOrder(
                symbol, 
                tpSide, 
                quantity, 
                tpPrice, 
                tpPrice
            );
            this.activeOrders.tp = tpOrder;
            
            // SL 주문 생성
            const slOrder = await binanceAPI.createStopLimitOrder(
                symbol, 
                slSide, 
                quantity, 
                slPrice, 
                slPrice
            );
            this.activeOrders.sl = slOrder;
            
            return {
                tp: tpOrder,
                sl: slOrder
            };
            
        } catch (error) {
            console.error(`[ERROR] Failed to create TP/SL orders: ${error.message}`);
            throw error;
        }
    }

    /**
     * TP/SL 값 변경
     * @param {string} symbol - 거래 심볼
     * @param {string} type - 변경할 주문 타입 ('TP' or 'SL')
     * @param {number} newPrice - 새로운 가격
     * @returns {Promise<Object>} - 변경된 주문 결과
     */
    async modifyTPSL(symbol, type, newPrice) {
        try {
            // 기존 주문 확인
            const existingOrder = type.toUpperCase() === 'TP' ? this.activeOrders.tp : this.activeOrders.sl;
            
            if (!existingOrder) {
                throw new Error(`No active ${type} order to modify`);
            }
            
            // 기존 주문 취소
            await binanceAPI.exchange.cancelOrder(existingOrder.id, binanceAPI.formatSymbolToCcxt(symbol));
            
            // 새 주문 생성에 필요한 정보 추출
            const side = existingOrder.side;
            const quantity = existingOrder.amount;
            
            // 새 주문 생성
            const newOrder = await binanceAPI.createStopLimitOrder(
                symbol, 
                side, 
                quantity, 
                newPrice, 
                newPrice
            );
            
            // 활성 주문 업데이트
            if (type.toUpperCase() === 'TP') {
                this.activeOrders.tp = newOrder;
            } else {
                this.activeOrders.sl = newOrder;
            }
            
            return newOrder;
            
        } catch (error) {
            console.error(`[ERROR] Failed to modify ${type} order: ${error.message}`);
            throw error;
        }
    }

    /**
     * 모든 활성 주문 취소
     * @param {string} symbol - 거래 심볼
     * @returns {Promise<boolean>} - 성공 여부
     */
    async cancelAllActiveOrders(symbol = constants.SYMBOL_FOR_TRADING) {
        try {
            await binanceAPI.cancelAllOrders(symbol);
            this.activeOrders = { entry: null, tp: null, sl: null };
            return true;
        } catch (error) {
            console.error(`[ERROR] Failed to cancel all active orders: ${error.message}`);
            throw error;
        }
    }
    
    /**
     * 포지션 청산
     * @param {string} symbol - 거래 심볼
     * @returns {Promise<Object>} - 청산 결과
     */
    async closePosition(symbol = constants.SYMBOL_FOR_TRADING) {
        try {
            // 모든 활성 주문 취소
            await this.cancelAllActiveOrders(symbol);
            
            // 포지션 청산
            const result = await binanceAPI.closePosition(symbol);
            
            // 상태 초기화
            this.activeOrders = { entry: null, tp: null, sl: null };
            
            return result;
        } catch (error) {
            console.error(`[ERROR] Failed to close position: ${error.message}`);
            throw error;
        }
    }
}

module.exports = new OrderService(); 