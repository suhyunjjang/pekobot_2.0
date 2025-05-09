// order-executor.js (이제 웹소켓 서버 역할)
require('dotenv').config();
const { Server } = require("socket.io"); // socket.io-client 대신 socket.io의 Server 사용
const ccxt = require('ccxt');

// --- 설정값 ---
const ORDER_EXECUTOR_PORT = 5000; // 주문 실행기가 리슨할 포트
const CAPITAL_PERCENTAGE_FOR_TRADE = 0.50;
const LEVERAGE = 10;
const ROI_TP_PERCENTAGE = 0.08;
const ROI_SL_PERCENTAGE = 0.05;

// Ping/Pong 관련: 클라이언트(server.js)가 Ping을 보내고, 여기서는 Pong으로 응답.
// 클라이언트가 일정 시간 Ping을 안보내면 연결이 끊겼다고 간주 가능.
const CLIENT_ACTIVITY_TIMEOUT = 30000; // 예: 30초 동안 클라이언트로부터 ping 없으면 문제 간주
// --- 설정값 끝 ---

let serverJsSocket = null; // 연결된 server.js의 소켓 객체
let isServerJsConnected = false;
let lastPingFromClient = Date.now();
let clientActivityCheckIntervalId = null;

const io = new Server(ORDER_EXECUTOR_PORT, {
    cors: {
        origin: "*", // server.js의 IP가 유동적이므로 일단 모든 출처 허용 (보안상 주의 필요)
        methods: ["GET", "POST"]
    }
});

console.log(`[INFO] Order Executor (WebSocket Server) listening on port ${ORDER_EXECUTOR_PORT}`);
console.log(`[INFO] Waiting for server.js (client) to connect...`);
console.log(`[INFO] Capital Usage: ${CAPITAL_PERCENTAGE_FOR_TRADE*100}%, Leverage: ${LEVERAGE}x, ROI TP: +${ROI_TP_PERCENTAGE*100}%, ROI SL: -${ROI_SL_PERCENTAGE*100}%`);

const exchange = new ccxt.binanceusdm({
    apiKey: process.env.BINANCE_FUTURES_API_KEY,
    secret: process.env.BINANCE_FUTURES_API_SECRET,
    options: {
        defaultType: 'future',
    }
});

function formatSymbolToCcxt(binanceSymbol) {
    if (binanceSymbol && binanceSymbol.toUpperCase().endsWith('USDT')) {
        return `${binanceSymbol.slice(0, -4)}/USDT`;
    }
    console.warn(`[WARN] Could not format symbol for CCXT: ${binanceSymbol}, using as is.`);
    return binanceSymbol;
}

function startClientActivityCheck() {
    if (clientActivityCheckIntervalId) clearInterval(clientActivityCheckIntervalId);
    clientActivityCheckIntervalId = setInterval(() => {
        if (isServerJsConnected && serverJsSocket) {
            if (Date.now() - lastPingFromClient > CLIENT_ACTIVITY_TIMEOUT) {
                console.warn(`[WARN] No ping/activity from server.js (client) for ${CLIENT_ACTIVITY_TIMEOUT/1000}s. Disconnecting client.`);
                serverJsSocket.disconnect(true); // 클라이언트 연결 강제 해제
                // isServerJsConnected 와 serverJsSocket 은 disconnect 이벤트에서 null 처리됨
            }
        }
    }, CLIENT_ACTIVITY_TIMEOUT / 2); // 타임아웃 주기의 절반마다 체크
    console.log('[INFO] Client activity check interval started.');
}

function stopClientActivityCheck() {
    if (clientActivityCheckIntervalId) {
        clearInterval(clientActivityCheckIntervalId);
        clientActivityCheckIntervalId = null;
        console.log('[INFO] Client activity check interval stopped.');
    }
}

io.on('connection', (socket) => {
    // 이 서버는 단일 server.js 클라이언트만 상대한다고 가정
    if (serverJsSocket) {
        console.warn(`[WARN] Another client (${socket.id}) attempted to connect. Disconnecting it as server.js is already connected (${serverJsSocket.id}).`);
        socket.disconnect(true);
        return;
    }

    serverJsSocket = socket;
    isServerJsConnected = true;
    lastPingFromClient = Date.now();
    console.log(`[INFO] server.js (Client ${socket.id}) connected.`);
    startClientActivityCheck();

    socket.on('disconnect', (reason) => {
        console.warn(`[WARN] server.js (Client ${socket.id}) disconnected: ${reason}.`);
        if (serverJsSocket && serverJsSocket.id === socket.id) {
            serverJsSocket = null;
            isServerJsConnected = false;
        }
        stopClientActivityCheck();
        console.log('[INFO] Waiting for server.js (client) to reconnect...');
    });

    socket.on('ping_from_client', (data) => {
        // console.log(`[DEBUG] Ping received from server.js (client ${socket.id}):`, data);
        lastPingFromClient = Date.now();
        socket.emit('pong_to_client', { serverTimestamp: Date.now(), clientData: data });
    });

    socket.on('trade_signal', async (signalData) => {
        if (!isServerJsConnected || !serverJsSocket || serverJsSocket.id !== socket.id) {
            console.warn('[WARN] Received trade_signal, but server.js is not properly connected. Ignoring.');
            return;
        }
        console.log('\n--- New Trade Signal Received from server.js ---');
        console.log(new Date().toLocaleString('ko-KR'));
        console.log('Signal Data:', signalData);

        const { symbol: binanceSymbol, side, type, originalPrice } = signalData;
        const ccxtSymbol = formatSymbolToCcxt(binanceSymbol);
        let orderQuantity;

        try {
            // 0. 자본 기반 주문 수량 계산
            console.log('[INFO] Fetching balance and ticker for quantity calculation...');
            const balance = await exchange.fetchBalance({ type: 'future' });
            const usdtBalance = balance.USDT && balance.USDT.free ? balance.USDT.free : 0;
            if (usdtBalance <= 0) {
                console.error('[ERROR] Insufficient USDT balance to trade.', { usdtAvailable: usdtBalance });
                if(serverJsSocket) serverJsSocket.emit('order_execution_log', { type: 'error', message: 'Insufficient USDT balance on executor', details: { usdtBalance } });
                return;
            }
            const capitalToUse = usdtBalance * CAPITAL_PERCENTAGE_FOR_TRADE;
            const ticker = await exchange.fetchTicker(ccxtSymbol);
            const currentPrice = ticker.last || ticker.close;
            if (!currentPrice) {
                console.error(`[ERROR] Could not fetch current price for ${ccxtSymbol}`);
                if(serverJsSocket) serverJsSocket.emit('order_execution_log', { type: 'error', message: `Executor could not fetch current price for ${ccxtSymbol}` });
                return;
            }
            const positionValueUsdt = capitalToUse * LEVERAGE;
            let calculatedQuantity = positionValueUsdt / currentPrice;
            if (exchange.markets && exchange.markets[ccxtSymbol] && exchange.markets[ccxtSymbol].precision && exchange.markets[ccxtSymbol].precision.amount) {
                orderQuantity = parseFloat(exchange.amountToPrecision(ccxtSymbol, calculatedQuantity));
            } else {
                console.warn(`[WARN] Could not find amount precision for ${ccxtSymbol}. Using calculated quantity as is.`);
                orderQuantity = calculatedQuantity;
            }
            const minOrderAmount = exchange.markets[ccxtSymbol]?.limits?.amount?.min;
            if (minOrderAmount && orderQuantity < minOrderAmount) {
                console.error(`[ERROR] Calculated order quantity (${orderQuantity}) is less than minimum allowed (${minOrderAmount}) for ${ccxtSymbol}.`);
                if(serverJsSocket) serverJsSocket.emit('order_execution_log', { type: 'error', message: 'Order quantity less than minimum on executor', details: { calculated: orderQuantity, min: minOrderAmount } });
                return;
            }
            if (isNaN(orderQuantity) || orderQuantity <= 0) {
                console.error('[ERROR] Invalid order quantity after calculation:', orderQuantity);
                if(serverJsSocket) serverJsSocket.emit('order_execution_log', { type: 'error', message: 'Invalid order quantity after calculation on executor', details: { quantity: orderQuantity } });
                return;
            }
            console.log(`[INFO] Available USDT: ${usdtBalance.toFixed(2)}, Capital for trade: ${capitalToUse.toFixed(2)}, Current Price: ${currentPrice}, Position Value: ${positionValueUsdt.toFixed(2)}, Order Qty: ${orderQuantity}`);

            // 1. 레버리지 설정 
            console.log(`[INFO] Setting leverage to ${LEVERAGE}x for ${ccxtSymbol}`);
            await exchange.setLeverage(LEVERAGE, ccxtSymbol);
            console.log(`[INFO] Leverage set successfully for ${ccxtSymbol}.`);

            // 2. 메인 주문 (시장가 진입) 
            console.log(`[INFO] Attempting to place ${side.toUpperCase()} ${type.toUpperCase()} order for ${ccxtSymbol} Qty: ${orderQuantity}`);
            let entryOrderResult;
            if (type.toUpperCase() === 'MARKET') {
                if (side.toUpperCase() === 'BUY') {
                    entryOrderResult = await exchange.createMarketBuyOrder(ccxtSymbol, orderQuantity);
                } else if (side.toUpperCase() === 'SELL') {
                    entryOrderResult = await exchange.createMarketSellOrder(ccxtSymbol, orderQuantity);
                } else { 
                    console.error('[ERROR] Unsupported side for market order:', side);
                    if(serverJsSocket) serverJsSocket.emit('order_execution_log', { type: 'error', message: 'Unsupported side for market order on executor', details: { side } });
                    return; 
                }
            } else { 
                console.error('[ERROR] Unsupported order type:', type, '(currently only MARKET is supported for entry)');
                if(serverJsSocket) serverJsSocket.emit('order_execution_log', { type: 'error', message: 'Unsupported order type for entry on executor', details: { type } });
                return; 
            }
            console.log('[INFO] Entry Order Placed Successfully:'); console.log(entryOrderResult);
            if(serverJsSocket) serverJsSocket.emit('order_execution_log', { type: 'success', message: 'Entry order placed successfully by executor', details: entryOrderResult });

            const entryPrice = entryOrderResult.average || entryOrderResult.price || parseFloat(originalPrice);
            if (!entryPrice) {
                console.error('[ERROR] Could not determine entry price for TP/SL calculation.');
                 if(serverJsSocket) serverJsSocket.emit('order_execution_log', { type: 'error', message: 'Executor could not determine entry price for TP/SL' });
                return;
            }
            console.log(`[INFO] Entry price for TP/SL: ${entryPrice}`);

            // 3. TP/SL 가격 계산 (ROI 기준)
            const priceChangePercentForTp = ROI_TP_PERCENTAGE / LEVERAGE;
            const priceChangePercentForSl = ROI_SL_PERCENTAGE / LEVERAGE;
            console.log(`[INFO] Required price change for TP: ${(priceChangePercentForTp * 100).toFixed(2)}%, for SL: ${(priceChangePercentForSl * 100).toFixed(2)}%`);

            let tpPrice, slPrice;
            if (side.toUpperCase() === 'BUY') { 
                tpPrice = entryPrice * (1 + priceChangePercentForTp);
                slPrice = entryPrice * (1 - priceChangePercentForSl);
            } else { 
                tpPrice = entryPrice * (1 - priceChangePercentForTp);
                slPrice = entryPrice * (1 + priceChangePercentForSl);
            }
            console.log(`[INFO] Calculated TP price: ${tpPrice.toFixed(4)}, SL price: ${slPrice.toFixed(4)} for ${side.toUpperCase()} position.`);
            const tpSlOrderQuantity = entryOrderResult.filled || orderQuantity;

            // 4. TP 주문
            try {
                console.log(`[INFO] Placing TP order: ${side.toUpperCase() === 'BUY' ? 'SELL' : 'BUY'} ${tpSlOrderQuantity} ${ccxtSymbol} at trigger ${tpPrice.toFixed(4)}`);
                const tpOrderParams = { 'stopPrice': tpPrice, 'reduceOnly': true };
                const tpOrderResult = await exchange.createOrder(ccxtSymbol, 'TAKE_PROFIT_MARKET', side.toUpperCase() === 'BUY' ? 'sell' : 'buy', tpSlOrderQuantity, undefined, tpOrderParams);
                console.log('[INFO] TP Order Placed Successfully:'); console.log(tpOrderResult);
                if(serverJsSocket) serverJsSocket.emit('order_execution_log', { type: 'success', message: 'TP order placed successfully by executor', details: tpOrderResult });
            } catch (e_tp) {
                console.error(`[ERROR] Error placing TP order for ${ccxtSymbol}:`, e_tp.constructor.name, e_tp.message);
                if(serverJsSocket) serverJsSocket.emit('order_execution_log', { type: 'error', message: 'Error placing TP order by executor', details: { name: e_tp.constructor.name, message: e_tp.message } });
            }

            // 5. SL 주문 
            try {
                console.log(`[INFO] Placing SL order: ${side.toUpperCase() === 'BUY' ? 'SELL' : 'BUY'} ${tpSlOrderQuantity} ${ccxtSymbol} at trigger ${slPrice.toFixed(4)}`);
                const slOrderParams = { 'stopPrice': slPrice, 'reduceOnly': true };
                const slOrderResult = await exchange.createOrder(ccxtSymbol, 'STOP_MARKET', side.toUpperCase() === 'BUY' ? 'sell' : 'buy', tpSlOrderQuantity, undefined, slOrderParams);
                console.log('[INFO] SL Order Placed Successfully:'); console.log(slOrderResult);
                if(serverJsSocket) serverJsSocket.emit('order_execution_log', { type: 'success', message: 'SL order placed successfully by executor', details: slOrderResult });
            } catch (e_sl) {
                console.error(`[ERROR] Error placing SL order for ${ccxtSymbol}:`, e_sl.constructor.name, e_sl.message);
                if(serverJsSocket) serverJsSocket.emit('order_execution_log', { type: 'error', message: 'Error placing SL order by executor', details: { name: e_sl.constructor.name, message: e_sl.message } });
            }

        } catch (e) {
            console.error(`[ERROR] Error in trade_signal handler for ${ccxtSymbol}:`, e.constructor.name, e.message);
            let errorDetails = { name: e.constructor.name, message: e.message };
            if (e instanceof ccxt.DDoSProtection || e instanceof ccxt.RateLimitExceeded) {
                console.warn('[WARN] Rate limit or DDoS protection hit. Consider adding delays or retries.');
                errorDetails.type = 'RateLimit';
            } else if (e instanceof ccxt.NetworkError) {
                errorDetails.type = 'NetworkError';
            } else if (e instanceof ccxt.ExchangeError) {
                errorDetails.type = 'ExchangeError';
            } else if (e instanceof ccxt.AuthenticationError) {
                errorDetails.type = 'AuthenticationError';
            }
            if(serverJsSocket) serverJsSocket.emit('order_execution_log', { type: 'error', message: `Order execution failed on executor: ${e.message}`, details: errorDetails });
        }
        console.log('--- End of Signal Processing ---\n');
    });
    
    socket.on('order_execution_log_ack', (data) => { // server.js로부터 로그 수신 확인 (선택적)
        console.log('[DEBUG] server.js acknowledged order_execution_log:', data);
    });
});


// 프로세스 종료 처리
function gracefulShutdown() {
    stopClientActivityCheck();
    if (serverJsSocket) {
        console.log('[INFO] Disconnecting server.js (client) before shutdown...');
        serverJsSocket.disconnect(true);
    }
    io.close(() => {
        console.log('[INFO] Socket.IO server closed. Exiting.');
        process.exit(0);
    });

    // 강제 종료 타이머
    setTimeout(() => {
        console.error('[ERROR] Could not close connections in time, forcefully shutting down');
        process.exit(1);
    }, 5000); // 5초 대기
}

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
process.on('uncaughtException', (err) => {
    console.error('[FATAL] Uncaught Exception:', err);
    // 프로덕션 환경에서는 오류 로깅 후 PM2 등에 의해 재시작되도록 프로세스 종료
    process.exit(1); 
}); 