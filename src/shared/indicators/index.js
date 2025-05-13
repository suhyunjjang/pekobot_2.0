/**
 * 모든 기술적 지표 함수들을 통합하여 내보내는 파일입니다.
 */

const calculateSMA = require('./sma');
const calculateBollingerBands = require('./bollingerBands');
const calculateCCI = require('./cci');

module.exports = {
    calculateSMA,
    calculateBollingerBands,
    calculateCCI
}; 