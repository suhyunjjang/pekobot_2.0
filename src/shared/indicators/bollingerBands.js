const calculateSMA = require('./sma');

/**
 * 볼린저 밴드 계산
 * @param {Array<{time: number, open: number, high: number, low: number, close: number}>} candles - 캔들 데이터 배열
 * @param {number} period - 이동평균 및 표준편차 계산 기간 (기본값: 20)
 * @param {number} stdDevMultiplier - 표준편차 승수 (기본값: 2)
 * @returns {{upper: Array<{time: number, value: number}>, middle: Array<{time: number, value: number}>, lower: Array<{time: number, value: number}>}}
 */
function calculateBollingerBands(candles, period = 20, stdDevMultiplier = 2) {
    if (!candles || candles.length < period) {
        return { upper: [], middle: [], lower: [] };
    }

    // 중간 밴드는 SMA 함수를 사용하여 캔들의 종가를 기준으로 계산
    const middleBandData = candles.map(c => ({ time: c.time, value: c.close }));
    const middleBandValues = calculateSMA(middleBandData, period); 
    
    const closes = candles.map(c => c.close);
    const upperBandValues = [];
    const lowerBandValues = [];

    let smaIdx = 0;
    for (let i = 0; i < candles.length; i++) {
        if (i >= period - 1 && middleBandValues[smaIdx] && candles[i].time === middleBandValues[smaIdx].time) {
            const mean = middleBandValues[smaIdx].value;
            
            const sliceForStdDev = closes.slice(i - period + 1, i + 1);
            let stdDev = 0;
            if (sliceForStdDev.length === period) {
                const variance = sliceForStdDev.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / period;
                stdDev = Math.sqrt(variance);
            }
            
            upperBandValues.push({ time: candles[i].time, value: mean + (stdDev * stdDevMultiplier) });
            lowerBandValues.push({ time: candles[i].time, value: mean - (stdDev * stdDevMultiplier) });
            smaIdx++;
        } else if (i >= period - 1 && middleBandValues[smaIdx] && candles[i].time > middleBandValues[smaIdx].time) {
             while(middleBandValues[smaIdx] && candles[i].time > middleBandValues[smaIdx].time) {
                smaIdx++;
             }
            if (middleBandValues[smaIdx] && candles[i].time === middleBandValues[smaIdx].time) {
                 const mean = middleBandValues[smaIdx].value;
                const sliceForStdDev = closes.slice(i - period + 1, i + 1);
                let stdDev = 0;
                if (sliceForStdDev.length === period) {
                    const variance = sliceForStdDev.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / period;
                    stdDev = Math.sqrt(variance);
                }
                upperBandValues.push({ time: candles[i].time, value: mean + (stdDev * stdDevMultiplier) });
                lowerBandValues.push({ time: candles[i].time, value: mean - (stdDev * stdDevMultiplier) });
                smaIdx++;
            }
        }
    }
    return { upper: upperBandValues, middle: middleBandValues, lower: lowerBandValues };
}

module.exports = calculateBollingerBands; 