const express = require('express');
const http = require('http');
const path = require('path');
const { Server: SocketIOServer } = require('socket.io');
const WebSocket = require('ws');
const socketIoClient = require('socket.io-client');
require('dotenv').config();

// 모듈 가져오기
const constants = require('../shared/config/constants');
const apiRoutes = require('./api/routes');
const dataService = require('../shared/services/dataService');
const signalService = require('../shared/services/signalService');

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
    cors: {
        origin: "*", 
        methods: ["GET", "POST"]
    }
});

// 정적 파일 제공
app.use(express.static(path.join(__dirname, '../../public')));

// API 라우트 설정
app.use('/api', apiRoutes);

// 바이낸스 선물 웹소켓 URL
const wsUrlFutures = 'wss://fstream.binance.com/ws';

// 주문실행기 연결 상태
let executorSocket = null;
let isConnectedToExecutor = false;
let lastPongFromExecutor = Date.now();
let pingToExecutorIntervalId = null;
let walletBalance = null;
let positions = [];

// 클라이언트 소켓 이벤트 설정
io.on('connection', (socket) => {
    console.log(`[INFO] Client connected: ${socket.id}`);
    
    // 클라이언트 연결 시 현재 데이터 전송
    sendCurrentDataToClient(socket);
    
    // 클라이언트 요청 처리 이벤트
    socket.on('request_historical_data', () => {
        sendCurrentDataToClient(socket);
    });
    
    socket.on('execute_trade', async (data) => {
        try {
            const { signal, symbol = constants.SYMBOL_FOR_TRADING } = data;
            
            if (!signal || !['LONG', 'SHORT'].includes(signal)) {
                throw new Error(`Invalid trade signal: ${signal}`);
            }
            
            // 주문실행기로 주문 시그널 전송
            if (isConnectedToExecutor && executorSocket) {
                const side = signal === 'LONG' ? 'BUY' : 'SELL';
                const latestCandle = dataService.getLatestCandle();
                
                if (!latestCandle) {
                    throw new Error('No candle data available for trade');
                }
                
                // TP/SL 계산
                const entryPrice = latestCandle.close;
                const { takeProfitPrice, stopLossPrice } = calculateTPSL(signal, entryPrice);
                
                const signalData = {
                    symbol,
                    side,
                    type: 'MARKET',
                    originalPrice: entryPrice,
                    takeProfitPrice,
                    stopLossPrice
                };
                
                executorSocket.emit('trade_signal', signalData);
                
                // 현재 포지션 업데이트
                signalService.setCurrentPosition(signal);
                
                socket.emit('trade_executed', {
                    status: 'success',
                    signal,
                    currentPosition: signalService.currentPosition,
                    takeProfitPrice,
                    stopLossPrice,
                    timestamp: Date.now()
                });
                
            } else {
                throw new Error('Not connected to Order Executor');
            }
            
        } catch (error) {
            console.error(`[ERROR] Failed to execute trade: ${error.message}`);
            socket.emit('trade_executed', {
                status: 'error',
                message: error.message,
                timestamp: Date.now()
            });
        }
    });
    
    socket.on('modify_tpsl', async (data) => {
        try {
            const { type, newPrice, symbol = constants.SYMBOL_FOR_TRADING } = data;
            
            if (!type || !['TP', 'SL'].includes(type)) {
                throw new Error(`Invalid order type: ${type}`);
            }
            
            if (!newPrice || isNaN(newPrice) || newPrice <= 0) {
                throw new Error(`Invalid price: ${newPrice}`);
            }
            
            // 주문실행기에 TP/SL 수정 요청 전송
            if (isConnectedToExecutor && executorSocket) {
                executorSocket.emit('modify_tpsl', { type, newPrice, symbol });
                
                socket.emit('tpsl_modified', {
                    status: 'success',
                    type,
                    newPrice,
                    symbol,
                    timestamp: Date.now()
                });
                
            } else {
                throw new Error('Not connected to Order Executor');
            }
            
        } catch (error) {
            console.error(`[ERROR] Failed to modify TP/SL: ${error.message}`);
            socket.emit('tpsl_modified', {
                status: 'error',
                message: error.message,
                timestamp: Date.now()
            });
        }
    });
    
    socket.on('cancel_position', async (data) => {
        try {
            const { symbol = constants.SYMBOL_FOR_TRADING } = data;
            
            // 주문실행기에 포지션 취소 요청 전송
            if (isConnectedToExecutor && executorSocket) {
                executorSocket.emit('cancel_position', { symbol });
                
                // 현재 포지션 초기화
                signalService.setCurrentPosition('NONE');
                
                socket.emit('position_cancelled', {
                    status: 'success',
                    symbol,
                    timestamp: Date.now()
                });
                
            } else {
                throw new Error('Not connected to Order Executor');
            }
            
        } catch (error) {
            console.error(`[ERROR] Failed to cancel position: ${error.message}`);
            socket.emit('position_cancelled', {
                status: 'error',
                message: error.message,
                timestamp: Date.now()
            });
        }
    });
    
    socket.on('disconnect', () => {
        console.log(`[INFO] Client disconnected: ${socket.id}`);
    });
});

// TP/SL 가격 계산 함수
function calculateTPSL(signal, entryPrice) {
    const takeProfitPercentage = constants.ROI_TP_PERCENTAGE;
    const stopLossPercentage = constants.ROI_SL_PERCENTAGE;
    
    let takeProfitPrice, stopLossPrice;
    
    if (signal === 'LONG') {
        takeProfitPrice = entryPrice * (1 + takeProfitPercentage);
        stopLossPrice = entryPrice * (1 - stopLossPercentage);
    } else { // SHORT
        takeProfitPrice = entryPrice * (1 - takeProfitPercentage);
        stopLossPrice = entryPrice * (1 + stopLossPercentage);
    }
    
    return {
        takeProfitPrice: parseFloat(takeProfitPrice.toFixed(2)),
        stopLossPrice: parseFloat(stopLossPrice.toFixed(2))
    };
}

// 클라이언트에 현재 데이터 전송
function sendCurrentDataToClient(socket = null) {
    const target = socket || io;
    
    const data = {
        candles: dataService.getCandles(),
        currentPosition: signalService.currentPosition,
        signals: signalService.getSignals(),
        walletBalance,
        positions,
        executorConnected: isConnectedToExecutor
    };
    
    target.emit('historical_data', data);
}

// 바이낸스 웹소켓 연결 함수
function connectBinanceWebSocket() {
    console.log('[INFO] Connecting to Binance WebSocket...');
    
    const ws = new WebSocket(wsUrlFutures);
    
    ws.on('open', () => {
        console.log('[INFO] Connected to Binance WebSocket');
        
        // 캔들스틱 데이터 구독
        const subscribeMsg = {
            method: 'SUBSCRIBE',
            params: [`${constants.SYMBOL_FOR_TRADING.toLowerCase()}@kline_${constants.KLINE_INTERVAL}`],
            id: 1
        };
        
        ws.send(JSON.stringify(subscribeMsg));
    });
    
    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data);
            
            // 구독 확인 메시지 처리
            if (message.result === null && message.id === 1) {
                console.log(`[INFO] Successfully subscribed to ${constants.SYMBOL_FOR_TRADING} klines`);
                return;
            }
            
            // 캔들스틱 데이터 처리
            if (message.e === 'kline') {
                const candle = {
                    time: message.k.t,
                    open: parseFloat(message.k.o),
                    high: parseFloat(message.k.h),
                    low: parseFloat(message.k.l),
                    close: parseFloat(message.k.c),
                    volume: parseFloat(message.k.v),
                    isComplete: message.k.x
                };
                
                // 캔들 데이터 처리 및 업데이트
                processRealtimeCandle(candle);
            }
            
        } catch (error) {
            console.error('[ERROR] Failed to parse WebSocket message:', error.message);
        }
    });
    
    ws.on('error', (error) => {
        console.error('[ERROR] Binance WebSocket error:', error.message);
        setTimeout(connectBinanceWebSocket, 5000); // 5초 후 재연결 시도
    });
    
    ws.on('close', () => {
        console.warn('[WARN] Binance WebSocket connection closed');
        setTimeout(connectBinanceWebSocket, 5000); // 5초 후 재연결 시도
    });
    
    return ws;
}

// 실시간 캔들 데이터 처리
function processRealtimeCandle(candle) {
    // 데이터 서비스에 캔들 업데이트
    dataService.updateCandle(candle);
    
    // 시그널 생성 (필요한 경우)
    signalService.processCandle(candle);
    
    // 클라이언트에 데이터 브로드캐스트
    io.emit('realtime_candle', candle);
    
    // 완료된 캔들에 대한 처리
    if (candle.isComplete) {
        // 필요한 경우 저장 또는 추가 처리
        console.log(`[INFO] Complete candle at ${new Date(candle.time).toLocaleString('ko-KR')}: O=${candle.open} H=${candle.high} L=${candle.low} C=${candle.close}`);
    }
}

// 주문실행기 서버와 연결
function connectToOrderExecutor(url = constants.ORDER_EXECUTOR_URL) {
    if (executorSocket && executorSocket.connected) {
        console.log('[INFO] Already connected to Order Executor.');
        return;
    }
    
    console.log(`[INFO] Attempting to connect to Order Executor at ${url}`);
    executorSocket = socketIoClient(url, {
        reconnectionAttempts: Infinity,
        timeout: 20000,
    });

    executorSocket.on('connect', () => {
        isConnectedToExecutor = true;
        lastPongFromExecutor = Date.now();
        console.log(`[INFO] Connected to Order Executor: ${executorSocket.id}`);
        startPingToExecutor();
        updateExecutorConnectionStatusForUI();
        
        // 연결 직후 지갑 정보와 포지션 정보 요청
        executorSocket.emit('request_wallet_balance');
        executorSocket.emit('request_positions');
    });

    executorSocket.on('disconnect', (reason) => {
        isConnectedToExecutor = false;
        console.warn(`[WARN] Disconnected from Order Executor: ${reason}`);
        stopPingToExecutor();
        updateExecutorConnectionStatusForUI();
    });

    executorSocket.on('connect_error', (error) => {
        isConnectedToExecutor = false;
        console.error(`[ERROR] Failed to connect to Order Executor: ${error.message}`);
        stopPingToExecutor();
        updateExecutorConnectionStatusForUI();
    });
    
    executorSocket.on('pong_to_client', () => { 
        lastPongFromExecutor = Date.now();
    });

    executorSocket.on('order_execution_log', (logData) => { 
        console.log('[EXECUTOR LOG]', logData.message, logData.details || '');
        
        io.emit('server-log', { 
            type: logData.type || 'info',
            source: 'OrderExecutor', 
            message: logData.message, 
            details: logData.details 
        });
    });
    
    // 지갑 잔고 정보 수신
    executorSocket.on('wallet_balance', (balanceData) => {
        walletBalance = balanceData;
        io.emit('wallet_balance_update', balanceData);
    });
    
    // 포지션 정보 수신
    executorSocket.on('positions', (positionData) => {
        positions = positionData;
        io.emit('positions_update', positionData);
    });
}

// 주문실행기로 Ping 전송 시작
function startPingToExecutor() {
    if (pingToExecutorIntervalId) clearInterval(pingToExecutorIntervalId);
    
    pingToExecutorIntervalId = setInterval(() => {
        if (isConnectedToExecutor && executorSocket) {
            if (Date.now() - lastPongFromExecutor > constants.PING_TO_EXECUTOR_INTERVAL + constants.PONG_FROM_EXECUTOR_TIMEOUT) {
                console.warn('[WARN] No pong from Order Executor for too long. Disconnecting to trigger reconnect.');
                executorSocket.disconnect();
            } else {
                executorSocket.emit('ping_from_client', { timestamp: Date.now(), source: 'server.js' });
            }
        }
    }, constants.PING_TO_EXECUTOR_INTERVAL);
    
    console.log('[INFO] Ping interval to Order Executor started.');
}

// 주문실행기 Ping 중지
function stopPingToExecutor() {
    if (pingToExecutorIntervalId) {
        clearInterval(pingToExecutorIntervalId);
        pingToExecutorIntervalId = null;
        console.log('[INFO] Ping interval to Order Executor stopped.');
    }
}

// 주문실행기 연결 상태 UI 업데이트
function updateExecutorConnectionStatusForUI() {
    io.emit('executor_connection', {
        connected: isConnectedToExecutor,
        timestamp: Date.now()
    });
}

// 서버 시작 함수
async function startServer() {
    try {
        // 과거 캔들 데이터 로드
        await dataService.initializeHistoricalData();
        
        // 주문실행기 서버에 연결
        connectToOrderExecutor();
        
        // 바이낸스 웹소켓 연결
        const binanceWs = connectBinanceWebSocket();
        
        // 서버 종료 시 정리 작업
        function gracefulShutdown() {
            console.log('[INFO] Shutting down server gracefully...');
            
            // 웹소켓 연결 종료
            if (binanceWs && binanceWs.readyState === WebSocket.OPEN) {
                binanceWs.close();
            }
            
            // 주문실행기 연결 종료
            if (executorSocket && executorSocket.connected) {
                executorSocket.disconnect();
            }
            
            // 서버 종료
            server.close(() => {
                console.log('[INFO] Server closed');
                process.exit(0);
            });
            
            // 강제 종료 타임아웃 설정 (5초)
            setTimeout(() => {
                console.error('[ERROR] Could not close connections in time, forcefully shutting down');
                process.exit(1);
            }, 5000);
        }
        
        // 종료 시그널 처리
        process.on('SIGTERM', gracefulShutdown);
        process.on('SIGINT', gracefulShutdown);
        
        // 서버 시작
        const PORT = process.env.PORT || constants.DEFAULT_PORT;
        server.listen(PORT, () => {
            console.log(`[INFO] Server listening on port ${PORT}`);
        });
        
    } catch (error) {
        console.error('[ERROR] Failed to start server:', error.message);
        process.exit(1);
    }
}

// 서버 시작
startServer(); 