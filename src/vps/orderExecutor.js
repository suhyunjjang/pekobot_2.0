require('dotenv').config();
const { Server } = require("socket.io");
const constants = require('../shared/config/constants');
const binanceAPI = require('../shared/api/binance');
const orderService = require('../shared/services/orderService');

/**
 * Order Executor 서버 클래스
 * - VPS 서버에서 실행됨
 * - 주문 신호에 따라 실제 주문 처리 및 TP/SL 실행
 * - 선물지갑 잔고, 포지션 정보를 서버에 전송
 */
class OrderExecutor {
    constructor() {
        this.serverJsSocket = null;
        this.isServerJsConnected = false;
        this.lastPingFromClient = Date.now();
        this.clientActivityCheckIntervalId = null;
        this.walletBalanceCheckIntervalId = null;
        this.positionsCheckIntervalId = null;
        
        this.io = new Server(constants.ORDER_EXECUTOR_PORT, {
            cors: {
                origin: "*", // server.js의 IP가 유동적이므로 일단 모든 출처 허용 (보안상 주의 필요)
                methods: ["GET", "POST"]
            }
        });
    }
    
    /**
     * 서버 초기화 및 시작
     */
    start() {
        console.log(`[INFO] Order Executor (WebSocket Server) listening on port ${constants.ORDER_EXECUTOR_PORT}`);
        console.log(`[INFO] Waiting for server.js (client) to connect...`);
        console.log(`[INFO] Capital Usage: ${constants.CAPITAL_PERCENTAGE_FOR_TRADE*100}%, Leverage: ${constants.LEVERAGE}x, ROI TP: +${constants.ROI_TP_PERCENTAGE*100}%, ROI SL: -${constants.ROI_SL_PERCENTAGE*100}%`);
        
        this.setupSocketEvents();
        this.setupShutdownHandlers();
    }
    
    /**
     * 소켓 이벤트 설정
     */
    setupSocketEvents() {
        this.io.on('connection', (socket) => {
            // 이 서버는 단일 server.js 클라이언트만 상대한다고 가정
            if (this.serverJsSocket) {
                console.warn(`[WARN] Another client (${socket.id}) attempted to connect. Disconnecting it as server.js is already connected (${this.serverJsSocket.id}).`);
                socket.disconnect(true);
                return;
            }
    
            this.serverJsSocket = socket;
            this.isServerJsConnected = true;
            this.lastPingFromClient = Date.now();
            console.log(`[INFO] server.js (Client ${socket.id}) connected.`);
            this.startClientActivityCheck();
            this.startWalletBalanceCheck();
            this.startPositionsCheck();
    
            socket.on('disconnect', (reason) => {
                console.warn(`[WARN] server.js (Client ${socket.id}) disconnected: ${reason}.`);
                if (this.serverJsSocket && this.serverJsSocket.id === socket.id) {
                    this.serverJsSocket = null;
                    this.isServerJsConnected = false;
                }
                this.stopClientActivityCheck();
                this.stopWalletBalanceCheck();
                this.stopPositionsCheck();
                console.log('[INFO] Waiting for server.js (client) to reconnect...');
            });
    
            socket.on('ping_from_client', (data) => {
                this.lastPingFromClient = Date.now();
                socket.emit('pong_to_client', { serverTimestamp: Date.now(), clientData: data });
            });
    
            // 트레이딩 시그널 수신 처리
            socket.on('trade_signal', async (signalData) => {
                if (!this.isServerJsConnected || !this.serverJsSocket || this.serverJsSocket.id !== socket.id) {
                    console.warn('[WARN] Received trade_signal, but server.js is not properly connected. Ignoring.');
                    return;
                }
                
                console.log('\n--- New Trade Signal Received from server.js ---');
                console.log(new Date().toLocaleString('ko-KR'));
                console.log('Signal Data:', signalData);
                
                try {
                    // 주문 실행
                    const orderResult = await orderService.executeMarketOrder(
                        signalData.symbol, 
                        signalData.side
                    );
                    
                    // TP/SL 설정
                    if (signalData.takeProfitPrice && signalData.stopLossPrice) {
                        await this.setTPSL(
                            signalData.symbol, 
                            signalData.side, 
                            signalData.takeProfitPrice, 
                            signalData.stopLossPrice
                        );
                    }
                    
                    // 성공 로그 전송
                    if (this.serverJsSocket) {
                        this.serverJsSocket.emit('order_execution_log', { 
                            type: 'success', 
                            message: 'Entry order placed successfully by executor', 
                            details: orderResult 
                        });
                    }
                    
                    // 지갑 잔고 및 포지션 정보 즉시 업데이트
                    await this.sendWalletBalanceToServer();
                    await this.sendPositionsToServer();
                    
                } catch (error) {
                    console.error('[ERROR] Failed to execute trade:', error.message);
                    
                    if (this.serverJsSocket) {
                        this.serverJsSocket.emit('order_execution_log', { 
                            type: 'error', 
                            message: `Failed to execute trade: ${error.message}` 
                        });
                    }
                }
            });
            
            // TP/SL 수정 요청 처리
            socket.on('modify_tpsl', async (data) => {
                if (!this.isServerJsConnected || !this.serverJsSocket || this.serverJsSocket.id !== socket.id) {
                    console.warn('[WARN] Received modify_tpsl, but server.js is not properly connected. Ignoring.');
                    return;
                }
                
                console.log('\n--- TP/SL Modification Request Received ---');
                console.log(new Date().toLocaleString('ko-KR'));
                console.log('Modification Data:', data);
                
                try {
                    // TP/SL 수정
                    const result = await orderService.modifyTPSL(
                        data.symbol, 
                        data.type, 
                        data.newPrice
                    );
                    
                    // 성공 로그 전송
                    if (this.serverJsSocket) {
                        this.serverJsSocket.emit('order_execution_log', { 
                            type: 'success', 
                            message: `${data.type} order updated successfully`, 
                            details: result 
                        });
                    }
                    
                } catch (error) {
                    console.error(`[ERROR] Failed to modify ${data.type}:`, error.message);
                    
                    if (this.serverJsSocket) {
                        this.serverJsSocket.emit('order_execution_log', { 
                            type: 'error', 
                            message: `Failed to modify ${data.type}: ${error.message}` 
                        });
                    }
                }
            });
            
            // 포지션 취소 요청 처리
            socket.on('cancel_position', async (data) => {
                if (!this.isServerJsConnected || !this.serverJsSocket || this.serverJsSocket.id !== socket.id) {
                    console.warn('[WARN] Received cancel_position, but server.js is not properly connected. Ignoring.');
                    return;
                }
                
                console.log('\n--- Position Cancellation Request Received ---');
                console.log(new Date().toLocaleString('ko-KR'));
                console.log('Cancellation Data:', data);
                
                try {
                    // 모든 주문 취소 후 포지션 청산
                    await orderService.cancelAllActiveOrders(data.symbol);
                    await orderService.closePosition(data.symbol);
                    
                    // 성공 로그 전송
                    if (this.serverJsSocket) {
                        this.serverJsSocket.emit('order_execution_log', { 
                            type: 'success', 
                            message: `All orders for ${data.symbol} cancelled and position closed successfully` 
                        });
                    }
                    
                    // 지갑 잔고 및 포지션 정보 즉시 업데이트
                    await this.sendWalletBalanceToServer();
                    await this.sendPositionsToServer();
                    
                } catch (error) {
                    console.error('[ERROR] Failed to cancel position:', error.message);
                    
                    if (this.serverJsSocket) {
                        this.serverJsSocket.emit('order_execution_log', { 
                            type: 'error', 
                            message: `Failed to cancel position: ${error.message}` 
                        });
                    }
                }
            });
            
            // 지갑 잔고 정보 요청 처리
            socket.on('request_wallet_balance', async () => {
                try {
                    await this.sendWalletBalanceToServer();
                } catch (error) {
                    console.error('[ERROR] Failed to fetch wallet balance:', error.message);
                }
            });
            
            // 포지션 정보 요청 처리
            socket.on('request_positions', async () => {
                try {
                    await this.sendPositionsToServer();
                } catch (error) {
                    console.error('[ERROR] Failed to fetch positions:', error.message);
                }
            });
        });
    }
    
    /**
     * TP/SL 설정
     */
    async setTPSL(symbol, side, takeProfitPrice, stopLossPrice) {
        try {
            // 이익실현(TP) 주문 설정
            const tpResult = await orderService.modifyTPSL(symbol, 'TP', takeProfitPrice);
            console.log(`[INFO] Take Profit set at ${takeProfitPrice}`);
            
            // 손절(SL) 주문 설정
            const slResult = await orderService.modifyTPSL(symbol, 'SL', stopLossPrice);
            console.log(`[INFO] Stop Loss set at ${stopLossPrice}`);
            
            return { tp: tpResult, sl: slResult };
        } catch (error) {
            console.error('[ERROR] Failed to set TP/SL:', error.message);
            throw error;
        }
    }
    
    /**
     * 클라이언트 활동 체크 시작
     */
    startClientActivityCheck() {
        if (this.clientActivityCheckIntervalId) clearInterval(this.clientActivityCheckIntervalId);
        
        this.clientActivityCheckIntervalId = setInterval(() => {
            if (this.isServerJsConnected && this.serverJsSocket) {
                if (Date.now() - this.lastPingFromClient > constants.CLIENT_ACTIVITY_TIMEOUT) {
                    console.warn(`[WARN] No ping/activity from server.js (client) for ${constants.CLIENT_ACTIVITY_TIMEOUT/1000}s. Disconnecting client.`);
                    this.serverJsSocket.disconnect(true);
                }
            }
        }, constants.CLIENT_ACTIVITY_TIMEOUT / 2);
        
        console.log('[INFO] Client activity check interval started.');
    }
    
    /**
     * 클라이언트 활동 체크 중지
     */
    stopClientActivityCheck() {
        if (this.clientActivityCheckIntervalId) {
            clearInterval(this.clientActivityCheckIntervalId);
            this.clientActivityCheckIntervalId = null;
            console.log('[INFO] Client activity check interval stopped.');
        }
    }
    
    /**
     * 지갑 잔고 체크 시작
     */
    startWalletBalanceCheck() {
        if (this.walletBalanceCheckIntervalId) clearInterval(this.walletBalanceCheckIntervalId);
        
        // 최초 한 번 잔고 체크
        this.sendWalletBalanceToServer();
        
        // 정기적으로 잔고 체크 (30초마다)
        this.walletBalanceCheckIntervalId = setInterval(() => {
            this.sendWalletBalanceToServer();
        }, 30000);
        
        console.log('[INFO] Wallet balance check interval started.');
    }
    
    /**
     * 지갑 잔고 체크 중지
     */
    stopWalletBalanceCheck() {
        if (this.walletBalanceCheckIntervalId) {
            clearInterval(this.walletBalanceCheckIntervalId);
            this.walletBalanceCheckIntervalId = null;
            console.log('[INFO] Wallet balance check interval stopped.');
        }
    }
    
    /**
     * 포지션 체크 시작
     */
    startPositionsCheck() {
        if (this.positionsCheckIntervalId) clearInterval(this.positionsCheckIntervalId);
        
        // 최초 한 번 포지션 체크
        this.sendPositionsToServer();
        
        // 정기적으로 포지션 체크 (10초마다)
        this.positionsCheckIntervalId = setInterval(() => {
            this.sendPositionsToServer();
        }, 10000);
        
        console.log('[INFO] Positions check interval started.');
    }
    
    /**
     * 포지션 체크 중지
     */
    stopPositionsCheck() {
        if (this.positionsCheckIntervalId) {
            clearInterval(this.positionsCheckIntervalId);
            this.positionsCheckIntervalId = null;
            console.log('[INFO] Positions check interval stopped.');
        }
    }
    
    /**
     * 지갑 잔고 정보를 서버에 전송
     */
    async sendWalletBalanceToServer() {
        if (!this.isServerJsConnected || !this.serverJsSocket) return;
        
        try {
            const balance = await binanceAPI.getWalletBalance();
            
            this.serverJsSocket.emit('wallet_balance', balance);
            
        } catch (error) {
            console.error('[ERROR] Failed to fetch wallet balance:', error.message);
        }
    }
    
    /**
     * 포지션 정보를 서버에 전송
     */
    async sendPositionsToServer() {
        if (!this.isServerJsConnected || !this.serverJsSocket) return;
        
        try {
            const positions = await binanceAPI.getPositions();
            
            this.serverJsSocket.emit('positions', positions);
            
        } catch (error) {
            console.error('[ERROR] Failed to fetch positions:', error.message);
        }
    }
    
    /**
     * 종료 핸들러 설정
     */
    setupShutdownHandlers() {
        const gracefulShutdown = () => {
            console.log('[INFO] Shutting down Order Executor gracefully...');
            
            this.stopClientActivityCheck();
            this.stopWalletBalanceCheck();
            this.stopPositionsCheck();
            
            if (this.serverJsSocket) {
                this.serverJsSocket.disconnect(true);
            }
            
            this.io.close(() => {
                console.log('[INFO] Order Executor closed');
                process.exit(0);
            });
            
            setTimeout(() => {
                console.error('[ERROR] Could not close connections in time, forcefully shutting down');
                process.exit(1);
            }, 5000);
        };
        
        process.on('SIGTERM', gracefulShutdown);
        process.on('SIGINT', gracefulShutdown);
    }
}

// Order Executor 서버 생성 및 시작
const executor = new OrderExecutor();
executor.start(); 