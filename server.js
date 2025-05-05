const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// 정적 파일 제공
app.use(express.static(path.join(__dirname, 'public')));

// 바이낸스 웹소켓 연결 (비트코인 선물)
const binanceWs = new WebSocket('wss://fstream.binance.com/ws/btcusdt@kline_1m');

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