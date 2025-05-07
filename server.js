const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const socketIo = require('socket.io');
const axios = require('axios');
const indicators = require('./utils/indicatorCalculator'); // 계산 모듈 가져오기

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

// 과거 캔들 데이터 API 엔드포인트
app.get('/api/historical-klines', async (req, res) => {
  try {
    const symbol = 'BTCUSDT';
    const interval = '4h';
    const limit = MAX_RECENT_CANDLES; // 초기 데이터도 MAX_RECENT_CANDLES 만큼 가져옴

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
    
    res.json({
      regularCandles: clientFormatKlines,
      regularEMA200: regularEMA, // 이름 일관성 유지 (클라이언트에서 ema200Series로 사용중)
      regularStochRSI: regularStochRSI,
      heikinAshiCandles: heikinAshiCandles,
      heikinAshiEMA200: heikinAshiEMA, // 이름 일관성 유지
      heikinAshiStochRSI: heikinAshiStochRSI
    });
  } catch (error) {
    console.error('과거 캔들 데이터 API 오류:', error.response ? error.response.data : error.message);
    res.status(500).json({ message: '과거 캔들 데이터를 가져오는 데 실패했습니다.' });
  }
});

// 바이낸스 웹소켓 연결 (비트코인 선물)
const binanceWs = new WebSocket('wss://fstream.binance.com/ws/btcusdt@kline_4h');

// 클라이언트 연결시 이벤트
io.on('connection', (socket) => {
  console.log('클라이언트가 연결되었습니다');
  // 첫 연결 시 현재까지 누적된 recentCandles 기반 풀 데이터 전송 (선택적)
  // processAndEmitFullChartData(io);
  socket.on('disconnect', () => {
    console.log('클라이언트가 연결을 끊었습니다');
  });
});

// 모든 클라이언트에게 전체 계산된 차트 데이터를 전송하는 함수
function processAndEmitFullChartData(socketEmitter) {
    if (recentCandles.length === 0) return;

    // 현재 recentCandles를 복사하여 사용 (원본 변경 방지)
    const currentCandles = [...recentCandles];

    const heikinAshiCandles = indicators.calculateHeikinAshi(currentCandles);
    const regularEMA = indicators.calculateEMA(currentCandles, EMA_PERIOD);
    const heikinAshiEMA = indicators.calculateEMA(heikinAshiCandles, EMA_PERIOD);
    const regularRSI = indicators.calculateRSI(currentCandles, RSI_PERIOD);
    const regularStochRSI = indicators.calculateStochasticRSI(regularRSI, STOCH_PERIOD, K_PERIOD, D_PERIOD);
    const heikinAshiRSI = indicators.calculateRSI(heikinAshiCandles, RSI_PERIOD);
    const heikinAshiStochRSI = indicators.calculateStochasticRSI(heikinAshiRSI, STOCH_PERIOD, K_PERIOD, D_PERIOD);

    const allCalculatedData = {
        regularCandles: currentCandles,
        regularEMA200: regularEMA,
        regularStochRSI: regularStochRSI,
        heikinAshiCandles: heikinAshiCandles,
        heikinAshiEMA200: heikinAshiEMA,
        heikinAshiStochRSI: heikinAshiStochRSI
    };
    socketEmitter.emit('full_chart_update', allCalculatedData);
}

// 바이낸스 웹소켓 메시지 처리
binanceWs.on('message', (data) => {
  try {
    const parsedData = JSON.parse(data);
    if (parsedData.k) { // kline 데이터
      const kline = parsedData.k;
      const newCandle = {
        time: kline.t / 1000,
        open: parseFloat(kline.o),
        high: parseFloat(kline.h),
        low: parseFloat(kline.l),
        close: parseFloat(kline.c),
        volume: parseFloat(kline.v)
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
      // recentCandles.sort((a, b) => a.time - b.time); // 시간순 정렬 (필요시, push/shift면 유지될 수도)

      // 업데이트된 recentCandles 기반으로 모든 지표 재계산 후 클라이언트에 전송
      processAndEmitFullChartData(io);
    }
  } catch (error) {
    console.error('실시간 메시지 처리 오류:', error);
  }
});

binanceWs.on('error', (error) => {
  console.error('웹소켓 오류:', error);
});

// 서버 시작
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`서버가 포트 ${PORT}에서 실행 중입니다`);
}); 