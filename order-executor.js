// order-executor.js (VPS에서 실행될 주문 실행기)
require('dotenv').config(); // API 키 등을 위해 .env 사용
const io = require('socket.io-client');
const ccxt = require('ccxt'); // ccxt 라이브러리 사용

// --- 설정값 ---
const SERVER_URL = 'http://<YOUR_SERVER_IP_OR_DOMAIN>:3000'; // server.js가 실행 중인 서버 주소
// const DEFAULT_ORDER_QUANTITY_BTC = 0.001; // 더 이상 직접 사용되지 않음
const CAPITAL_PERCENTAGE_FOR_TRADE = 0.50; // 거래당 사용할 자본 비율 (예: 50%)
const LEVERAGE = 10; // 사용할 레버리지 배율

// TP/SL 설정 (목표 ROI 기준 %)
const ROI_TP_PERCENTAGE = 0.08; // 예: +8% ROI 익절 (투자 마진 대비)
const ROI_SL_PERCENTAGE = 0.05; // 예: -5% ROI 손절 (투자 마진 대비, 손실률의 절대값)
// --- 설정값 끝 ---

const socket = io(SERVER_URL, {
    reconnectionAttempts: 5,
    timeout: 10000,
});

// Initialize Binance USDⓈ-M Futures exchange with ccxt
const exchange = new ccxt.binanceusdm({
    apiKey: process.env.BINANCE_FUTURES_API_KEY,
    secret: process.env.BINANCE_FUTURES_API_SECRET,
    options: {
        defaultType: 'future', // 선물 거래 명시
    }
});

// !!! 테스트넷 사용시 아래 주석 해제 및 API 키를 테스트넷용으로 변경 !!!
// exchange.setSandboxMode(true); 
// console.log('Using Testnet: ', exchange.urls.api); 

console.log(`Order Executor connecting to server: ${SERVER_URL} using CCXT for ${exchange.id}`);
console.log(`Capital Usage: ${CAPITAL_PERCENTAGE_FOR_TRADE*100}%, Leverage: ${LEVERAGE}x, ROI TP: +${ROI_TP_PERCENTAGE*100}%, ROI SL: -${ROI_SL_PERCENTAGE*100}%`);

function formatSymbolToCcxt(binanceSymbol) {
    if (binanceSymbol && binanceSymbol.toUpperCase().endsWith('USDT')) {
        return `${binanceSymbol.slice(0, -4)}/USDT`;
    }
    console.warn(`Could not format symbol for CCXT: ${binanceSymbol}, using as is.`);
    return binanceSymbol;
}

socket.on('connect', () => {
    console.log(`Connected to server with ID: ${socket.id}`);
});

socket.on('disconnect', (reason) => {
    console.log(`Disconnected from server: ${reason}`);
});

socket.on('connect_error', (error) => {
    console.error(`Connection Error: ${error.message}`);
});

// 매매 신호 수신
socket.on('trade_signal', async (signalData) => {
    console.log('\n--- New Trade Signal Received ---');
    console.log(new Date().toLocaleString('ko-KR'));
    console.log('Signal Data:', signalData);

    const { symbol: binanceSymbol, side, type, originalPrice } = signalData; // suggestedQuantity는 더 이상 사용 안 함
    const ccxtSymbol = formatSymbolToCcxt(binanceSymbol);

    let orderQuantity;

    try {
        // 0. 자본 기반 주문 수량 계산
        console.log('Fetching balance and ticker for quantity calculation...');
        const balance = await exchange.fetchBalance({ type: 'future' });
        const usdtBalance = balance.USDT && balance.USDT.free ? balance.USDT.free : 0;
        
        if (usdtBalance <= 0) {
            console.error('Insufficient USDT balance to trade.', { usdtAvailable: usdtBalance });
            socket.emit('order_execution_log', { type: 'error', message: 'Insufficient USDT balance', details: { usdtBalance } });
            return;
        }
        console.log(`Available USDT balance: ${usdtBalance}`);

        const capitalToUse = usdtBalance * CAPITAL_PERCENTAGE_FOR_TRADE;
        console.log(`Capital to use for this trade (USDT): ${capitalToUse}`);

        const ticker = await exchange.fetchTicker(ccxtSymbol);
        const currentPrice = ticker.last || ticker.close; // 현재가 (last 또는 close 사용)
        if (!currentPrice) {
            console.error(`Could not fetch current price for ${ccxtSymbol}`);
            socket.emit('order_execution_log', { type: 'error', message: `Could not fetch current price for ${ccxtSymbol}` });
            return;
        }
        console.log(`Current price for ${ccxtSymbol}: ${currentPrice}`);

        // 레버리지를 고려한 실제 주문 수량 계산 (노미널 가치 기준)
        // 주문하고자 하는 USDT 가치 = capitalToUse * LEVERAGE (이것이 포지션의 총 가치)
        // 주문 수량 (Base Asset) = (capitalToUse * LEVERAGE) / currentPrice
        // 주의: 여기서 capitalToUse는 실제 투입될 마진을 의미하도록 의도함.
        // 따라서 포지션의 총 가치는 capitalToUse (마진) * LEVERAGE 가 되어야 함.
        // 예: 100 USDT 마진, 10배 레버리지 -> 1000 USDT 가치의 포지션 오픈
        const positionValueUsdt = capitalToUse * LEVERAGE;
        let calculatedQuantity = positionValueUsdt / currentPrice;
        
        // 수량 정밀도 적용
        if (exchange.markets && exchange.markets[ccxtSymbol] && exchange.markets[ccxtSymbol].precision && exchange.markets[ccxtSymbol].precision.amount) {
            orderQuantity = parseFloat(exchange.amountToPrecision(ccxtSymbol, calculatedQuantity));
        } else {
            console.warn(`Could not find amount precision for ${ccxtSymbol}. Using calculated quantity as is. This might lead to errors.`);
            orderQuantity = calculatedQuantity; // 정밀도 정보 없을 시 그대로 사용 (오류 가능성 있음)
        }

        console.log(`Calculated position value (USDT): ${positionValueUsdt.toFixed(2)}, Quantity to order for ${ccxtSymbol}: ${orderQuantity}`);

        // 최소 주문 수량 확인 (선택적이지만 중요)
        const minOrderAmount = exchange.markets[ccxtSymbol]?.limits?.amount?.min;
        if (minOrderAmount && orderQuantity < minOrderAmount) {
            console.error(`Calculated order quantity (${orderQuantity}) is less than minimum allowed (${minOrderAmount}) for ${ccxtSymbol}.`);
            socket.emit('order_execution_log', { type: 'error', message: 'Order quantity less than minimum', details: { calculated: orderQuantity, min: minOrderAmount } });
            return;
        }

        if (isNaN(orderQuantity) || orderQuantity <= 0) {
            console.error('Invalid order quantity after calculation:', orderQuantity);
            socket.emit('order_execution_log', { type: 'error', message: 'Invalid order quantity after calculation', details: { quantity: orderQuantity } });
            return;
        }

        // 1. 레버리지 설정
        console.log(`Setting leverage to ${LEVERAGE}x for ${ccxtSymbol}`);
        await exchange.setLeverage(LEVERAGE, ccxtSymbol);
        console.log(`Leverage set successfully for ${ccxtSymbol}.`);

        // 2. 메인 주문 (시장가 진입)
        console.log(`Attempting to place ${side.toUpperCase()} ${type.toUpperCase()} order for ${ccxtSymbol} Qty: ${orderQuantity}`);
        let entryOrderResult;
        if (type.toUpperCase() === 'MARKET') {
            if (side.toUpperCase() === 'BUY') {
                entryOrderResult = await exchange.createMarketBuyOrder(ccxtSymbol, orderQuantity);
            } else if (side.toUpperCase() === 'SELL') {
                entryOrderResult = await exchange.createMarketSellOrder(ccxtSymbol, orderQuantity);
            } else {
                console.error('Unsupported side for market order:', side);
                socket.emit('order_execution_log', { type: 'error', message: 'Unsupported side for market order', details: { side } });
                return;
            }
        } else {
            console.error('Unsupported order type:', type, '(currently only MARKET is supported for entry)');
            socket.emit('order_execution_log', { type: 'error', message: 'Unsupported order type for entry', details: { type } });
            return;
        }
        console.log('Entry Order Placed Successfully:');
        console.log(entryOrderResult);
        socket.emit('order_execution_log', { type: 'success', message: 'Entry order placed successfully', details: entryOrderResult });

        const entryPrice = entryOrderResult.average || entryOrderResult.price || parseFloat(originalPrice);
        if (!entryPrice) {
            console.error('Could not determine entry price for TP/SL calculation.');
            return;
        }
        console.log(`Entry price for TP/SL: ${entryPrice}`);

        // 3. TP/SL 가격 계산 (ROI 기준)
        // 목표 ROI 달성을 위한 실제 가격 변동률 계산:
        // 가격 변동률 = 목표 ROI % / 레버리지 배율
        const priceChangePercentForTp = ROI_TP_PERCENTAGE / LEVERAGE;
        const priceChangePercentForSl = ROI_SL_PERCENTAGE / LEVERAGE;

        console.log(`Required price change for TP: ${(priceChangePercentForTp * 100).toFixed(2)}%, for SL: ${(priceChangePercentForSl * 100).toFixed(2)}%`);

        let tpPrice, slPrice;
        if (side.toUpperCase() === 'BUY') { // 롱 포지션
            tpPrice = entryPrice * (1 + priceChangePercentForTp);
            slPrice = entryPrice * (1 - priceChangePercentForSl);
        } else { // 숏 포지션
            tpPrice = entryPrice * (1 - priceChangePercentForTp);
            slPrice = entryPrice * (1 + priceChangePercentForSl);
        }
        
        // 가격 정밀도는 TP/SL 가격에 적용하는 것이 좋음 (여기는 예시로 toFixed(4) 사용)
        console.log(`Calculated TP price: ${tpPrice.toFixed(4)}, SL price: ${slPrice.toFixed(4)} for ${side.toUpperCase()} position.`);

        const tpSlOrderQuantity = entryOrderResult.filled || orderQuantity; // 실제 체결된 수량 또는 원래 주문 수량 사용

        // 4. TP 주문
        try {
            console.log(`Placing TP order: ${side.toUpperCase() === 'BUY' ? 'SELL' : 'BUY'} ${tpSlOrderQuantity} ${ccxtSymbol} at trigger ${tpPrice.toFixed(4)}`);
            const tpOrderParams = { 'stopPrice': tpPrice, 'reduceOnly': true };
            const tpOrderResult = await exchange.createOrder(ccxtSymbol, 'TAKE_PROFIT_MARKET', side.toUpperCase() === 'BUY' ? 'sell' : 'buy', tpSlOrderQuantity, undefined, tpOrderParams);
            console.log('TP Order Placed Successfully:'); console.log(tpOrderResult);
            socket.emit('order_execution_log', { type: 'success', message: 'TP order placed successfully', details: tpOrderResult });
        } catch (e_tp) {
            console.error(`Error placing TP order for ${ccxtSymbol}:`, e_tp.constructor.name, e_tp.message);
            socket.emit('order_execution_log', { type: 'error', message: 'Error placing TP order', details: { name: e_tp.constructor.name, message: e_tp.message } });
        }

        // 5. SL 주문
        try {
            console.log(`Placing SL order: ${side.toUpperCase() === 'BUY' ? 'SELL' : 'BUY'} ${tpSlOrderQuantity} ${ccxtSymbol} at trigger ${slPrice.toFixed(4)}`);
            const slOrderParams = { 'stopPrice': slPrice, 'reduceOnly': true };
            const slOrderResult = await exchange.createOrder(ccxtSymbol, 'STOP_MARKET', side.toUpperCase() === 'BUY' ? 'sell' : 'buy', tpSlOrderQuantity, undefined, slOrderParams);
            console.log('SL Order Placed Successfully:'); console.log(slOrderResult);
            socket.emit('order_execution_log', { type: 'success', message: 'SL order placed successfully', details: slOrderResult });
        } catch (e_sl) {
            console.error(`Error placing SL order for ${ccxtSymbol}:`, e_sl.constructor.name, e_sl.message);
            socket.emit('order_execution_log', { type: 'error', message: 'Error placing SL order', details: { name: e_sl.constructor.name, message: e_sl.message } });
        }

    } catch (e) {
        console.error(`Error in trade_signal handler for ${ccxtSymbol}:`, e.constructor.name, e.message);
        let errorDetails = { name: e.constructor.name, message: e.message };
        if (e instanceof ccxt.DDoSProtection || e instanceof ccxt.RateLimitExceeded) {
            console.warn('Rate limit or DDoS protection hit. Consider adding delays or retries.');
            errorDetails.type = 'RateLimit';
        } else if (e instanceof ccxt.NetworkError) {
            errorDetails.type = 'NetworkError';
        } else if (e instanceof ccxt.ExchangeError) {
            errorDetails.type = 'ExchangeError';
        } else if (e instanceof ccxt.AuthenticationError) {
            errorDetails.type = 'AuthenticationError';
        }
        socket.emit('order_execution_log', { type: 'error', message: `Order execution failed on ${exchange.id}`, details: errorDetails });
    }
    console.log('--- End of Signal Processing ---\n');
});

// 서버에서 보내는 일반 로그도 수신 (선택적)
socket.on('server-log', (logData) => {
    // console.log(`[SERVER LOG - ${logData.type?.toUpperCase()}] ${logData.source ? '['+logData.source.toUpperCase()+']' : ''} ${logData.message}`);
});

// PM2 등으로 실행 시 프로세스 종료 방지
process.stdin.resume(); 
function exitHandler(options, exitCode) {
    if (options.cleanup) console.log('Clean exit.');
    if (exitCode || exitCode === 0) console.log(`Exit code: ${exitCode}`);
    if (options.exit) {
        console.log('Exiting...');
        socket.disconnect(); // 웹소켓 연결 정상 종료
        process.exit();
    }
}
process.on('exit', exitHandler.bind(null,{cleanup:true}));
process.on('SIGINT', exitHandler.bind(null, {exit:true})); // ctrl+c
process.on('SIGUSR1', exitHandler.bind(null, {exit:true})); // kill pid
process.on('SIGUSR2', exitHandler.bind(null, {exit:true})); // kill pid
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
    exitHandler.bind(null, {exit:true})();
}); 