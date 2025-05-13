/**
 * 트레이딩 시그널 관리 서비스
 */
class SignalService {
    constructor() {
        this.currentPosition = 'NONE'; // 'NONE', 'LONG', 'SHORT'
        this.signals = []; // 생성된 시그널 기록
    }

    /**
     * 현재 포지션 설정
     * @param {string} position - 'NONE', 'LONG', 'SHORT'
     */
    setCurrentPosition(position) {
        if (!['NONE', 'LONG', 'SHORT'].includes(position)) {
            console.error(`[ERROR] Invalid position: ${position}`);
            return;
        }
        
        this.currentPosition = position;
        console.log(`[INFO] Position updated to: ${position}`);
    }

    /**
     * 캔들 데이터 처리 및 필요 시 시그널 생성
     * @param {Object} candle - 처리할 캔들 데이터
     * @returns {Object|null} - 생성된 시그널 또는 시그널이 없는 경우 null
     */
    processCandle(candle) {
        // 여기서는 실제 전략 로직이 들어가야 함
        // 현재는 단순히 시그널 생성 예시만 포함

        // 완료된 캔들에 대해서만 시그널 생성
        if (candle.isComplete) {
            // 예시: 간단한 시그널 생성 로직
            // const signal = this.generateSignal(candle);
            
            // if (signal) {
            //     this.signals.push({
            //         ...signal,
            //         time: candle.time,
            //         price: candle.close,
            //         timestamp: Date.now()
            //     });
            //     return signal;
            // }
        }
        
        return null;
    }

    /**
     * 시그널 생성 메서드 (실제 전략 로직 구현 필요)
     * @param {Object} candle - 분석할 캔들 데이터
     * @returns {Object|null} - 생성된 시그널 또는 시그널이 없는 경우 null
     */
    generateSignal(candle) {
        // 여기에 실제 트레이딩 로직을 구현해야 함
        // 실제 트레이딩에서는 기술적 지표 등을 활용한 복잡한 로직이 들어감
        
        // 예시로 단순한 랜덤 시그널 생성 (실제 사용에는 부적합)
        // 실제로는 심도 있는 전략 로직이 필요
        
        // 현재 이미 포지션을 가지고 있다면 시그널 생성하지 않음
        if (this.currentPosition !== 'NONE') {
            return null;
        }
        
        // 더미 로직
        return null;
        
        // 실제 구현 예시:
        // if (someCondition) {
        //     return {
        //         type: 'ENTRY',
        //         direction: 'LONG',
        //         reason: 'Bullish pattern detected'
        //     };
        // } else if (someOtherCondition) {
        //     return {
        //         type: 'ENTRY',
        //         direction: 'SHORT',
        //         reason: 'Bearish pattern detected'
        //     };
        // }
        // return null;
    }

    /**
     * 생성된 시그널 이력 가져오기
     * @param {number} limit - 가져올 시그널 수
     * @returns {Array} - 시그널 배열
     */
    getSignals(limit = 10) {
        // 최신 시그널부터 limit 개수만큼 반환
        return this.signals.slice(-limit).reverse();
    }
}

module.exports = new SignalService(); 