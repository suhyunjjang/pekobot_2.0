# PekoBot 2.0

바이낸스 선물 트레이딩 봇

## 주요 기능

- 바이낸스 선물 웹소켓 연결로 실시간 차트 데이터 수신
- PC와 VPS 서버 분리 구조로 안정적인 운영
- 트레이딩뷰 라이트웨이트 차트 시각화
- 자동 TP/SL 설정 및 포지션 관리

## 디렉토리 구조

```
src/
├── pc/                   # 개인 PC에서 실행할 코드
│   ├── server.js         # 메인 서버 (차트 데이터 수신 및 클라이언트 통신)
│   ├── api/              # API 라우트
│   └── websocket/        # 웹소켓 이벤트 처리
│
├── vps/                  # VPS 서버에서 실행할 코드
│   └── orderExecutor.js  # 주문 실행기 (실제 트레이딩 주문 처리)
│
├── shared/               # 공유 코드
│   ├── api/              # API 관련 코드
│   │   └── binance.js    # 바이낸스 API 래퍼
│   ├── config/           # 설정 파일
│   │   └── constants.js  # 상수 정의
│   ├── services/         # 서비스 로직
│   │   ├── dataService.js   # 데이터 관리
│   │   ├── orderService.js  # 주문 처리
│   │   └── signalService.js # 시그널 생성 및 관리
│   ├── indicators/       # 기술적 지표 구현
│   │   ├── sma.js        # 단순 이동평균선
│   │   ├── bollingerBands.js # 볼린저 밴드
│   │   └── cci.js        # 상품 채널 지수
│   └── utils/            # 유틸리티 함수
│       └── logger.js     # 로깅 기능
│
└── ...
```

## 설치

```bash
# 저장소 클론
git clone https://github.com/suhyunjjang/pekobot_2.0.git
cd pekobot_2.0

# 의존성 설치
npm install
```

## 환경 설정

`.env` 파일을 프로젝트 루트에 생성하고 다음 내용을 설정하세요:

```
# 바이낸스 API 키
BINANCE_FUTURES_API_KEY=your_api_key
BINANCE_FUTURES_API_SECRET=your_api_secret

# 서버 설정
PORT=3000
ORDER_EXECUTOR_URL=ws://your_vps_ip:3001
```

## 실행 방법

### 개인 PC에서 실행 (차트 데이터 및 클라이언트 서버)

```bash
# 개발 모드
npm run pc-dev

# 프로덕션 모드
npm run pc
```

### VPS 서버에서 실행 (주문 실행기)

```bash
# 개발 모드
npm run vps-dev

# 프로덕션 모드
npm run vps
```

## 역할 분리

1. **개인 PC 서버 (src/pc/server.js)**
   - 바이낸스 웹소켓에서 실시간 차트 데이터를 받아옴
   - 주문실행기와 통신하여 데이터 주고받음
   - 주문실행기에 주문신호, TP/SL 계산 데이터를 전송
   - 클라이언트에 데이터 시각화 제공

2. **VPS 주문실행기 (src/vps/orderExecutor.js)**
   - 서버에서 받은 주문신호와 TP/SL 값 처리
   - 실제 바이낸스 주문 실행
   - 서버에 선물지갑 잔고, 포지션 정보 전송

## 기술적 지표

현재 구현된 지표:
- SMA (단순 이동평균선)
- 볼린저 밴드
- CCI (상품 채널 지수)

## 주의사항

- 실제 자금으로 거래 시 항상 주의하세요.
- 본 프로그램은 투자 조언을 제공하지 않습니다.
- 모든 트레이딩은 본인의 책임하에 이루어집니다. 