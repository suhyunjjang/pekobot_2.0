const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const socketIo = require('socket.io');
const axios = require('axios');
const indicators = require('./utils/indicatorCalculator'); // 계산 모듈 가져오기
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// 정적 파일 제공
app.use(express.static(path.join(__dirname, 'public')));

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
  io.emit('server-log', { type: 'info', source: '/api/historical-klines', message: logMessageStart });

  try {
    const symbol = 'BTCUSDT';
    const interval = '4h';
    const limit = MAX_RECENT_CANDLES;

    const logFetch = `Fetching historical klines: ${symbol}, ${interval}, limit ${limit}`;
    console.log(logFetch);
    io.emit('server-log', { type: 'info', source: '/api/historical-klines', message: logFetch });

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
      volume: parseFloat(k[5])
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
    io.emit('server-log', { type: 'success', source: '/api/historical-klines', message: logSuccess, details: { count: clientFormatKlines.length } });

    res.json(responseData);
  } catch (error) {
    const errorMessage = error.response ? JSON.stringify(error.response.data) : error.message;
    const logError = `Error in /api/historical-klines: ${errorMessage}`;
    console.error(logError);
    io.emit('server-log', { type: 'error', source: '/api/historical-klines', message: logError, details: { errorData: errorMessage } });
    res.status(500).json({ message: '과거 캔들 데이터를 가져오는 데 실패했습니다.' });
  }
});

// --- 선물 지갑 잔고 API 엔드포인트 추가 ---
app.get('/api/futures-balance', async (req, res) => {
    const logMessageStart = 'Request received for /api/futures-balance';
    console.log(logMessageStart);
    io.emit('server-log', { type: 'info', source: '/api/futures-balance', message: logMessageStart });

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
        io.emit('server-log', { type: 'info', source: '/api/futures-balance', message: logFetch });

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
        io.emit('server-log', { type: 'success', source: '/api/futures-balance', message: logSuccess, details: { usdtBalance: usdtAvailableBalance, totalWalletBalanceUsdt: totalWalletBalanceInUsdt } });

        res.json({
            usdtBalance: usdtAvailableBalance.toFixed(2),
            totalWalletBalanceUsdt: totalWalletBalanceInUsdt.toFixed(2)
        });

    } catch (error) {
        const errorMessage = error.response ? JSON.stringify(error.response.data) : error.message;
        const logError = `Error in /api/futures-balance endpoint (direct): ${errorMessage}`;
        console.error(logError);
        io.emit('server-log', { type: 'error', source: '/api/futures-balance', message: logError, details: { errorData: errorMessage } });
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
    io.emit('server-log', { type: 'info', source: '/api/trade-history', message: logMessageStart, details: { symbol, limit } });

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
        io.emit('server-log', { type: 'info', source: '/api/trade-history', message: logFetch });

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
        io.emit('server-log', { type: 'success', source: '/api/trade-history', message: logSuccess, details: { count: tradesFormatted.length, symbol } });
        res.json(tradesFormatted);

    } catch (error) {
        const errorMessage = error.response ? JSON.stringify(error.response.data) : error.message;
        const logError = `Error in /api/trade-history endpoint for ${symbol}: ${errorMessage}`;
        console.error(logError);
        io.emit('server-log', { type: 'error', source: '/api/trade-history', message: logError, details: { errorData: errorMessage, symbol } });
        res.status(error.response ? error.response.status : 500).json({
            message: `Failed to fetch trade history for ${symbol}`,
            details: errorMessage
        });
    }
});

// 바이낸스 웹소켓 연결 (비트코인 선물)
const binanceWs = new WebSocket('wss://fstream.binance.com/ws/btcusdt@kline_4h');

// 클라이언트 연결시 이벤트
io.on('connection', (socket) => {
  const logConnect = `Client connected: ${socket.id}`;
  console.log(logConnect);
  io.emit('server-log', { type: 'info', source: 'socket.io', message: logConnect, details: { clientId: socket.id } });
  
  socket.on('disconnect', () => {
    const logDisconnect = `Client disconnected: ${socket.id}`;
    console.log(logDisconnect);
    io.emit('server-log', { type: 'info', source: 'socket.io', message: logDisconnect, details: { clientId: socket.id } });
  });
});

// 모든 클라이언트에게 전체 계산된 차트 데이터를 전송하는 함수
function processAndEmitFullChartData(socketEmitter) {
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
        socketEmitter.emit('full_chart_update', initialData);
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
        const trendConditionLong = latestHaCandle.close > latestHaEMA.value;
        const directionConditionLong = latestHaCandle.close > latestHaCandle.open;
        const oscillatorConditionLong = prevHaStochK <= 20 && currentHaStochK > 20;

        const trendConditionShort = latestHaCandle.close < latestHaEMA.value;
        const directionConditionShort = latestHaCandle.close < latestHaCandle.open;
        const oscillatorConditionShort = prevHaStochK >= 80 && currentHaStochK < 80;

        if (currentPosition === 'NONE') { // 현재 포지션이 없을 때만 진입 신호 확인
            if (trendConditionLong && directionConditionLong && oscillatorConditionLong) {
                strategySignal.signal = 'LONG_ENTRY';
                const signalTime = new Date(latestHaCandle.time * 1000).toLocaleString('ko-KR');
                const currentSymbol = latestOriginalCandle.symbol || 'BTCUSDT'; // recentCandles에서 전달된 심볼 사용
                console.log(`매수 진입 신호 발생: Time=${signalTime}, Symbol=${currentSymbol}`);
                
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
                io.emit('trade_signal', tradeSignalData);
                io.emit('server-log', {type: 'success', source: 'StrategyLogic', message: `BUY Signal Emitted`, details: tradeSignalData});

            } else if (trendConditionShort && directionConditionShort && oscillatorConditionShort) {
                strategySignal.signal = 'SHORT_ENTRY';
                const signalTime = new Date(latestHaCandle.time * 1000).toLocaleString('ko-KR');
                const currentSymbol = latestOriginalCandle.symbol || 'BTCUSDT'; // recentCandles에서 전달된 심볼 사용
                console.log(`매도 진입 신호 발생: Time=${signalTime}, Symbol=${currentSymbol}`);
                
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
                io.emit('trade_signal', tradeSignalData);
                io.emit('server-log', {type: 'success', source: 'StrategyLogic', message: `SELL Signal Emitted`, details: tradeSignalData});
            }
        }
        // (참고) 포지션 청산 및 상태 변경 로직은 여기에 추가될 수 있음
        // 예: if (currentPosition === 'LONG' && 반대신호_또는_청산조건) { currentPosition = 'NONE'; strategySignal.signal = 'LONG_EXIT'; }

        strategySignal.conditions = {
            long: { trend: trendConditionLong, direction: directionConditionLong, oscillator: oscillatorConditionLong },
            short: { trend: trendConditionShort, direction: directionConditionShort, oscillator: oscillatorConditionShort }
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

    socketEmitter.emit('full_chart_update', allCalculatedData);
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
      processAndEmitFullChartData(io);
    }
  } catch (error) {
    const errorMessage = error.message;
    const logWsError = `Error processing WebSocket message: ${errorMessage}`;
    console.error(logWsError);
    io.emit('server-log', { type: 'error', source: 'WebSocket', message: logWsError, details: { errorData: errorMessage } });
  }
});

binanceWs.on('error', (error) => {
  const errorMessage = error.message;
  const logWsConnError = `WebSocket connection error: ${errorMessage}`;
  console.error(logWsConnError);
  io.emit('server-log', { type: 'error', source: 'WebSocket', message: logWsConnError, details: { errorData: errorMessage } });
});

// 서버 시작
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  const logServerStart = `Server listening on port ${PORT}`;
  console.log(logServerStart);
  io.emit('server-log', { type: 'info', source: 'server', message: logServerStart, details: { port: PORT } });
  // fetchKlinesAndProcess(); // 이 함수는 API 엔드포인트 호출 시 또는 웹소켓 연결 시 데이터 가져오므로 중복 호출 방지
}); 