/**
 * 애플리케이션 공통 상수
 */

// 트레이딩 설정
const SYMBOL_FOR_TRADING = 'BTCUSDT'; // 거래할 심볼
const KLINE_INTERVAL = '1m';          // 캔들 간격 (1m, 5m, 15m, 1h 등)
const MAX_RECENT_CANDLES = 100;       // 최근 캔들 데이터 수

// 자본 및 위험 관리
const CAPITAL_PERCENTAGE_FOR_TRADE = 0.1; // 전체 자본의 10%만 사용
const LEVERAGE = 5;                       // 레버리지 (5배)
const ROI_TP_PERCENTAGE = 0.03;           // 이익실현 목표 (3%)
const ROI_SL_PERCENTAGE = 0.015;          // 손절 목표 (1.5%)

// 서버 설정
const DEFAULT_PORT = 3000;               // 기본 서버 포트
const ORDER_EXECUTOR_PORT = 5000;        // 주문실행기 서버 포트
const ORDER_EXECUTOR_URL = process.env.ORDER_EXECUTOR_URL || 'ws://localhost:5000'; // 주문실행기 URL

// 네트워크 타임아웃 설정
const PING_TO_EXECUTOR_INTERVAL = 15000;        // 15초마다 핑
const PONG_FROM_EXECUTOR_TIMEOUT = 10000;       // 10초 내에 퐁 응답 없으면 타임아웃
const CLIENT_ACTIVITY_TIMEOUT = 60000;          // 60초 내에 활동 없으면 클라이언트 연결 끊음

module.exports = {
    SYMBOL_FOR_TRADING,
    KLINE_INTERVAL,
    MAX_RECENT_CANDLES,
    CAPITAL_PERCENTAGE_FOR_TRADE,
    LEVERAGE,
    ROI_TP_PERCENTAGE,
    ROI_SL_PERCENTAGE,
    DEFAULT_PORT,
    ORDER_EXECUTOR_PORT,
    ORDER_EXECUTOR_URL,
    PING_TO_EXECUTOR_INTERVAL,
    PONG_FROM_EXECUTOR_TIMEOUT,
    CLIENT_ACTIVITY_TIMEOUT
}; 