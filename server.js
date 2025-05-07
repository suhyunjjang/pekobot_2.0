const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const socketIo = require('socket.io');
const axios = require('axios');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// 정적 파일 제공
app.use(express.static(path.join(__dirname, 'public')));

// 과거 캔들 데이터 API 엔드포인트
app.get('/api/historical-klines', async (req, res) => {
  try {
    const symbol = 'BTCUSDT';
    const interval = '4h';
    const limit = 1000; // 최근 1000개 캔들

    const response = await axios.get('https://fapi.binance.com/fapi/v1/klines', {
      params: {
        symbol: symbol,
        interval: interval,
        limit: limit
      }
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
    const klines = response.data.map(k => ({
      time: k[0] / 1000, // 초 단위 Unix 타임스탬프
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5])
    }));

    res.json(klines);
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
  
  socket.on('disconnect', () => {
    console.log('클라이언트가 연결을 끊었습니다');
  });
});

// 바이낸스 웹소켓 메시지 처리
binanceWs.on('message', (data) => {
  try {
    const parsedData = JSON.parse(data);
    
    // kline/candlestick 데이터가 있는 경우
    if (parsedData.k) {
      const { t: time, o: open, h: high, l: low, c: close, v: volume } = parsedData.k;
      
      // 클라이언트에게 데이터 전송
      io.emit('kline', {
        time: time,
        open: parseFloat(open),
        high: parseFloat(high),
        low: parseFloat(low),
        close: parseFloat(close),
        volume: parseFloat(volume)
      });
    }
  } catch (error) {
    console.error('메시지 처리 오류:', error);
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