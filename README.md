# 바이낸스 (리플) 선물 실시간 차트 및 자동매매 신호

이 프로젝트는 바이낸스 웹소켓을 사용하여 리플(XRPUSDT) 선물 실시간 가격 정보를 가져오고, 설정된 매매 전략에 따라 매수/매도 신호를 생성하여 트레이딩뷰 라이트웨이트 차트와 함께 사용자 인터페이스에 표시합니다. 주문 실행 서버와 연동하여 실제 주문 전송 기능도 포함될 수 있습니다.

## 주요 기능

-   바이낸스 웹소켓을 통한 실시간 선물 가격 데이터 수신 (현재 XRPUSDT, 1시간 봉)
-   다양한 기술적 지표 계산 (하이킨아시, EMA, StochRSI, 볼린저 밴드)
-   설정된 매매 전략에 따른 자동 매수/매도 신호 생성
-   트레이딩뷰 라이트웨이트 차트를 이용한 캔들스틱 차트, 하이킨아시 차트, 보조지표(StochRSI, 볼린저 밴드) 표시
-   Socket.io를 이용한 실시간 데이터 및 매매 신호, 서버 로그 등을 클라이언트 UI로 전송
-   바이낸스 API를 통한 선물 지갑 잔고 및 거래 내역 조회
-   주문 실행 서버 (`order-executor.js`)와의 연동을 통한 매매 신호 전달 (실제 주문 실행 가능성)

## 프로젝트 구조

```
.
├── server.js                   # 메인 백엔드 서버: API/웹소켓 핸들링, 지표 계산, 매매 전략, UI 통신
├── order-executor.js           # 주문 실행 담당 서버 (추정): server.js로부터 매매 신호를 받아 실제 주문 실행
├── public/                     # 프론트엔드 정적 파일 (HTML, CSS, 클라이언트 JS)
│   └── index.html              # 메인 UI 페이지 (차트, 신호, 잔고, 거래내역, 로그 등 표시)
├── utils/                      # 유틸리티 함수 및 모듈
│   └── indicatorCalculator.js  # 기술적 지표 계산 함수 모음
├── node_modules/               # npm 패키지 저장 디렉토리
├── .env                        # (추정) 환경 변수 설정 파일 (API 키 등)
├── package.json                # 프로젝트 메타 정보 및 의존성 관리
├── package-lock.json           # 의존성 버전 고정 파일
├── .gitignore                  # Git 버전 관리 제외 파일/폴더 목록
└── README.md                   # 프로젝트 설명 파일
```

### 주요 파일 설명

*   **`server.js`**:
    *   Express.js 기반의 웹 서버를 실행합니다.
    *   바이낸스 선물 API 및 웹소켓에 연결하여 실시간 캔들 데이터를 수신하고 과거 데이터를 가져옵니다.
    *   `utils/indicatorCalculator.js`를 사용하여 각종 기술적 지표(하이킨아시, EMA, StochRSI, 볼린저 밴드)를 계산합니다.
    *   정의된 매매 전략에 따라 매수/매도 신호를 생성합니다.
    *   Socket.IO를 통해 계산된 차트 데이터, 지표, 매매 신호, 서버 로그 등을 `public/index.html`로 실시간 전송합니다.
    *   `/api/historical-klines`, `/api/futures-balance`, `/api/trade-history` 등의 API 엔드포인트를 제공합니다.
    *   `order-executor.js`로 실행되는 주문 실행 서버에 Socket.IO를 통해 매매 신호를 전달합니다.

*   **`order-executor.js`**:
    *   별도의 Node.js 프로세스로 실행되는 주문 실행 전용 서버로 보입니다.
    *   `server.js`로부터 `trade_signal` 이벤트를 수신하여 실제 바이낸스 거래소에 주문을 넣는 로직을 포함할 것으로 예상됩니다. (API 키 필요)
    *   주문 실행 결과나 로그를 다시 `server.js`로 전송할 수 있습니다.

*   **`public/index.html`**:
    *   사용자가 보는 웹 UI 페이지입니다.
    *   Lightweight Charts 라이브러리를 사용하여 일반 캔들 차트와 하이킨아시 캔들 차트, StochRSI, 볼린저 밴드 등을 시각화합니다.
    *   Socket.IO를 통해 `server.js`로부터 실시간 데이터를 받아 차트 및 기타 정보(현재가, 지갑 잔고, 매매 신호 상태, 거래 내역, 서버 로그)를 업데이트합니다.
    *   사용자가 거래 내역 조회 등을 요청할 수 있는 인터페이스를 제공합니다.

*   **`utils/indicatorCalculator.js`**:
    *   하이킨아시 캔들, 이동평균(EMA), 상대강도지수(RSI), 스토캐스틱 RSI(StochRSI), 볼린저 밴드(Bollinger Bands) 등 다양한 기술적 지표를 계산하는 함수들을 모아둔 모듈입니다. `server.js`에서 이 모듈을 가져와 사용합니다.

*   **`.env` (추정)**:
    *   실제 파일은 보이지 않지만, API 키와 시크릿 키 등 민감한 정보를 코드 외부에서 관리하기 위해 사용될 가능성이 높습니다. (`.gitignore`에 포함되어야 합니다.)

## 설치 방법

```bash
# 저장소 클론
git clone https://your-repository-url.git # 실제 저장소 주소로 변경해주세요
cd your-project-directory # 실제 프로젝트 디렉토리로 변경해주세요

# 의존성 패키지 설치
npm install
```

## 실행 방법

1.  **`.env` 파일 생성 (필요시)**:
    루트 디렉토리에 `.env` 파일을 만들고 필요한 API 키 등을 설정합니다. 예시:
    ```
    BINANCE_API_KEY=your_api_key
    BINANCE_API_SECRET=your_api_secret
    PORT=3000
    ```

2.  **서버 실행**:
    ```bash
    # 개발 모드 실행 (nodemon 사용, 변경사항 자동 감지 및 재시작)
    npm run dev

    # 또는 일반 실행
    npm start
    ```

    `order-executor.js`도 별도로 실행해야 할 수 있습니다 (예: `node order-executor.js`).

서버 실행 후 브라우저에서 `http://localhost:PORT` (PORT는 `.env` 또는 기본값 3000)으로 접속하면 실시간 차트 및 정보를 볼 수 있습니다.

## 사용 기술

-   Node.js
-   Express.js: 웹 서버 프레임워크
-   Socket.IO: 실시간 양방향 통신
-   WebSocket (ws 라이브러리): 바이낸스 실시간 데이터 스트림 연결
-   Axios: HTTP 클라이언트 (바이낸스 API 요청)
-   Lightweight Charts (TradingView): 프론트엔드 차트 라이브러리
-   dotenv: 환경 변수 관리
-   Crypto: 바이낸스 API 요청 시그니처 생성

## 라이센스

ISC 