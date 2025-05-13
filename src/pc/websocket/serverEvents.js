const signalService = require('../services/signalService');
const dataService = require('../services/dataService');
const orderService = require('../services/orderService');
const constants = require('../config/constants');

/**
 * 웹소켓 서버 이벤트 처리 클래스
 */
class ServerEvents {
    constructor() {
        this.io = null;
        this.executorSocket = null;
        this.isConnectedToExecutor = false;
        this.lastPongFromExecutor = Date.now();
        this.pingToExecutorIntervalId = null;
    }

    /**
     * Socket.IO 서버 초기화
     * @param {Object} io - Socket.IO 서버 객체
     */
    initialize(io) {
        this.io = io;
        this.setupSocketEvents();
    }

    /**
     * 소켓 이벤트 설정
     */
    setupSocketEvents() {
        if (!this.io) return;

        this.io.on('connection', (socket) => {
            console.log(`[INFO] Client connected: ${socket.id}`);
            
            // 클라이언트 연결 시 현재 데이터 전송
            this.sendCurrentData(socket);
            
            // 클라이언트 요청 처리 이벤트
            socket.on('request_historical_data', () => {
                this.sendCurrentData(socket);
            });
            
            socket.on('execute_trade', async (data) => {
                try {
                    const { signal, symbol = constants.SYMBOL_FOR_TRADING } = data;
                    
                    if (!signal || !['LONG', 'SHORT'].includes(signal)) {
                        throw new Error(`Invalid trade signal: ${signal}`);
                    }
                    
                    // Order Executor 서버로 주문 시그널 전송
                    if (this.isConnectedToExecutor && this.executorSocket) {
                        const side = signal === 'LONG' ? 'BUY' : 'SELL';
                        const latestCandle = dataService.getLatestCandle();
                        
                        if (!latestCandle) {
                            throw new Error('No candle data available for trade');
                        }
                        
                        const signalData = {
                            symbol,
                            side,
                            type: 'MARKET',
                            originalPrice: latestCandle.close
                        };
                        
                        this.executorSocket.emit('trade_signal', signalData);
                        
                        // 현재 포지션 업데이트
                        signalService.setCurrentPosition(signal);
                        
                        socket.emit('trade_executed', {
                            status: 'success',
                            signal,
                            currentPosition: signalService.currentPosition,
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
                    
                    // Order Executor 서버에 TP/SL 수정 요청 전송
                    if (this.isConnectedToExecutor && this.executorSocket) {
                        this.executorSocket.emit('modify_tpsl', { type, newPrice, symbol });
                        
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
                    
                    // Order Executor 서버에 포지션 취소 요청 전송
                    if (this.isConnectedToExecutor && this.executorSocket) {
                        this.executorSocket.emit('cancel_position', { symbol });
                        
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
    }

    /**
     * Order Executor 서버와 연결
     * @param {string} url - Order Executor 서버 URL
     */
    connectToOrderExecutor(url = constants.ORDER_EXECUTOR_URL) {
        if (this.executorSocket && this.executorSocket.connected) {
            console.log('[INFO] Already connected to Order Executor.');
            return;
        }
        
        const socketIoClient = require('socket.io-client');
        
        console.log(`[INFO] Attempting to connect to Order Executor at ${url}`);
        this.executorSocket = socketIoClient(url, {
            reconnectionAttempts: Infinity,
            timeout: 20000,
        });

        this.executorSocket.on('connect', () => {
            this.isConnectedToExecutor = true;
            this.lastPongFromExecutor = Date.now();
            console.log(`[INFO] Connected to Order Executor: ${this.executorSocket.id}`);
            this.startPingToExecutor();
            this.updateExecutorConnectionStatusForUI();
        });

        this.executorSocket.on('disconnect', (reason) => {
            this.isConnectedToExecutor = false;
            console.warn(`[WARN] Disconnected from Order Executor: ${reason}`);
            this.stopPingToExecutor();
            this.updateExecutorConnectionStatusForUI();
        });

        this.executorSocket.on('connect_error', (error) => {
            this.isConnectedToExecutor = false;
            console.error(`[ERROR] Failed to connect to Order Executor: ${error.message}`);
            this.stopPingToExecutor();
            this.updateExecutorConnectionStatusForUI();
        });
        
        this.executorSocket.on('pong_to_client', () => { 
            this.lastPongFromExecutor = Date.now();
        });

        this.executorSocket.on('order_execution_log', (logData) => { 
            console.log('[EXECUTOR LOG]', logData.message, logData.details || '');
            
            if (this.io) {
                this.io.emit('server-log', { 
                    type: logData.type || 'info',
                    source: 'OrderExecutor', 
                    message: logData.message, 
                    details: logData.details 
                });
            }
            
            if (this.executorSocket && logData.message) { 
                this.executorSocket.emit('order_execution_log_ack', { receivedMessage: logData.message });
            }
        });
    }

    /**
     * Order Executor 서버로 Ping 전송 시작
     */
    startPingToExecutor() {
        if (this.pingToExecutorIntervalId) clearInterval(this.pingToExecutorIntervalId);
        
        this.pingToExecutorIntervalId = setInterval(() => {
            if (this.isConnectedToExecutor && this.executorSocket) {
                if (Date.now() - this.lastPongFromExecutor > constants.PING_TO_EXECUTOR_INTERVAL + constants.PONG_FROM_EXECUTOR_TIMEOUT) {
                    console.warn('[WARN] No pong from Order Executor for too long. Disconnecting to trigger reconnect.');
                    this.executorSocket.disconnect();
                } else {
                    this.executorSocket.emit('ping_from_client', { timestamp: Date.now(), source: 'server.js' });
                }
            }
        }, constants.PING_TO_EXECUTOR_INTERVAL);
        
        console.log('[INFO] Ping interval to Order Executor started.');
    }

    /**
     * Order Executor 서버로 Ping 전송 중지
     */
    stopPingToExecutor() {
        if (this.pingToExecutorIntervalId) {
            clearInterval(this.pingToExecutorIntervalId);
            this.pingToExecutorIntervalId = null;
            console.log('[INFO] Ping interval to Order Executor stopped.');
        }
    }

    /**
     * UI에 Order Executor 연결 상태 업데이트
     */
    updateExecutorConnectionStatusForUI() {
        if (this.io) {
            this.io.emit('executor_connection_status', this.isConnectedToExecutor);
            console.log(`[UI_EMIT] Sent executor_connection_status: ${this.isConnectedToExecutor}`);
        }
    }

    /**
     * 현재 데이터 클라이언트에 전송
     * @param {Object} socket - 클라이언트 소켓 객체 (특정 클라이언트) 또는 null (전체 클라이언트)
     */
    sendCurrentData(socket = null) {
        try {
            // 모든 지표 계산
            const allIndicators = dataService.calculateAllIndicators();
            
            // 매매 신호 생성
            const signals = signalService.generateSignals(allIndicators);
            
            // 데이터와 신호 합치기
            const fullChartData = {
                ...allIndicators,
                signals
            };
            
            // 데이터 전송 (특정 클라이언트 또는 전체)
            if (socket) {
                socket.emit('chart_data', fullChartData);
            } else if (this.io) {
                this.io.emit('chart_data', fullChartData);
            }
            
        } catch (error) {
            console.error(`[ERROR] Failed to send current data: ${error.message}`);
        }
    }

    /**
     * 실시간 캔들 데이터 처리 및 전송
     * @param {Object} newCandle - 새 캔들 데이터
     */
    processRealtimeCandle(newCandle) {
        try {
            // 새 캔들 데이터 추가
            dataService.addNewCandle(newCandle);
            
            // 업데이트된 데이터 전송
            this.sendCurrentData();
            
        } catch (error) {
            console.error(`[ERROR] Failed to process realtime candle: ${error.message}`);
        }
    }
}

module.exports = new ServerEvents(); 