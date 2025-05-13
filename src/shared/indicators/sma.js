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

module.exports = calculateSMA; 