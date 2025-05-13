/**
 * CCI(Commodity Channel Index) 지표 계산 함수
 * 
 * CCI = (TP - SMA(TP)) / (0.015 * MD)
 * 여기서:
 * - TP (Typical Price) = (High + Low + Close) / 3
 * - SMA(TP)는 n 기간 동안의 TP의 단순 이동 평균
 * - MD는 TP와 SMA(TP) 사이의 평균 편차
 * - 0.015는 상수 (전통적인 CCI 계산에서 사용)
 */

/**
 * CCI 계산 함수
 * @param {Array} candles - 캔들 데이터 배열 [{high, low, close}, ...]
 * @param {number} period - 기간 (일반적으로 20)
 * @returns {Array} - CCI 값 배열
 */
function calculateCCI(candles, period = 20) {
    if (!candles || candles.length < period) {
        return [];
    }

    const result = [];
    
    // 시작 인덱스를 계산하기 위해 period-1부터 시작
    for (let i = period - 1; i < candles.length; i++) {
        // period 기간 동안의 캔들 데이터 가져오기
        const periodCandles = candles.slice(i - period + 1, i + 1);
        
        // 기간 동안의 Typical Price 계산 (high + low + close) / 3
        const typicalPrices = periodCandles.map(candle => 
            (candle.high + candle.low + candle.close) / 3
        );
        
        // TP의 SMA 계산
        const tpSum = typicalPrices.reduce((sum, tp) => sum + tp, 0);
        const tpSMA = tpSum / period;
        
        // Mean Deviation 계산
        const meanDeviation = typicalPrices.reduce((sum, tp) => sum + Math.abs(tp - tpSMA), 0) / period;
        
        // 현재 캔들의 Typical Price
        const currentTP = (periodCandles[period - 1].high + periodCandles[period - 1].low + periodCandles[period - 1].close) / 3;
        
        // CCI 계산
        const cci = meanDeviation === 0 ? 0 : (currentTP - tpSMA) / (0.015 * meanDeviation);
        
        result.push({
            time: candles[i].time,
            value: cci
        });
    }
    
    return result;
}

module.exports = calculateCCI; 