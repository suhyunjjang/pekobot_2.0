const express = require('express');
const http = require('http');
const path = require('path');
const socketIoClient = require('socket.io-client'); // socket.io 대신 socket.io-client
const axios = require('axios');
const indicators = require('./utils/indicatorCalculator'); // 계산 모듈 가져오기
const crypto = require('crypto');
require('dotenv').config();

// --- 설정 ---
const ORDER_EXECUTOR_URL = 'http://158.247.227.13:5000'; // order-executor.js의 고정 IP 및 포트
const PORT = process.env.PORT || 3000; // 이 서버(server.js)가 리슨할 포트 (웹 UI용 또는 다른 API용)

const PING_TO_EXECUTOR_INTERVAL = 15000; // 주문 실행기로 Ping 보내는 주기
const PONG_FROM_EXECUTOR_TIMEOUT = 10000; // 주문 실행기로부터 Pong 응답 대기 시간
// --- 설정 끝 ---

const app = express();
const server = http.createServer(app);
// const io = socketIo(server, ...); // 기존 UI용 Socket.IO 서버는 유지하거나, 아래 executorSocket과 별개로 관리
// UI용 Socket.IO 서버가 필요하다면 아래와 같이 초기화합니다.
const { Server: SocketIOServer } = require('socket.io');
const uiIo = new SocketIOServer(server, { // 변수명 변경 uiIo
    cors: {
        origin: "*", 
        methods: ["GET", "POST"]
    }
});

let executorSocket = null; 
let isConnectedToExecutor = false;
let lastPongFromExecutor = Date.now();
let pingToExecutorIntervalId = null;

// 정적 파일 제공 (public 폴더 - 기존 UI용)
app.use(express.static(path.join(__dirname, 'public')));

console.log(`[INFO] server.js (매매 전략 서버) process.env.PORT: ${process.env.PORT}, effective PORT: ${PORT}`);

function updateExecutorConnectionStatusForUI() {
    if (uiIo) { // uiIo가 초기화되었는지 확인
        uiIo.emit('executor_connection_status', isConnectedToExecutor);
        console.log(`[UI_EMIT] Sent executor_connection_status: ${isConnectedToExecutor}`);
    }
}

function connectToOrderExecutor() {
    if (executorSocket && executorSocket.connected) {
        console.log('[INFO] Already connected to Order Executor.');
        return;
    }
    if (executorSocket) {
        executorSocket.disconnect(); // 이전 소켓 정리
        executorSocket.removeAllListeners(); // 이벤트 리스너도 정리
    }

    console.log(`[INFO] Attempting to connect to Order Executor at ${ORDER_EXECUTOR_URL}`);
    executorSocket = socketIoClient(ORDER_EXECUTOR_URL, {
        reconnectionAttempts: Infinity, // 계속 재연결 시도
        timeout: 20000, 
        // transports: ['websocket'], // 필요시
    });

    executorSocket.on('connect', () => {
        isConnectedToExecutor = true;
        lastPongFromExecutor = Date.now();
        console.log(`[INFO] Connected to Order Executor: ${executorSocket.id}`);
        startPingToExecutor();
        updateExecutorConnectionStatusForUI(); // 상태 변경 시 UI 업데이트
    });

    executorSocket.on('disconnect', (reason) => {
        isConnectedToExecutor = false;
        console.warn(`[WARN] Disconnected from Order Executor: ${reason}`);
        stopPingToExecutor();
        updateExecutorConnectionStatusForUI(); // 상태 변경 시 UI 업데이트
        // 재연결은 클라이언트 라이브러리가 자동으로 시도 (reconnectionAttempts: Infinity)
        // 필요시, 여기서 추가적인 로직 (예: 특정 시간 후 강제 재시도)을 넣을 수 있으나, 보통은 자동 재연결에 맡김.
    });

    executorSocket.on('connect_error', (error) => {
        isConnectedToExecutor = false; // 명시적으로 false
        console.error(`[ERROR] Failed to connect to Order Executor: ${error.message}`);
        stopPingToExecutor();
        updateExecutorConnectionStatusForUI(); // 상태 변경 시 UI 업데이트
    });
    
    executorSocket.on('pong_to_client', (data) => { 
        lastPongFromExecutor = Date.now();
        // console.log('[DEBUG] Pong received from order-executor (server).', data);
    });

    executorSocket.on('order_execution_log', (logData) => { 
        console.log('[EXECUTOR LOG]', logData.message, logData.details || '');
        uiIo.emit('server-log', { 
            type: logData.type || 'info',
            source: 'OrderExecutor', 
            message: logData.message, 
            details: logData.details 
        });
        if (executorSocket && logData.message) { 
            executorSocket.emit('order_execution_log_ack', { receivedMessage: logData.message });
        }
    });
    
    executorSocket.on('reconnect_attempt', (attemptNumber) => {
        console.log(`[INFO] Attempting to reconnect to Order Executor... (Attempt: ${attemptNumber})`);
        stopPingToExecutor();
        // 재연결 시도 중에는 isConnectedToExecutor가 false일 수 있으므로, UI 업데이트는 reconnect 성공/실패 시에만.
    });
    executorSocket.on('reconnect', (attemptNumber) => {
        isConnectedToExecutor = true;
        lastPongFromExecutor = Date.now();
        console.log(`[INFO] Reconnected to Order Executor after ${attemptNumber} attempts.`);
        startPingToExecutor();
        updateExecutorConnectionStatusForUI(); // 상태 변경 시 UI 업데이트
    });
    executorSocket.on('reconnect_error', (error) => {
        // isConnectedToExecutor는 이미 false이거나 connect_error에서 false로 설정됨
        console.error(`[ERROR] Failed to reconnect to Order Executor: ${error.message}`);
        stopPingToExecutor();
        updateExecutorConnectionStatusForUI(); // 상태 변경 시 UI 업데이트
    });
    executorSocket.on('reconnect_failed', () => {
        isConnectedToExecutor = false;
        console.error('[ERROR] All reconnection attempts to Order Executor failed. Will keep trying due to reconnectionAttempts:Infinity.');
        stopPingToExecutor();
        updateExecutorConnectionStatusForUI(); // 상태 변경 시 UI 업데이트
    });
}

function startPingToExecutor() {
    if (pingToExecutorIntervalId) clearInterval(pingToExecutorIntervalId);
    pingToExecutorIntervalId = setInterval(() => {
        if (isConnectedToExecutor && executorSocket) {
            if (Date.now() - lastPongFromExecutor > PING_TO_EXECUTOR_INTERVAL + PONG_FROM_EXECUTOR_TIMEOUT) {
                console.warn('[WARN] No pong from Order Executor for too long. Disconnecting to trigger reconnect.');
                executorSocket.disconnect(); // 재연결 유도
            } else {
                executorSocket.emit('ping_from_client', { timestamp: Date.now(), source: 'server.js' });
            }
        }
    }, PING_TO_EXECUTOR_INTERVAL);
    console.log('[INFO] Ping interval to Order Executor started.');
}

function stopPingToExecutor() {
    if (pingToExecutorIntervalId) {
        clearInterval(pingToExecutorIntervalId);
        pingToExecutorIntervalId = null;
        console.log('[INFO] Ping interval to Order Executor stopped.');
    }
}

// --- 인메모리 캔들 데이터 및 지표 계산 설정 ---
let recentCandles = []; // 서버 메모리에 최근 캔들 데이터를 저장할 배열
const MAX_RECENT_CANDLES = 1000; // EMA200 등을 고려한 충분한 수 (API limit과 맞추거나 더 크게)
const RSI_PERIOD = 14;
const STOCH_PERIOD = 14;
const K_PERIOD = 3;
const D_PERIOD = 3;
const EMA_PERIOD = 200;
let currentPosition = 'NONE'; // 현재 포지션 상태 (NONE, LONG, SHORT)

// 과거 캔들 데이터 API 엔드포인트
app.get('/api/historical-klines', async (req, res) => {
  const logMessageStart = 'Request received for /api/historical-klines';
  console.log(logMessageStart);
  uiIo.emit('server-log', { type: 'info', source: '/api/historical-klines', message: logMessageStart });

  try {
    const symbol = 'BTCUSDT';
    const interval = '4h';
    const limit = MAX_RECENT_CANDLES;

    const logFetch = `Fetching historical klines: ${symbol}, ${interval}, limit ${limit}`;
    console.log(logFetch);
    uiIo.emit('server-log', { type: 'info', source: '/api/historical-klines', message: logFetch });

    const response = await axios.get('https://fapi.binance.com/fapi/v1/klines', {
      params: { symbol: symbol, interval: interval, limit: limit }
    });

    // 바이낸스 API 응답 형식:
    // [
    //   [
    //     1499040000000,      // Open time
    //     "0.01634790",       // Open
    //     "0.80000000",       // High
    //     "0.01575800",       // Low
    //     "0.01577100",       // Close
    //     "148976.11427815",  // Volume
    //     1499644799999,      // Close time
    //     "2434.19055334",    // Quote asset volume
    //     308,                // Number of trades
    //     "1756.87402397",    // Taker buy base asset volume
    //     "28.46694368",      // Taker buy quote asset volume
    //     "17928899.62484339" // Ignore.
    //   ]
    // ]
    // 필요한 데이터 형식으로 변환
    const clientFormatKlines = response.data.map(k => ({
      time: k[0] / 1000, // 초 단위 Unix 타임스탬프
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
      symbol: symbol
    }));

    // 서버 메모리의 recentCandles도 이 데이터로 초기화 (선택적, 여기서는 API 호출 시마다 최신으로 덮어쓰기)
    recentCandles = [...clientFormatKlines]; 

    // 모든 지표 계산
    const heikinAshiCandles = indicators.calculateHeikinAshi(clientFormatKlines);

    const regularEMA = indicators.calculateEMA(clientFormatKlines, EMA_PERIOD);
    const heikinAshiEMA = indicators.calculateEMA(heikinAshiCandles, EMA_PERIOD);

    const regularRSI = indicators.calculateRSI(clientFormatKlines, RSI_PERIOD);
    const regularStochRSI = indicators.calculateStochasticRSI(regularRSI, STOCH_PERIOD, K_PERIOD, D_PERIOD);

    const heikinAshiRSI = indicators.calculateRSI(heikinAshiCandles, RSI_PERIOD);
    const heikinAshiStochRSI = indicators.calculateStochasticRSI(heikinAshiRSI, STOCH_PERIOD, K_PERIOD, D_PERIOD);
    
    const responseData = {
      regularCandles: clientFormatKlines,
      regularEMA200: regularEMA, // 이름 일관성 유지 (클라이언트에서 ema200Series로 사용중)
      regularStochRSI: regularStochRSI,
      heikinAshiCandles: heikinAshiCandles,
      heikinAshiEMA200: heikinAshiEMA, // 이름 일관성 유지
      heikinAshiStochRSI: heikinAshiStochRSI
    };

    const logSuccess = `Successfully fetched and processed ${clientFormatKlines.length} historical klines.`;
    console.log(logSuccess);
    uiIo.emit('server-log', { type: 'success', source: '/api/historical-klines', message: logSuccess, details: { count: clientFormatKlines.length } });

    res.json(responseData);
  } catch (error) {
    const errorMessage = error.response ? JSON.stringify(error.response.data) : error.message;
    const logError = `Error in /api/historical-klines: ${errorMessage}`;
    console.error(logError);
    uiIo.emit('server-log', { type: 'error', source: '/api/historical-klines', message: logError, details: { errorData: errorMessage } });
    res.status(500).json({ message: '과거 캔들 데이터를 가져오는 데 실패했습니다.' });
  }
});

// --- 선물 지갑 잔고 API 엔드포인트 추가 ---
app.get('/api/futures-balance', async (req, res) => {
    const logMessageStart = 'Request received for /api/futures-balance';
    console.log(logMessageStart);
    uiIo.emit('server-log', { type: 'info', source: '/api/futures-balance', message: logMessageStart });

    const apiKey = process.env.BINANCE_API_KEY;
    const apiSecret = process.env.BINANCE_API_SECRET;

    if (!apiKey || !apiSecret) {
        console.error('API Key or Secret not configured in .env file');
        return res.status(500).json({ message: 'API Key or Secret not configured.' });
    }

    const timestamp = Date.now();
    const queryString = `timestamp=${timestamp}`;
    const signature = crypto.createHmac('sha256', apiSecret).update(queryString).digest('hex');

    try {
        const logFetch = 'Fetching Binance Futures balance via /api/futures-balance (direct axios call)...';
        console.log(logFetch);
        uiIo.emit('server-log', { type: 'info', source: '/api/futures-balance', message: logFetch });

        const response = await axios.get('https://fapi.binance.com/fapi/v2/balance', { // v2 잔고 엔드포인트
            headers: { 'X-MBX-APIKEY': apiKey },
            params: {
                timestamp: timestamp,
                signature: signature
            }
        });

        const balances = response.data;
        if (!balances || balances.length === 0) {
            console.warn('No futures balance data received from Binance or balance is empty.');
            return res.status(404).json({ error: 'Failed to fetch futures balance or balance is empty.' });
        }

        const usdtAsset = balances.find(asset => asset.asset === 'USDT');
        const usdtAvailableBalance = usdtAsset ? parseFloat(usdtAsset.availableBalance) : 0;

        let totalWalletBalanceInUsdt = 0;
        totalWalletBalanceInUsdt = usdtAsset ? parseFloat(usdtAsset.crossWalletBalance) : usdtAvailableBalance;
        
        const logSuccess = `Successfully fetched futures balance (direct): USDT: ${usdtAvailableBalance.toFixed(2)}, Total: ${totalWalletBalanceInUsdt.toFixed(2)}`;
        console.log(logSuccess);
        uiIo.emit('server-log', { type: 'success', source: '/api/futures-balance', message: logSuccess, details: { usdtBalance: usdtAvailableBalance, totalWalletBalanceUsdt: totalWalletBalanceInUsdt } });

        res.json({
            usdtBalance: usdtAvailableBalance.toFixed(2),
            totalWalletBalanceUsdt: totalWalletBalanceInUsdt.toFixed(2)
        });

    } catch (error) {
        const errorMessage = error.response ? JSON.stringify(error.response.data) : error.message;
        const logError = `Error in /api/futures-balance endpoint (direct): ${errorMessage}`;
        console.error(logError);
        uiIo.emit('server-log', { type: 'error', source: '/api/futures-balance', message: logError, details: { errorData: errorMessage } });
        res.status(error.response ? error.response.status : 500).json({
            message: 'Failed to fetch futures balance from server (direct)',
            details: errorMessage
        });
    }
});

// --- 사용자의 특정 심볼 거래 내역 API 엔드포인트 추가 ---
app.get('/api/trade-history', async (req, res) => {
    const symbol = req.query.symbol || 'BTCUSDT';
    const limit = parseInt(req.query.limit) || 50;
    const logMessageStart = `Request received for /api/trade-history (Symbol: ${symbol}, Limit: ${limit})`;
    console.log(logMessageStart);
    uiIo.emit('server-log', { type: 'info', source: '/api/trade-history', message: logMessageStart, details: { symbol, limit } });

    const apiKey = process.env.BINANCE_API_KEY;
    const apiSecret = process.env.BINANCE_API_SECRET;

    if (!apiKey || !apiSecret) {
        console.error('API Key or Secret not configured in .env file for trade history');
        return res.status(500).json({ message: 'API Key or Secret not configured.' });
    }

    const timestamp = Date.now();
    const queryString = `symbol=${symbol}&limit=${limit}&timestamp=${timestamp}`;
    const signature = crypto.createHmac('sha256', apiSecret).update(queryString).digest('hex');

    try {
        const logFetch = `Fetching trade history for ${symbol} via /api/trade-history...`;
        console.log(logFetch);
        uiIo.emit('server-log', { type: 'info', source: '/api/trade-history', message: logFetch });

        const response = await axios.get('https://fapi.binance.com/fapi/v1/userTrades', {
            headers: { 'X-MBX-APIKEY': apiKey },
            params: { symbol, limit, timestamp, signature }
        });

        const tradesRaw = response.data;

        const tradesFormatted = tradesRaw
            .sort((a, b) => b.time - a.time) 
            .map(trade => {
                const isBTC = trade.symbol.includes('BTC');
                const pnl = parseFloat(trade.realizedPnl);
                const commissionNum = parseFloat(trade.commission);

                return {
                    time: new Date(trade.time).toLocaleString('ko-KR', { hour12: false }),
                    symbol: trade.symbol,
                    side: trade.side,
                    price: parseFloat(trade.price).toFixed(isBTC && !trade.symbol.startsWith('WBTC') ? 2 : 4),
                    quantity: parseFloat(trade.qty).toFixed(isBTC && !trade.symbol.startsWith('WBTC') ? 4 : 2),
                    quoteQty: parseFloat(trade.quoteQty).toFixed(2),
                    commission: `${commissionNum.toFixed(8)} ${trade.commissionAsset}`,
                    realizedPnl: pnl.toFixed(2),
                    isProfit: pnl > 0, 
                    orderId: trade.orderId
                };
            });
        
        const logSuccess = `Successfully fetched and formatted ${tradesFormatted.length} trades for ${symbol}.`;
        console.log(logSuccess);
        uiIo.emit('server-log', { type: 'success', source: '/api/trade-history', message: logSuccess, details: { count: tradesFormatted.length, symbol } });
        res.json(tradesFormatted);

    } catch (error) {
        const errorMessage = error.response ? JSON.stringify(error.response.data) : error.message;
        const logError = `Error in /api/trade-history endpoint for ${symbol}: ${errorMessage}`;
        console.error(logError);
        uiIo.emit('server-log', { type: 'error', source: '/api/trade-history', message: logError, details: { errorData: errorMessage, symbol } });
        res.status(error.response ? error.response.status : 500).json({
            message: `Failed to fetch trade history for ${symbol}`,
            details: errorMessage
        });
    }
});

// 바이낸스 웹소켓 연결 (비트코인 선물)
const WebSocket = require('ws');
const binanceWs = new WebSocket('wss://fstream.binance.com/ws/btcusdt@kline_4h');

// 클라이언트 연결시 이벤트
uiIo.on('connection', (socket) => { // 웹 UI 클라이언트용 연결
  const logConnect = `Web UI Client connected: ${socket.id}`;
  console.log(logConnect);
  uiIo.emit('server-log', { type: 'info', source: 'socket.io-ui', message: logConnect, details: { clientId: socket.id } });
  
  // 새로운 UI 클라이언트 연결 시 현재 주문 실행기 연결 상태 즉시 전송
  socket.emit('executor_connection_status', isConnectedToExecutor);
  console.log(`[UI_EMIT] Sent initial executor_connection_status: ${isConnectedToExecutor} to client ${socket.id}`);

  socket.on('disconnect', () => {
    console.log(`Web UI Client disconnected: ${socket.id}`);
    uiIo.emit('server-log', { type: 'info', source: 'socket.io-ui', message: `Web UI Client disconnected: ${socket.id}` });
  });

  // Ping 요청 처리
  socket.on('ping_from_client', (data) => {
    // console.log(`[INFO] Ping received from client ${socket.id} with data:`, data);
    socket.emit('pong_from_server', { 
      serverTimestamp: Date.now(),
      clientData: data // 클라이언트가 보낸 데이터를 그대로 다시 보내줄 수 있음
    });
  });

  // 여기에 다른 socket.on 이벤트 핸들러들이 올 수 있습니다.
  // 예: socket.on('order_executed', (orderData) => { ... });
});

// 모든 클라이언트에게 전체 계산된 차트 데이터를 전송하는 함수
function processAndEmitFullChartData() {
    if (recentCandles.length < 2) { // 최소 2개 캔들이 있어야 이전 값 비교 가능
        // 초기 데이터가 부족할 경우, 기본 차트 데이터만 전송하거나 빈 신호 전송
        const initialData = {
            regularCandles: [...recentCandles],
            // ... (다른 지표들도 최소한으로 계산하거나 빈 값으로 채움) ...
            heikinAshiCandles: indicators.calculateHeikinAshi([...recentCandles]),
            regularEMA200: indicators.calculateEMA([...recentCandles], EMA_PERIOD),
            heikinAshiEMA200: indicators.calculateEMA(indicators.calculateHeikinAshi([...recentCandles]), EMA_PERIOD),
            // StochRSI 등도 필요에 따라 최소 계산 또는 빈 값
            regularStochRSI: { kLine: [], dLine: [] }, 
            heikinAshiStochRSI: { kLine: [], dLine: [] },
            strategySignal: { signal: 'DATA_INSUFFICIENT', conditions: {}, timestamp: 0, position: currentPosition }
        };
        uiIo.emit('full_chart_update', initialData);
        return;
    }

    const currentCandles = [...recentCandles]; // 현재 캔들 데이터 복사

    // 지표 계산 (이전과 동일)
    const heikinAshiCandles = indicators.calculateHeikinAshi(currentCandles);
    const regularEMA = indicators.calculateEMA(currentCandles, EMA_PERIOD);
    const heikinAshiEMA = indicators.calculateEMA(heikinAshiCandles, EMA_PERIOD);
    const regularRSI = indicators.calculateRSI(currentCandles, RSI_PERIOD);
    const regularStochRSI = indicators.calculateStochasticRSI(regularRSI, STOCH_PERIOD, K_PERIOD, D_PERIOD);
    const heikinAshiRSI = indicators.calculateRSI(heikinAshiCandles, RSI_PERIOD);
    const heikinAshiStochRSI = indicators.calculateStochasticRSI(heikinAshiRSI, STOCH_PERIOD, K_PERIOD, D_PERIOD);

    // --- 매매 전략 평가 --- (하이킨아시 차트 기준)
    let strategySignal = { signal: 'NO_SIGNAL', conditions: {}, timestamp: 0, position: currentPosition };
    const latestHaCandle = heikinAshiCandles[heikinAshiCandles.length - 1];
    const latestOriginalCandle = currentCandles.length > 0 ? currentCandles[currentCandles.length - 1] : {}; // 원본 캔들에서 심볼 가져오기 위함
    const latestHaEMA = heikinAshiEMA.length > 0 ? heikinAshiEMA[heikinAshiEMA.length - 1] : null;
    const latestHaStochKLine = heikinAshiStochRSI.kLine;

    if (latestHaCandle && latestHaEMA && latestHaStochKLine.length >= 2) {
        const currentHaStochK = latestHaStochKLine[latestHaStochKLine.length - 1].value;
        const prevHaStochK = latestHaStochKLine[latestHaStochKLine.length - 2].value;
        strategySignal.timestamp = latestHaCandle.time;

        // 조건 평가
        const directionConditionLong = latestHaCandle.close > latestHaCandle.open;
        const oscillatorConditionLong = prevHaStochK <= 20 && currentHaStochK > 20;

        const directionConditionShort = latestHaCandle.close < latestHaCandle.open;
        const oscillatorConditionShort = prevHaStochK >= 80 && currentHaStochK < 80;

        if (currentPosition === 'NONE') { // 현재 포지션이 없을 때만 진입 신호 확인
            if (directionConditionLong && oscillatorConditionLong) {
                strategySignal.signal = 'LONG_ENTRY';
                const signalTime = new Date(latestHaCandle.time * 1000).toLocaleString('ko-KR');
                const currentSymbol = latestOriginalCandle.symbol || 'BTCUSDT'; // recentCandles에서 전달된 심볼 사용
                console.log(`[SIGNAL] LONG_ENTRY 신호 발생: Time=${signalTime}, Symbol=${currentSymbol}`);
                
                const tradeSignalData = {
                    symbol: currentSymbol,
                    side: 'BUY',
                    type: 'MARKET', // 또는 'LIMIT', 주문 유형
                    // quantity: '0.001', // 예시: 주문 수량 (별도 로직으로 계산 필요)
                    price: latestHaCandle.close, // 참고용 현재 HA 종가 (실제 주문은 시장가 또는 다른 가격 사용 가능)
                    originalPrice: latestOriginalCandle.close, // 참고용 원본 캔들 종가
                    timestamp: latestHaCandle.time,
                    signalType: strategySignal.signal
                };

                if (isConnectedToExecutor && executorSocket) {
                    console.log(`[INFO] Sending trade_signal to Order Executor:`, tradeSignalData);
                    executorSocket.emit('trade_signal', tradeSignalData);
                    uiIo.emit('server-log', {type: 'success', source: 'StrategyLogic', message: `BUY Signal Sent to Executor`, details: tradeSignalData});
                } else {
                    console.warn('[WARN] Cannot send trade_signal: Not connected to Order Executor.');
                    uiIo.emit('server-log', {type: 'warning', source: 'StrategyLogic', message: `Cannot send BUY signal: Executor not connected.`, details: tradeSignalData});
                }

            } else if (directionConditionShort && oscillatorConditionShort) {
                strategySignal.signal = 'SHORT_ENTRY';
                const signalTime = new Date(latestHaCandle.time * 1000).toLocaleString('ko-KR');
                const currentSymbol = latestOriginalCandle.symbol || 'BTCUSDT'; // recentCandles에서 전달된 심볼 사용
                console.log(`[SIGNAL] SHORT_ENTRY 신호 발생: Time=${signalTime}, Symbol=${currentSymbol}`);
                
                const tradeSignalData = {
                    symbol: currentSymbol,
                    side: 'SELL',
                    type: 'MARKET',
                    // quantity: '0.001', 
                    price: latestHaCandle.close, // 참고용 현재 HA 종가
                    originalPrice: latestOriginalCandle.close, // 참고용 원본 캔들 종가
                    timestamp: latestHaCandle.time,
                    signalType: strategySignal.signal
                };

                if (isConnectedToExecutor && executorSocket) {
                    console.log(`[INFO] Sending trade_signal to Order Executor:`, tradeSignalData);
                    executorSocket.emit('trade_signal', tradeSignalData);
                    uiIo.emit('server-log', {type: 'success', source: 'StrategyLogic', message: `SELL Signal Sent to Executor`, details: tradeSignalData});
                } else {
                    console.warn('[WARN] Cannot send trade_signal: Not connected to Order Executor.');
                    uiIo.emit('server-log', {type: 'warning', source: 'StrategyLogic', message: `Cannot send SELL signal: Executor not connected.`, details: tradeSignalData});
                }
            }
        }
        // (참고) 포지션 청산 및 상태 변경 로직은 여기에 추가될 수 있음
        // 예: if (currentPosition === 'LONG' && 반대신호_또는_청산조건) { currentPosition = 'NONE'; strategySignal.signal = 'LONG_EXIT'; }

        strategySignal.conditions = {
            long: { direction: directionConditionLong, oscillator: oscillatorConditionLong },
            short: { direction: directionConditionShort, oscillator: oscillatorConditionShort }
        };
    }
    // --- 매매 전략 평가 끝 ---

    const allCalculatedData = {
        regularCandles: currentCandles,
        regularEMA200: regularEMA,
        regularStochRSI: regularStochRSI,
        heikinAshiCandles: heikinAshiCandles,
        heikinAshiEMA200: heikinAshiEMA,
        heikinAshiStochRSI: heikinAshiStochRSI,
        strategySignal: strategySignal // 전략 신호 객체 추가
    };
    const logEmit = `Emitting 'full_chart_update' with ${currentCandles.length} regular candles and ${heikinAshiCandles.length} HA candles.`;
    // console.log(logEmit); // 이 로그는 너무 빈번할 수 있으므로 주석 처리 또는 조건부로 emit
    // io.emit('server-log', { type: 'debug', source: 'processAndEmitFullChartData', message: logEmit, details: { regularCount: currentCandles.length, haCount: heikinAshiCandles.length } });

    uiIo.emit('full_chart_update', allCalculatedData);
}

// 바이낸스 웹소켓 메시지 처리
binanceWs.on('message', (data) => {
  try {
    const parsedData = JSON.parse(data);
    if (parsedData.k) {
      const kline = parsedData.k;
      const logWsReceive = `Received kline update from WebSocket for ${kline.s} at ${new Date(kline.t).toLocaleTimeString()}`;
      // console.log(logWsReceive); // 이 로그는 너무 빈번할 수 있으므로 주석 처리 또는 조건부로 emit
      // io.emit('server-log', { type: 'debug', source: 'WebSocket', message: logWsReceive, details: { symbol: kline.s, time: kline.t} });
      
      const newCandle = {
        time: kline.t / 1000,
        open: parseFloat(kline.o),
        high: parseFloat(kline.h),
        low: parseFloat(kline.l),
        close: parseFloat(kline.c),
        volume: parseFloat(kline.v),
        symbol: kline.s // 심볼 정보 추가
      };

      // recentCandles 배열 업데이트
      const existingCandleIndex = recentCandles.findIndex(c => c.time === newCandle.time);
      if (existingCandleIndex !== -1) {
        // 기존 캔들 업데이트 (마지막 캔들이 아직 진행 중일 때)
        recentCandles[existingCandleIndex] = newCandle;
      } else {
        // 새 캔들 추가
        recentCandles.push(newCandle);
        if (recentCandles.length > MAX_RECENT_CANDLES) {
          recentCandles.shift(); // 가장 오래된 캔들 제거
        }
      }

      // 업데이트된 recentCandles 기반으로 모든 지표 재계산 후 클라이언트에 전송
      processAndEmitFullChartData();
    }
  } catch (error) {
    const errorMessage = error.message;
    const logWsError = `Error processing WebSocket message: ${errorMessage}`;
    console.error(logWsError);
    uiIo.emit('server-log', { type: 'error', source: 'BinanceWS', message: logWsError, details: { errorData: errorMessage } });
  }
});

binanceWs.on('error', (error) => {
  const errorMessage = error.message;
  const logWsConnError = `WebSocket connection error: ${errorMessage}`;
  console.error(logWsConnError);
  uiIo.emit('server-log', { type: 'error', source: 'BinanceWS', message: logWsConnError, details: { errorData: errorMessage } });
});

// 서버 시작
server.listen(PORT, () => {
  console.log(`[INFO] server.js (매매 전략 서버) listening on port ${PORT}`);
  uiIo.emit('server-log', { type: 'info', source: 'server.js', message: `Server listening on port ${PORT}` });
  connectToOrderExecutor(); // 서버 시작 후 주문 실행기에 연결 시도
}); 

// 프로세스 종료 처리
function gracefulShutdownServer() {
    stopPingToExecutor();
    if (executorSocket) {
        console.log('[INFO] Disconnecting from Order Executor before shutdown...');
        executorSocket.disconnect();
    }
    binanceWs.close(); // 바이낸스 웹소켓도 닫기
    uiIo.close(() => { // UI용 Socket.IO 서버 닫기
        console.log('[INFO] UI Socket.IO server closed.');
        server.close(() => { // HTTP 서버 닫기
            console.log('[INFO] HTTP server closed. Exiting server.js.');
            process.exit(0);
        });
    });
    setTimeout(() => {
        console.error('[ERROR] Could not close connections in time, forcefully shutting down server.js');
        process.exit(1);
    }, 10000); // 10초 대기
}

process.on('SIGINT', gracefulShutdownServer);
process.on('SIGTERM', gracefulShutdownServer);
process.on('uncaughtException', (err) => {
    console.error('[FATAL] Uncaught Exception in server.js:', err);
    // 여기서도 gracefulShutdownServer를 시도하거나, 바로 종료할 수 있습니다.
    // uiIo.emit('server-log', { type: 'fatal', source: 'server.js', message: `Uncaught Exception: ${err.message}` });
    // gracefulShutdownServer(); // 혹은 바로 process.exit(1)
    process.exit(1);
}); 