/**
 * 단순이동평균(SMA) 계산
 * @param {Array<{time: number, value: number}>} data - {time, value} 객체의 배열
 * @param {number} period - 기간
 * @returns {Array<{time: number, value: number}>}
 */
function calculateSMA(data, period) {
    if (!data || data.length < period) return [];
    let smaValues = [];
    for (let i = period - 1; i < data.length; i++) {
        let sum = 0;
        for (let j = 0; j < period; j++) {
            sum += data[i - j].value;
        }
        smaValues.push({ time: data[i].time, value: sum / period });
    }
    return smaValues;
}

/**
 * RSI 계산
 * @param {Array<{time: number, open: number, high: number, low: number, close: number}>} candleData - 캔들 데이터 배열
 * @param {number} period - 기간 (보통 14)
 * @returns {Array<{time: number, value: number}>}
 */
function calculateRSI(candleData, period) {
    if (!candleData || candleData.length < period + 1) return [];
    let rsiValues = [];
    let gains = 0, losses = 0;

    // 초기 평균 계산
    for (let i = 1; i <= period; i++) {
        const diff = candleData[i].close - candleData[i - 1].close;
        if (diff > 0) gains += diff;
        else losses += Math.abs(diff);
    }
    let avgGain = gains / period;
    let avgLoss = losses / period;

    if (avgLoss === 0) rsiValues.push({ time: candleData[period].time, value: 100 });
    else rsiValues.push({ time: candleData[period].time, value: 100 - (100 / (1 + avgGain / avgLoss)) });

    // 이후 RSI 계산
    for (let i = period + 1; i < candleData.length; i++) {
        const diff = candleData[i].close - candleData[i - 1].close;
        let currentGain = 0, currentLoss = 0;
        if (diff > 0) currentGain = diff;
        else currentLoss = Math.abs(diff);

        avgGain = (avgGain * (period - 1) + currentGain) / period;
        avgLoss = (avgLoss * (period - 1) + currentLoss) / period;

        if (avgLoss === 0) rsiValues.push({ time: candleData[i].time, value: 100 });
        else rsiValues.push({ time: candleData[i].time, value: 100 - (100 / (1 + avgGain / avgLoss)) });
    }
    return rsiValues;
}

/**
 * 스토캐스틱 RSI 계산
 * @param {Array<{time: number, value: number}>} rsiData - RSI 데이터 배열
 * @param {number} stochPeriod - 스토캐스틱 기간 (보통 14)
 * @param {number} kPeriod - %K 기간 (보통 3)
 * @param {number} dPeriod - %D 기간 (보통 3)
 * @returns {{kLine: Array<{time: number, value: number}>, dLine: Array<{time: number, value: number}>}}
 */
function calculateStochasticRSI(rsiData, stochPeriod, kPeriod, dPeriod) {
    if (!rsiData || rsiData.length < stochPeriod) return { kLine: [], dLine: [] };

    let stochRsiRaw = [];
    for (let i = stochPeriod - 1; i < rsiData.length; i++) {
        const currentRsiPeriod = rsiData.slice(i - stochPeriod + 1, i + 1);
        const lowestRsi = Math.min(...currentRsiPeriod.map(r => r.value));
        const highestRsi = Math.max(...currentRsiPeriod.map(r => r.value));
        let stochVal = 0;
        if (highestRsi !== lowestRsi) {
            stochVal = ((rsiData[i].value - lowestRsi) / (highestRsi - lowestRsi)) * 100;
        }
        stochRsiRaw.push({ time: rsiData[i].time, value: stochVal });
    }

    const kLine = calculateSMA(stochRsiRaw, kPeriod); // calculateSMA 사용
    const dLine = calculateSMA(kLine, dPeriod);       // calculateSMA 사용
    return { kLine, dLine };
}

/**
 * EMA 계산
 * @param {Array<{time: number, open: number, high: number, low: number, close: number}>} candleData - 캔들 데이터 배열 (종가 사용)
 * @param {number} period - 기간
 * @returns {Array<{time: number, value: number}>}
 */
function calculateEMA(candleData, period) {
    if (candleData.length < period) return [];
    const k = 2 / (period + 1);
    let emaArray = [];
    let sum = 0;
    for (let i = 0; i < period; i++) sum += candleData[i].close; // 종가 사용
    let prevEma = sum / period;
    emaArray.push({ time: candleData[period - 1].time, value: prevEma });
    for (let i = period; i < candleData.length; i++) {
        const currentEma = (candleData[i].close * k) + (prevEma * (1 - k));
        emaArray.push({ time: candleData[i].time, value: currentEma });
        prevEma = currentEma;
    }
    return emaArray;
}

/**
 * 하이킨아시 캔들 계산
 * @param {Array<{time: number, open: number, high: number, low: number, close: number}>} sourceCandleData - 원본 캔들 데이터 배열
 * @returns {Array<{time: number, open: number, high: number, low: number, close: number}>}
 */
function calculateHeikinAshi(sourceCandleData) {
    let heikinAshiCandles = [];
    if (!sourceCandleData || sourceCandleData.length === 0) {
        return heikinAshiCandles;
    }

    let prevHaOpen = null;
    let prevHaClose = null;

    for (let i = 0; i < sourceCandleData.length; i++) {
        const regularCandle = sourceCandleData[i];
        let haOpen, haClose, haHigh, haLow;

        haClose = (regularCandle.open + regularCandle.high + regularCandle.low + regularCandle.close) / 4;

        if (i === 0 || prevHaOpen === null || prevHaClose === null) {
            haOpen = (regularCandle.open + regularCandle.close) / 2;
        } else {
            haOpen = (prevHaOpen + prevHaClose) / 2;
        }
        
        haHigh = Math.max(regularCandle.high, haOpen, haClose);
        haLow = Math.min(regularCandle.low, haOpen, haClose);

        heikinAshiCandles.push({
            time: regularCandle.time,
            open: haOpen,
            high: haHigh,
            low: haLow,
            close: haClose
        });

        prevHaOpen = haOpen;
        prevHaClose = haClose;
    }
    return heikinAshiCandles;
}

// 볼린저 밴드 계산 함수
// period: 이동평균 및 표준편차 계산 기간 (기본값: 20)
// stdDevMultiplier: 표준편차 승수 (기본값: 2)
function calculateBollingerBands(candles, period = 20, stdDevMultiplier = 2) {
    if (!candles || candles.length < period) {
        return { upper: [], middle: [], lower: [] };
    }

    // 중간 밴드는 이미 있는 calculateSMA 함수를 사용하여 캔들의 종가를 기준으로 계산
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
    // middleBandValues의 각 요소에서 .value만 사용하지 않고 객체 전체를 반환해야 할 수도 있으나, 
    // server.js에서 {time, value} 형태로 사용하므로 현재 calculateSMA의 반환값 형식이 적합합니다.
    return { upper: upperBandValues, middle: middleBandValues, lower: lowerBandValues };
}

module.exports = {
    calculateSMA,
    calculateRSI,
    calculateStochasticRSI,
    calculateEMA,
    calculateHeikinAshi,
    calculateBollingerBands
}; 