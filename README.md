# 바이낸스 비트코인 선물 실시간 차트

이 프로젝트는 바이낸스 웹소켓을 사용하여 비트코인 선물 실시간 가격 정보를 가져와 트레이딩뷰 라이트웨이트 차트로 표시합니다.

## 기능

- 바이낸스 웹소켓을 통한 실시간 비트코인 선물 가격 데이터 수신
- 트레이딩뷰 라이트웨이트 차트를 이용한 캔들스틱 차트 표시
- Socket.io를 이용한 실시간 데이터 전송

## 설치 방법

```bash
# 저장소 클론
git clone https://github.com/yourusername/bitcoin-futures-chart.git

# 디렉토리 이동
cd bitcoin-futures-chart

# 의존성 패키지 설치
npm install
```

## 실행 방법

```bash
# 개발 모드 실행 (nodemon 사용)
npm run dev

# 또는 일반 실행
npm start
```

서버 실행 후 브라우저에서 `http://localhost:3000`으로 접속하면 실시간 차트를 볼 수 있습니다.

## 사용 기술

- Express: 웹 서버
- Socket.io: 실시간 데이터 전송
- WebSocket: 바이낸스 API 연결
- 트레이딩뷰 라이트웨이트 차트: 차트 표시
- CCXT: 암호화폐 거래소 API 연동

## 라이센스

ISC 